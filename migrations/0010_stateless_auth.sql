-- P2: 認証のステートレス化（Epic #162 / Issue #164 / docs/design/stateless-architecture.md §4・§9）
--
-- GitHub トークン・ユーザー情報・セッション・ショートカットをサーバーに保存しなくなったため、
-- 対応するテーブルを物理削除する（＝保存済みの個人データもここで消える）。既存データは移行しない
-- 方針（設計 §9「移行時のデータ」: 再ログインとショートカット再作成で足りる）。
--
-- 残る 3 テーブル（重複防止・レート制限）は P3 でクライアント / Rate Limiting binding へ移すまでの暫定。
-- これらは `users(id)` への外部キーを持っていたため、users 廃止に伴いキーを GitHub の数値ユーザー ID
-- （`user_key`）へ張り替えて作り直す。カウンタ・重複防止窓（最長 26 時間）は作り直しても実害がない。

DROP TABLE IF EXISTS issue_log;
DROP TABLE IF EXISTS request_ids;
DROP TABLE IF EXISTS rate_limits;
-- P1 で /api/shortcuts を廃止済み（プリセットは端末内 localStorage が正本）。
DROP TABLE IF EXISTS shortcut_rate_limits;
DROP TABLE IF EXISTS shortcuts;
-- P2 の本丸: サーバーは GitHub トークン・セッション・ユーザー情報を一切保持しない。
DROP TABLE IF EXISTS tokens;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;

CREATE TABLE issue_log (
  user_key TEXT NOT NULL,
  repo TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_key, repo, content_hash)
);

CREATE INDEX idx_issue_log_created_at ON issue_log(created_at);

CREATE TABLE rate_limits (
  user_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_key, window_start)
);

CREATE TABLE request_ids (
  user_key TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_key, client_request_id)
);
