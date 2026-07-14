-- 0002_add_refresh_lock.sql — tokens.refreshing_until（M1 #17 リフレッシュ直列化ロック）
-- ユーザー単位でトークンリフレッシュを直列化するための D1 行ロック用カラム（OQ-3: D1 行ロックで解決）。
-- NULL = 未ロック。値は unix 秒のロック有効期限（クラッシュ時の自動失効用）。
-- テスト側の正本は worker/store.ts の SCHEMA_STATEMENTS（同一内容を維持すること）。

ALTER TABLE tokens ADD COLUMN refreshing_until INTEGER;
