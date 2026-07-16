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
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    repo TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_issue_log_dedup ON issue_log(user_id, repo, content_hash, created_at)`,
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

/** GitHub への Issue 作成成功を issue_log に記録する（二重送信防止・FR-24）。タイトル・本文の平文は保存しない。 */
export async function recordIssueLog(db: D1Database, userId: string, repo: string, contentHash: string): Promise<void> {
  await db
    .prepare(`INSERT INTO issue_log (id, user_id, repo, content_hash, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), userId, repo, contentHash, nowSeconds())
    .run();
}

/**
 * 直近の短時間ウィンドウ内に、同一ユーザー・リポジトリ・内容ハッシュの送信記録があるかを返す（FR-24）。
 * 送信中の再タップ抑止（client 側）だけではタイムアウト後の再送信を防げないため、サーバー側でも照合する。
 */
export async function hasRecentIssueLog(
  db: D1Database,
  userId: string,
  repo: string,
  contentHash: string,
  sinceUnixSeconds: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM issue_log WHERE user_id = ? AND repo = ? AND content_hash = ? AND created_at >= ? LIMIT 1`,
    )
    .bind(userId, repo, contentHash, sinceUnixSeconds)
    .first();
  return row !== null;
}
