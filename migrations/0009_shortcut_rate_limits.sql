-- 0009_shortcut_rate_limits.sql — shortcut_rate_limits（#87 POST/PUT /api/shortcuts のレート制限）
-- データモデル: docs/requirements/00-requirements.md PR-4・NFR-14
-- テスト側の正本は worker/store.ts の SCHEMA_STATEMENTS（同一内容を維持すること）。
-- /api/issues の起票レート制限（rate_limits）とは独立の予算にするため、既存テーブルの
-- PRIMARY KEY に action 列を加える（本番 D1 で列変更を伴うテーブル再作成が必要）のではなく、
-- request_ids と同型の別テーブルで分離する。

CREATE TABLE IF NOT EXISTS shortcut_rate_limits (
  user_id TEXT NOT NULL REFERENCES users(id),
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, window_start)
);
