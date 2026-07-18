/**
 * D1 永続化層（users / sessions / tokens）。
 * データモデルは docs/requirements/00-requirements.md §6.2 準拠。
 * タイムスタンプは UNIX 秒（機械処理用・UTC 基準・datetime-rules）。
 */
import type { GitHubUser } from "./github";

/**
 * スキーマの正本（テストで直接適用する）。本番は migrations/0001_init.sql を
 * `wrangler d1 migrations apply` で適用する。両者は同一内容を維持すること。
 */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    github_user_id INTEGER NOT NULL UNIQUE,
    login TEXT NOT NULL,
    avatar_url TEXT,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS tokens (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    access_token_enc TEXT NOT NULL,
    access_expires_at INTEGER NOT NULL,
    refresh_token_enc TEXT,
    refresh_expires_at INTEGER,
    updated_at INTEGER NOT NULL,
    refreshing_until INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS issue_log (
    user_id TEXT NOT NULL REFERENCES users(id),
    repo TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, repo, content_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    user_id TEXT NOT NULL REFERENCES users(id),
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (user_id, window_start)
  )`,
  `CREATE TABLE IF NOT EXISTS shortcuts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    repo TEXT NOT NULL,
    labels TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_shortcuts_user_id ON shortcuts(user_id)`,
  `CREATE TABLE IF NOT EXISTS request_ids (
    user_id TEXT NOT NULL REFERENCES users(id),
    client_request_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, client_request_id)
  )`,
];

export interface UserRow {
  id: string;
  github_user_id: number;
  login: string;
  avatar_url: string | null;
  created_at: number;
  deleted_at: number | null;
}

export interface EncryptedTokens {
  accessEnc: string;
  accessExpiresAt: number;
  refreshEnc: string | null;
  refreshExpiresAt: number | null;
}

export interface TokenRow extends EncryptedTokens {
  userId: string;
  /** リフレッシュロックの有効期限（unix 秒）。NULL は未ロック（OQ-3・M1 #17）。 */
  refreshingUntil: number | null;
}

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

/** GitHub ユーザーを upsert し、内部 user id を返す。 */
export async function upsertUser(db: D1Database, ghUser: GitHubUser): Promise<string> {
  const now = nowSeconds();
  const id = crypto.randomUUID();
  const row = await db
    .prepare(
      `INSERT INTO users (id, github_user_id, login, avatar_url, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT(github_user_id) DO UPDATE SET
         login = excluded.login,
         avatar_url = excluded.avatar_url,
         deleted_at = NULL
       RETURNING id`,
    )
    .bind(id, ghUser.id, ghUser.login, ghUser.avatar_url, now)
    .first<{ id: string }>();
  if (!row) throw new Error("upsertUser: no id returned");
  return row.id;
}

/**
 * 暗号化済みトークンをユーザー単位 1 行で保存する（ローテーション直列化の単位）。
 * 更新時は進行中のリフレッシュロック（refreshing_until）も必ずクリアする。
 */
export async function saveTokens(db: D1Database, userId: string, tokens: EncryptedTokens): Promise<void> {
  const now = nowSeconds();
  await db
    .prepare(
      `INSERT INTO tokens (user_id, access_token_enc, access_expires_at, refresh_token_enc, refresh_expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         access_token_enc = excluded.access_token_enc,
         access_expires_at = excluded.access_expires_at,
         refresh_token_enc = excluded.refresh_token_enc,
         refresh_expires_at = excluded.refresh_expires_at,
         updated_at = excluded.updated_at,
         refreshing_until = NULL`,
    )
    .bind(userId, tokens.accessEnc, tokens.accessExpiresAt, tokens.refreshEnc, tokens.refreshExpiresAt, now)
    .run();
}

/** ユーザーのトークン行を取得する。 */
export async function getTokens(db: D1Database, userId: string): Promise<TokenRow | null> {
  const row = await db
    .prepare(
      `SELECT user_id, access_token_enc, access_expires_at, refresh_token_enc, refresh_expires_at, refreshing_until
       FROM tokens WHERE user_id = ?`,
    )
    .bind(userId)
    .first<{
      user_id: string;
      access_token_enc: string;
      access_expires_at: number;
      refresh_token_enc: string | null;
      refresh_expires_at: number | null;
      refreshing_until: number | null;
    }>();
  if (!row) return null;
  return {
    userId: row.user_id,
    accessEnc: row.access_token_enc,
    accessExpiresAt: row.access_expires_at,
    refreshEnc: row.refresh_token_enc,
    refreshExpiresAt: row.refresh_expires_at,
    refreshingUntil: row.refreshing_until,
  };
}

/**
 * リフレッシュロックの獲得を試みる（ユーザー単位の直列化・OQ-3: D1 行ロックで解決）。
 * 既に他リクエストが有効なロックを保持していれば false（呼び出し側はポーリングで完了を待つ）。
 * lockUntil はクラッシュ時に自動失効させるための有効期限（unix 秒）。
 */
export async function tryAcquireRefreshLock(db: D1Database, userId: string, lockUntil: number): Promise<boolean> {
  const now = nowSeconds();
  const result = await db
    .prepare(
      `UPDATE tokens SET refreshing_until = ?
       WHERE user_id = ? AND (refreshing_until IS NULL OR refreshing_until < ?)`,
    )
    .bind(lockUntil, userId, now)
    .run();
  return result.meta.changes === 1;
}

/**
 * リフレッシュロックを解放する（リフレッシュ失敗時のクリーンアップ用）。
 * lockUntil は自分が tryAcquireRefreshLock で獲得した際の値をそのまま渡す。一致する場合のみ
 * 解放することで、TTL 切れ後に他リクエストが獲得した新しいロックを誤って解放しない（CAS）。
 */
export async function releaseRefreshLock(db: D1Database, userId: string, lockUntil: number): Promise<void> {
  await db
    .prepare(`UPDATE tokens SET refreshing_until = NULL WHERE user_id = ? AND refreshing_until = ?`)
    .bind(userId, lockUntil)
    .run();
}

/** セッションを作成する（id_hash はハッシュ化済みの値を渡す）。 */
export async function createSession(
  db: D1Database,
  idHash: string,
  userId: string,
  ttlSeconds: number,
): Promise<void> {
  const now = nowSeconds();
  await db
    .prepare(
      `INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_used_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(idHash, userId, now, now + ttlSeconds, now)
    .run();
}

/** 有効なセッションから紐づくユーザーを返す。見つかれば last_used_at を更新する。 */
export async function getUserBySessionHash(db: D1Database, idHash: string): Promise<UserRow | null> {
  const now = nowSeconds();
  const row = await db
    .prepare(
      `SELECT u.id, u.github_user_id, u.login, u.avatar_url, u.created_at, u.deleted_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL`,
    )
    .bind(idHash, now)
    .first<UserRow>();
  if (!row) return null;
  await db.prepare(`UPDATE sessions SET last_used_at = ? WHERE id_hash = ?`).bind(now, idHash).run();
  return row;
}

/** セッションを削除する（ログアウト）。 */
export async function deleteSession(db: D1Database, idHash: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE id_hash = ?`).bind(idHash).run();
}

/**
 * 同一ユーザー・リポジトリ・内容ハッシュの送信枠を単一の原子的 UPSERT で予約する（二重送信防止・FR-24）。
 * `hasRecentIssueLog` の SELECT → GitHub 呼び出し → `recordIssueLog` の INSERT という check-then-act だと、
 * ほぼ同時の二重タップ・タイムアウト再送が両方とも SELECT を通過して GitHub 側で二重作成されてしまう
 * （`tryAcquireRefreshLock` が CAS の `UPDATE ... WHERE` で解決しているのと同じ競合クラス）。
 * `(user_id, repo, content_hash)` の PK に対する `INSERT ... ON CONFLICT DO UPDATE ... WHERE` で、
 * 直近ウィンドウ内の既存予約がなければ 1 回の D1 ラウンドトリップで原子的に予約を確保する。
 * 戻り値 true = 予約できた（GitHub 呼び出しへ進んでよい）、false = 直近ウィンドウ内に既存予約があった（重複）。
 * タイトル・本文の平文は保存しない。
 */
export async function reserveIssueLog(
  db: D1Database,
  userId: string,
  repo: string,
  contentHash: string,
  windowSeconds: number,
): Promise<boolean> {
  const now = nowSeconds();
  const staleBefore = now - windowSeconds;
  const result = await db
    .prepare(
      `INSERT INTO issue_log (user_id, repo, content_hash, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, repo, content_hash) DO UPDATE SET created_at = excluded.created_at
       WHERE issue_log.created_at < ?`,
    )
    .bind(userId, repo, contentHash, now, staleBefore)
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
  userId: string,
  repo: string,
  contentHash: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM issue_log WHERE user_id = ? AND repo = ? AND content_hash = ?`)
    .bind(userId, repo, contentHash)
    .run();
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
  userId: string,
  clientRequestId: string,
  windowSeconds: number,
): Promise<boolean> {
  const now = nowSeconds();
  const staleBefore = now - windowSeconds;
  const result = await db
    .prepare(
      `INSERT INTO request_ids (user_id, client_request_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id, client_request_id) DO UPDATE SET created_at = excluded.created_at
       WHERE request_ids.created_at < ?`,
    )
    .bind(userId, clientRequestId, now, staleBefore)
    .run();
  return result.meta.changes === 1;
}

