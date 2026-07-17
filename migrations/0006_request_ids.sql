-- 0006_request_ids.sql — request_ids（M3 #20 B4-4 オフラインキュー再送の重複防止・OQ-8）
-- データモデル: docs/requirements/00-requirements.md OQ-8・FR-22・FR-24
-- テスト側の正本は worker/store.ts の SCHEMA_STATEMENTS（同一内容を維持すること）。
-- issue_log の content_hash・短時間窓（再タップ対策）とは独立に、client_request_id で
-- 長時間窓（Background Sync 保持期間相当）の重複予約を行う。原子的 UPSERT パターンは
-- issue_log / rate_limits と同様。

CREATE TABLE IF NOT EXISTS request_ids (
  user_id TEXT NOT NULL REFERENCES users(id),
  client_request_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, client_request_id)
);
