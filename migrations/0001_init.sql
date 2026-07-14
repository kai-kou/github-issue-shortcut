-- 0001_init.sql — users / sessions / tokens（M1 #14 GitHub App OAuth 認証）
-- データモデル: docs/requirements/00-requirements.md §6.2
-- テスト側の正本は worker/store.ts の SCHEMA_STATEMENTS（同一内容を維持すること）。
-- タイムスタンプは UNIX 秒（UTC 基準・機械処理用）。

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  github_user_id INTEGER NOT NULL UNIQUE,
  login TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  access_token_enc TEXT NOT NULL,
  access_expires_at INTEGER NOT NULL,
  refresh_token_enc TEXT,
  refresh_expires_at INTEGER,
  updated_at INTEGER NOT NULL
);
