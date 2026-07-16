-- 0003_issue_log.sql — issue_log（M1 #28 二重起票の防止・基本）
-- データモデル: docs/requirements/00-requirements.md §6.2・§4.3-3（FR-24）
-- テスト側の正本は worker/store.ts の SCHEMA_STATEMENTS（同一内容を維持すること）。
-- タイトル・本文の平文は保存しない（content_hash のみ・NFR-17）。

CREATE TABLE IF NOT EXISTS issue_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  repo TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issue_log_dedup ON issue_log(user_id, repo, content_hash, created_at);
