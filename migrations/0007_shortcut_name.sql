-- 0007_shortcut_name.sql — shortcuts.name（#98 ショートカット体験の再設計）
-- データモデル: docs/requirements/00-requirements.md FR-16 の拡張
-- テスト側の正本は worker/store.ts の SCHEMA_STATEMENTS（同一内容を維持すること）。
-- 表示名（ホーム画面一覧・PWA manifest.shortcuts の name/short_name に使う）。既存行は
-- 空文字をデフォルトとし、表示側で title/repo へフォールバックする（worker/index.ts）。

ALTER TABLE shortcuts ADD COLUMN name TEXT NOT NULL DEFAULT '';
