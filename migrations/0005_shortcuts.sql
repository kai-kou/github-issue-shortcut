-- 0005_shortcuts.sql — shortcuts（M2 #13 C1-1/C2-2 ショートカット作成ヘルパー・FR-16）
-- データモデル: docs/requirements/00-requirements.md FR-16
-- テスト側の正本は worker/store.ts の SCHEMA_STATEMENTS（同一内容を維持すること）。
-- repo/labels/title はユーザーが選んだプリセット値をそのまま保存する（起動 URL の元データ）。
-- labels はカンマ区切りの文字列で保持する（`/new?labels=` の URL パラメータ形式と揃える）。

CREATE TABLE IF NOT EXISTS shortcuts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  repo TEXT NOT NULL,
  labels TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shortcuts_user_id ON shortcuts(user_id);
