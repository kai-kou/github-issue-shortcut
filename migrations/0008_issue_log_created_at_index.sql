-- 0008_issue_log_created_at_index.sql — issue_log(created_at) にインデックスを追加（#71）
-- データモデル: worker/store.ts の cleanupStaleIssueLog（issue_log 保持期間クリーンアップ）
-- テスト側の正本は worker/store.ts の SCHEMA_STATEMENTS（同一内容を維持すること）。
-- created_at でのフィルタ（Cron Trigger の DELETE）がテーブル全件スキャンにならないようにする。

CREATE INDEX IF NOT EXISTS idx_issue_log_created_at ON issue_log(created_at);
