/**
 * D1 永続化層（暫定・重複防止とレート制限のみ）。
 *
 * P2（stateless-architecture.md §9）で `users` / `sessions` / `tokens` / `shortcuts` を廃止し、
 * **個人データ（GitHub トークン・ユーザー情報・プリセット）はサーバーに一切保存しない**。
 * ここに残るのは「クライアントに置くと改変できてしまう」ため P3 まで D1 に残す 3 つだけ:
 *
 * - `issue_log`   : 30 秒窓の二重送信防止（内容ハッシュのみ・平文は保存しない）→ P3 で localStorage へ
 * - `request_ids` : 26 時間窓のオフラインキュー重複防止 → P3 で IndexedDB へ
 * - `rate_limits` : 起票のレート制限カウンタ → P3 で Workers Rate Limiting binding へ
 *
 * いずれも利用者の識別に **GitHub の数値ユーザー ID（`user_key`）** を使う（内部 UUID と `users`
 * テーブルは廃止済みのため外部キー制約は持たない）。タイムスタンプは UNIX 秒（機械処理用・UTC 基準・datetime-rules）。
 */

/**
 * スキーマの正本（テストで直接適用する）。本番は migrations/*.sql を
 * `wrangler d1 migrations apply` で適用する。両者は同一内容を維持すること。
 */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS issue_log (
    user_key TEXT NOT NULL,
    repo TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_key, repo, content_hash)
  )`,
  // created_at でのフィルタ（cleanupStaleIssueLog の DELETE・#71）が全件スキャンにならないようにする。
  `CREATE INDEX IF NOT EXISTS idx_issue_log_created_at ON issue_log(created_at)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    user_key TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (user_key, window_start)
  )`,
  `CREATE TABLE IF NOT EXISTS request_ids (
    user_key TEXT NOT NULL,
    client_request_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_key, client_request_id)
  )`,
];

/** 現在時刻を UNIX 秒で返す。 */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** テスト・初期化用にスキーマを適用する。 */
export async function applySchema(db: D1Database): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.prepare(statement).run();
  }
}

/**
 * 同一ユーザー・リポジトリ・内容ハッシュの送信枠を単一の原子的 UPSERT で予約する（二重送信防止・FR-24）。
 * `hasRecentIssueLog` の SELECT → GitHub 呼び出し → `recordIssueLog` の INSERT という check-then-act だと、
 * ほぼ同時の二重タップ・タイムアウト再送が両方とも SELECT を通過して GitHub 側で二重作成されてしまう。
 * `(user_key, repo, content_hash)` の PK に対する `INSERT ... ON CONFLICT DO UPDATE ... WHERE` で、
 * 直近ウィンドウ内の既存予約がなければ 1 回の D1 ラウンドトリップで原子的に予約を確保する。
 * 戻り値 true = 予約できた（GitHub 呼び出しへ進んでよい）、false = 直近ウィンドウ内に既存予約があった（重複）。
 * タイトル・本文の平文は保存しない。
 */
export async function reserveIssueLog(
  db: D1Database,
  userKey: string,
  repo: string,
  contentHash: string,
  windowSeconds: number,
): Promise<boolean> {
  const now = nowSeconds();
  const staleBefore = now - windowSeconds;
  const result = await db
    .prepare(
      `INSERT INTO issue_log (user_key, repo, content_hash, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_key, repo, content_hash) DO UPDATE SET created_at = excluded.created_at
       WHERE issue_log.created_at < ?`,
    )
    .bind(userKey, repo, contentHash, now, staleBefore)
    .run();
  return result.meta.changes === 1;
}

/**
 * `reserveIssueLog` で確保した予約を解放する（GitHub 側の作成が失敗した場合の後始末）。
 * 失敗時に予約を残したままだと、正当な再試行まで `duplicate_submission` としてブロックし続けてしまう。
 * 予約中（作成 created_at がウィンドウ内）は他リクエストが同じキーで upsert を通せないため、
 * 無条件 DELETE でも他者の予約を誤って消す競合は起こらない。
 */
export async function releaseIssueLogReservation(
  db: D1Database,
  userKey: string,
  repo: string,
  contentHash: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM issue_log WHERE user_key = ? AND repo = ? AND content_hash = ?`)
    .bind(userKey, repo, contentHash)
    .run();
}

