# リーンキャンバス — GitHub Issue Shortcut

> 作成日: 2026-07-10。根拠は [プロジェクトミッション](../project-mission.md) と各リサーチ（[市場・競合](../research/2026-07-10-market-competitors.md) / [モバイル UX・PWA](../research/2026-07-10-mobile-ux-pwa.md) / [認証](../research/2026-07-10-auth-architecture.md) / [Cloudflare スタック](../research/2026-07-10-cloudflare-stack.md)）。
> 本プロダクトは収益化を主目的としない実用ツール / OSS 位置づけ（[市場リサーチ §4](../research/2026-07-10-market-competitors.md) の相場観）。

## キャンバス全体像

| ブロック | 要点 |
|---|---|
| ① 課題 | モバイルでの Issue 起票が遅い・PAT 管理が面倒・毎回のリポジトリ / ラベル選択が面倒 |
| ② 顧客セグメント | GitHub Issues で個人タスクを管理する Android 使いの開発者（第 1 号は開発者本人） |
| ③ 独自の価値提案 | ホーム画面タップ → 数秒で Issue 起票。PAT 不要・ショートカットがリポジトリ / ラベルを覚えている |
| ④ 解決策 | 起動即入力の PWA + GitHub App 認証 + ショートカット起動（段階提供） |
| ⑤ チャネル | GitHub 公開リポジトリ・日本語圏技術記事（Zenn/Qiita）・将来 Play ストア（TWA） |
| ⑥ 収益の流れ | なし（実用ツール / OSS / ポートフォリオ） |
| ⑦ コスト構造 | Cloudflare 無料枠 + 開発者の時間（AI エージェント自律スプリント） |
| ⑧ 主要指標 | 起票 10 秒以内・3 タップ以内・成功率 99%・初回セットアップ 5 分以内 |
| ⑨ 圧倒的な優位性 | Android×PWA の空白地帯・セットアップ 0 分・URL パラメータでショートカット無限生成 |

## ① 課題

[市場リサーチ §5](../research/2026-07-10-market-competitors.md) のリーンキャンバス素材より。

1. **思いついた瞬間の Issue 起票がモバイルで遅い** — GitHub 公式アプリは 3〜4 タップ + 4 画面、モバイル Web は UI が重い（[市場リサーチ §2](../research/2026-07-10-market-competitors.md)）
2. **PAT の取得・管理が面倒** — HTTP Shortcuts 等の自作解における最大の摩擦
3. **リポジトリ・ラベルを毎回選ぶのが面倒** — 定型の起票先ほど選択の繰り返しが無駄

**既存の代替品**: GitHub 公式アプリ / `issues/new` プレフィル URL のショートカット（公式アプリがリンクを奪いプレフィルを落とすバグあり）/ HTTP Shortcuts（PAT 手動管理）/ iOS 専用アプリ 3 種（QuickIssue 等）/ 自動化プラットフォーム（遅延 or 課金）。詳細は [市場リサーチ §1–2](../research/2026-07-10-market-competitors.md)。

## ② 顧客セグメント

- **アーリーアダプター**: GitHub Issues で個人プロジェクト / 生活タスクを管理する Android 使いの開発者。日本語圏（Zenn/Qiita 読者層）に実践文化が確立している（[市場リサーチ §3](../research/2026-07-10-market-competitors.md)）
- **ユーザー第 1 号は開発者本人**（ドッグフーディング前提。「まず自分が毎日使える」がミッションの判断基準）
- 一般公開前提: 誰でも GitHub ログインで使える

## ③ 独自の価値提案

> **「ホーム画面タップ → 数秒で Issue 起票。PAT 不要（GitHub ログイン）・リポジトリ / ラベルはショートカットが覚えている」**

- ハイレベルコンセプト: **「Todoist のクイック追加級の体験を GitHub Issues に」**（[ミッション](../project-mission.md)）
- Simon Willison 氏の「携帯ではいまだに Apple Notes がデフォルト」証言が示す、モバイルキャプチャという未充足の穴を突く（[市場リサーチ §3](../research/2026-07-10-market-competitors.md)）

## ④ 解決策

課題との対応（提供順は [UX リサーチ §7 のロードマップ](../research/2026-07-10-mobile-ux-pwa.md) に準拠）。

| 課題 | 解決策 | 提供時期 |
|---|---|---|
| 起票が遅い | 起動即入力画面の PWA（app shell precache でサブ秒表示）・送信失敗時の下書き保全（楽観的 UI は M3） | MVP |
| PAT 管理が面倒 | GitHub App 認証（Issues: write のみの最小権限・[認証リサーチ §1](../research/2026-07-10-auth-architecture.md)） | MVP |
| 毎回の選択が面倒 | manifest shortcuts + URL パラメータ起動（リポジトリ / ラベルプリセット） | M2 以降 |

## ⑤ チャネル

- GitHub 公開リポジトリ（OSS として公開）
- 日本語圏の技術記事マーケ（Zenn/Qiita/はてな — 実践記事の土壌あり・[市場リサーチ §4](../research/2026-07-10-market-competitors.md)）
- 将来: TWA 化して Play ストア配布（[UX リサーチ §6](../research/2026-07-10-mobile-ux-pwa.md)）

## ⑥ 収益の流れ

- **収益化しない**。競合の相場（¥100 買い切り〜$2.49/月）でも「売上=ラーメン代」であり、実用ツール / OSS / ポートフォリオとして設計するのが現実的（[市場リサーチ §4](../research/2026-07-10-market-competitors.md)）
- 得るもの: 開発者自身の日常の生産性・OSS 実績・AI エージェント開発の知見

## ⑦ コスト構造

- **インフラ**: Cloudflare Workers 無料枠内で運用可能（静的配信は無料・無制限、D1/DO も無料枠あり・[Cloudflare リサーチ §1, §3](../research/2026-07-10-cloudflare-stack.md)）
- **開発**: Claude Code（AI エージェント）による自律スプリント開発。主コストは AI 実行コストと開発者のレビュー時間

## ⑧ 主要指標

[ミッションの KPI](../project-mission.md) をそのまま採用。

> KPI の正本は [`../project-mission.md`](../project-mission.md)（本表は転記）。

| 指標 | 目標 |
|---|---|
| 起票所要時間（起動 → 作成完了） | 10 秒以内（タイトルのみなら 5 秒以内） |
| 起票までのタップ数（ショートカット起動時） | 3 タップ以内 |
| 起票成功率（送信 → GitHub 反映） | 99% 以上（失敗時も入力内容を失わない） |
| 初回セットアップ（ログイン → 初起票） | 5 分以内 |

## ⑨ 圧倒的な優位性

[市場リサーチ §5](../research/2026-07-10-market-competitors.md) より。

- **Android×PWA のクイック起票は空白地帯**（Web ベースの競合は調査の限り存在せず、近い競合はすべて iOS ネイティブ）
- **セットアップ 0 分**: GitHub ログインのみで PAT 不要（既存解の最大摩擦を解消）
- **URL パラメータでショートカットを無限に作れる**（iOS ネイティブ勢にない Web ならではの武器）+ Web Share Target
- リスク: GitHub 公式のモバイル起票 UX 改善・市場自体の狭さ（詳細は [インセプションデッキ「夜も眠れない問題」](02-inception-deck.md)）
