# 要件定義ドキュメント一式

GitHub Issue Shortcut（Android スマホから数秒で特定 GitHub リポジトリに Issue を起票できる PWA）の要件定義ドキュメント。

## 構成

| ドキュメント | 内容 |
|------------|------|
| [00-requirements.md](00-requirements.md) | 要件定義書本体（機能要件・非機能要件・アーキテクチャ・制約・リスク） |
| [01-lean-canvas.md](01-lean-canvas.md) | リーンキャンバス（課題・価値提案・代替品・アーリーアダプター） |
| [02-inception-deck.md](02-inception-deck.md) | インセプションデッキ（10 の質問） |
| [03-user-story-map.md](03-user-story-map.md) | ユーザーストーリーマップ（活動 → ステップ → ストーリー、マイルストーンスライス） |
| [04-milestones.md](04-milestones.md) | マイルストーン計画（M0〜M4・Done 判定・SP 見積もり） |

## 根拠資料

要件の技術的・市場的根拠は `docs/research/` のディープリサーチ結果（2026-07-10 実施）を参照:

- [認証アーキテクチャ](../research/2026-07-10-auth-architecture.md) — GitHub App / OAuth・トークン管理・API 制約
- [Cloudflare 技術スタック](../research/2026-07-10-cloudflare-stack.md) — Workers・フレームワーク・データ層・CI/CD
- [Android/PWA クイック起票 UX](../research/2026-07-10-mobile-ux-pwa.md) — 起動導線・PWA 制約・ネイティブ化パス
- [市場・競合・ユーザー実態](../research/2026-07-10-market-competitors.md) — 競合分析・ユースケース実態

## 決定事項（ユーザー確認済み・2026-07-10）

| 論点 | 決定 |
|------|------|
| 利用者スコープ | 最初から一般公開前提 |
| MVP 範囲 | Issue 作成のみ最短（ラベル・ショートカット起動は M2 以降） |
| ネイティブ化 | PWA → TWA ラップ路線（コードベースは 1 つ） |
| ドキュメント粒度 | フルセット（本ディレクトリの 5 文書） |

## 運用

- 本ドキュメントは開発の進行・学びに応じて更新する（更新は PR 経由）
- 機能要件 ID（FR-x）・非機能要件 ID（NFR-x）は Issue から参照してトレーサビリティを保つ