/**
 * `issue_log` の保持期間ポリシー（#71）: 二重送信防止の照合ウィンドウ（`DUPLICATE_SUBMISSION_WINDOW` =
 * 30 秒）を過ぎた行は判定に使われないため、安全マージンを取った `olderThanSeconds` より古い行を削除して
 * D1 の行数増加（NFR-14・無料枠）を抑える。Cron Trigger（`scheduled` ハンドラ）から定期呼び出しする。
 */
export async function cleanupStaleIssueLog(db: D1Database, olderThanSeconds: number): Promise<number> {
  const staleBefore = nowSeconds() - olderThanSeconds;
  const result = await db.prepare(`DELETE FROM issue_log WHERE created_at < ?`).bind(staleBefore).run();
  return result.meta.changes ?? 0;
}

/**
 * オフラインキュー再送の重複防止（B4-4/FR-22×FR-24・OQ-8）: クライアントが起票の最初の送信試行時に
 * 生成する `client_request_id`（キュー管理用の既存ローカル ID を流用）で長時間窓の予約を行う。
 * `reserveIssueLog` の content_hash・短時間窓（再タップ対策）とは独立な仕組みで、Service Worker の
 * Background Sync（ページを閉じていても再送・約 24h 保持）とクライアント側キューの二重再送経路が
 * 日をまたいでも同一予約キーに収束するようにする（両経路とも同一の client_request_id を送信する前提）。
 * upsert の原子性・戻り値の意味は `reserveIssueLog` と同じ。
 */
export async function reserveRequestId(
  db: D1Database,
  userKey: string,
  clientRequestId: string,
  windowSeconds: number,
): Promise<boolean> {
  const now = nowSeconds();
  const staleBefore = now - windowSeconds;
  const result = await db
    .prepare(
      `INSERT INTO request_ids (user_key, client_request_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT(user_key, client_request_id) DO UPDATE SET created_at = excluded.created_at
       WHERE request_ids.created_at < ?`,
    )
    .bind(userKey, clientRequestId, now, staleBefore)
    .run();
  return result.meta.changes === 1;
}

/** `reserveRequestId` で確保した予約を解放する（GitHub 側の作成が失敗した場合の後始末）。 */
export async function releaseRequestIdReservation(
  db: D1Database,
  userKey: string,
  clientRequestId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM request_ids WHERE user_key = ? AND client_request_id = ?`)
    .bind(userKey, clientRequestId)
    .run();
}

export interface RateLimitResult {
  /** ウィンドウ内の上限（含む）以内であれば true。 */
  allowed: boolean;
  /** 次のウィンドウが始まるまでの残り秒数（429 応答の Retry-After に使う）。 */
  retryAfterSeconds: number;
}

/**
 * 固定ウィンドウのレート制限カウンタ（不正利用対策・PR-4/OQ-6）。ユーザー・ウィンドウ単位で
 * 原子的にカウントをインクリメントし、上限を超えていれば `allowed: false` を返す。
 * 呼び出しのついでに同一ユーザーの過去ウィンドウ分の行を削除し、無期限増加を避ける（#71 と同型のリスク対応）。
 */
export async function checkRateLimit(
  db: D1Database,
  userKey: string,
  windowSeconds: number,
  limit: number,
): Promise<RateLimitResult> {
  const now = nowSeconds();
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (user_key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(user_key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(userKey, windowStart)
    .first<{ count: number }>();
  // 掃除は次回呼び出し時にも再試行されるベストエフォートのため、失敗してもレート制限判定
  // 自体（上で確定済み）を巻き込んで request 全体を失敗させない。
  try {
    await db
      .prepare(`DELETE FROM rate_limits WHERE user_key = ? AND window_start < ?`)
      .bind(userKey, windowStart)
      .run();
  } catch {
    // no-op: 次回のチェック呼び出しでも同じ条件で再試行されるため無視してよい。
  }
  const count = row?.count ?? 1;
  return { allowed: count <= limit, retryAfterSeconds: windowStart + windowSeconds - now };
}