/** `reserveRequestId` で確保した予約を解放する（GitHub 側の作成が失敗した場合の後始末）。 */
export async function releaseRequestIdReservation(
  db: D1Database,
  userId: string,
  clientRequestId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM request_ids WHERE user_id = ? AND client_request_id = ?`)
    .bind(userId, clientRequestId)
    .run();
}

/**
 * アカウント削除（FR-12・§6.2）: 該当ユーザーの行を全テーブルから削除する（論理削除ではなく物理削除）。
 */
export async function deleteAccount(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM shortcuts WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM issue_log WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM request_ids WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM rate_limits WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM tokens WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM users WHERE id = ?`).bind(userId),
  ]);
}

export interface ShortcutRow {
  id: string;
  repo: string;
  labels: string[];
  title: string;
  name: string;
}

/** labels は JSON 配列としてシリアライズする（カンマ区切り文字列だと、ラベル名自体にカンマを
 * 含む場合に分割数がずれて元のラベル配列を復元できない・#86 セルフレビュー指摘）。 */
function serializeLabels(labels: string[]): string {
  return JSON.stringify(labels);
}

function deserializeLabels(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === "string") : [];
  } catch {
    return [];
  }
}

function toShortcutRow(row: { id: string; repo: string; labels: string; title: string; name: string }): ShortcutRow {
  return {
    id: row.id,
    repo: row.repo,
    labels: deserializeLabels(row.labels),
    title: row.title,
    name: row.name,
  };
}

