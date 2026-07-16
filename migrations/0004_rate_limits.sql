-- 0004_rate_limits.sql — rate_limits（M1 #32 A4-4 不正利用対策・アプリ側レート制限・PR-4）
-- データモデル: docs/requirements/00-requirements.md §8（PR-4）・OQ-6
-- テスト側の正本は worker/store.ts の SCHEMA_STATEMENTS（同一内容を維持すること）。
-- (user_id, window_start) を PK にした固定ウィンドウカウンタ。issue_log の予約パターンと同様、
-- 原子的な INSERT ... ON CONFLICT DO UPDATE ... RETURNING で単一ラウンドトリップに抑える。
-- Durable Object は導入しない（OQ-3 と同じ理由・バインディング追加を避ける YAGNI 方針）。

CREATE TABLE IF NOT EXISTS rate_limits (
  user_id TEXT NOT NULL REFERENCES users(id),
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, window_start)
);