/** ユーザーのショートカットプリセット一覧を作成日時の昇順で返す（C1-1・FR-16）。 */
export async function listShortcuts(db: D1Database, userId: string): Promise<ShortcutRow[]> {
  const result = await db
    .prepare(`SELECT id, repo, labels, title, name FROM shortcuts WHERE user_id = ? ORDER BY created_at ASC`)
    .bind(userId)
    .all<{ id: string; repo: string; labels: string; title: string; name: string }>();
  return (result.results ?? []).map(toShortcutRow);
}

/** ショートカットプリセットを作成する（repo/labels/title は呼び出し側で少なくとも1つ非空であることを検証済みとする。
 * name は表示名で任意・空文字可）。 */
export async function createShortcut(
  db: D1Database,
  userId: string,
  input: { repo: string; labels: string[]; title: string; name: string },
): Promise<ShortcutRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO shortcuts (id, user_id, repo, labels, title, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, userId, input.repo, serializeLabels(input.labels), input.title, input.name, nowSeconds())
    .run();
  return { id, repo: input.repo, labels: input.labels, title: input.title, name: input.name };
}

/** ショートカットプリセットを更新する（所有者一致が条件。0 行更新なら false を返す）。 */
export async function updateShortcut(
  db: D1Database,
  userId: string,
  id: string,
  input: { repo: string; labels: string[]; title: string; name: string },
): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE shortcuts SET repo = ?, labels = ?, title = ?, name = ? WHERE id = ? AND user_id = ?`)
    .bind(input.repo, serializeLabels(input.labels), input.title, input.name, id, userId)
    .run();
  return result.meta.changes === 1;
}

/** ショートカットプリセットを削除する（所有者一致が条件。0 行削除なら false を返す）。 */
export async function deleteShortcut(db: D1Database, userId: string, id: string): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM shortcuts WHERE id = ? AND user_id = ?`).bind(id, userId).run();
  return result.meta.changes === 1;
}

export interface RateLimitResult {
  /** ウィンドウ内の上限（含む）以内であれば true。 */
  allowed: boolean;
  /** 次のウィンドウが始まるまでの残り秒数（429 応答の Retry-After に使う）。 */
  retryAfterSeconds: number;
}

/**
 * 固定ウィンドウのレート制限カウンタ（不正利用対策・PR-4・OQ-6）。ユーザー・ウィンドウ単位で
 * 原子的にカウントをインクリメントし、上限を超えていれば `allowed: false` を返す。
 * Durable Object は導入しない（OQ-3 と同じ理由でバインディングを増やさない方針）ため、
 * `reserveIssueLog` と同様の `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` で実装する。
 * 呼び出しのついでに同一ユーザーの過去ウィンドウ分の行を削除し、無期限増加を避ける（#71 と同型のリスク対応）。
 */
export async function checkRateLimit(
  db: D1Database,
  userId: string,
  windowSeconds: number,
  limit: number,
): Promise<RateLimitResult> {
  const now = nowSeconds();
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (user_id, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(user_id, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(userId, windowStart)
    .first<{ count: number }>();
  // 掃除は次回呼び出し時にも再試行されるベストエフォートのため、失敗してもレート制限判定
  // 自体（上で確定済み）を巻き込んで request 全体を失敗させない。
  try {
    await db
      .prepare(`DELETE FROM rate_limits WHERE user_id = ? AND window_start < ?`)
      .bind(userId, windowStart)
      .run();
  } catch {
    // no-op: 次回のチェック呼び出しでも同じ条件で再試行されるため無視してよい。
  }
  const count = row?.count ?? 1;
  return { allowed: count <= limit, retryAfterSeconds: windowStart + windowSeconds - now };
}
