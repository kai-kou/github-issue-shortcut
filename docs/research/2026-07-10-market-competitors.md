# リサーチ: 市場・競合・ユーザー実態（2026-07-10 実施）

> 専門リサーチチーム（プロダクトリサーチ班）による調査結果の要約。全て 2026-07-10 時点の情報で検証済み。
> 前提資料: ネイティブアプリ編の既存調査（HTTP Shortcuts が現状最良、公式アプリに起票直行導線なし）。

## 1. 直接競合: 「Android×PWA×ワンタップ起票」は空白地帯

- **Web ベースのクイック GitHub Issue 作成ツールは調査の限り存在しない**（複数クエリの検索・GitHub リポジトリ検索・Product Hunt・Show HN 全てで該当なし）。
- 近い競合はいずれも **iOS ネイティブ**:
  - **QuickIssue**（bannzai 氏・iOS・買い切り ¥100・Expo 製）: 起動即エディタ・AI タイトル生成・@claude メンションボタン・最近のリポジトリ。**ラベル非対応（レビューで要望あり）**。Android 版は「要望次第」。2025-12 まで更新継続。
    出典: <https://dev.to/bannzai/title-mobile-github-is-too-many-taps-i-built-quickissue-to-file-issues-in-1-second-38hi> / <https://apps.apple.com/jp/app/id6747303824>
  - **Anywhere Issue**（BYNET・iOS・無料+Premium ¥100/¥1,000 年）: OAuth ログイン・優先度ラベル・リマインダー・一覧/クローズ/移動。★3.7 で「連携後リポジトリが出ない」致命的レビューあり。
    出典: <https://apps.apple.com/us/app/anywhere-issue-github-issues/id6748542739>
  - **Quick Issues**（iOS・$2.49/月〜）: GitHub/GitLab/Gitea 対応・**オフラインバッファ→再接続時同期**・訴求は「~2 秒で起票」。Show HN は 1pt でほぼ無反応。
    出典: <https://news.ycombinator.com/item?id=47048092> / <https://apps.apple.com/us/app/id6758988655>
- オープンソース先行例: **lqdev/github-post-pwa**（Web Share Target で受けて GitHub の issues/new URL を組み立てる静的 PWA）— 本プロジェクトに最も近いアーキテクチャの実在証明。
  出典: <https://github.com/lqdev/github-post-pwa>

## 2. ベースライン代替手段の評価

| 代替手段 | 評価 |
|---|---|
| `github.com/{o}/{r}/issues/new?title=&body=&labels=` のホーム画面ショートカット | 公式サポートのプレフィル URL（実質競合ベースライン）。ただし要ログイン+送信タップ、モバイル Web の UI は重い。**GitHub モバイルアプリがリンクを奪ってプレフィルを落とすバグあり** |
| GitHub 公式アプリ | 起票まで 3〜4 タップ+4 画面。ホーム画面直行導線なし（貢献グラフ/PR ウィジェットのみ） |
| HTTP Shortcuts（Android・OSS） | 要件をほぼ満たす最有力の既存解。ただし PAT 手動管理・UI は素の入力ダイアログ・ラベル GUI なし |
| Todoist 等経由（Zapier/IFTTT/Make/n8n） | **公式 Todoist→GitHub 連携は存在しない**。自動化系は「無料=15 分遅延+月次上限」「即時=月 $3〜24」で、ワンタップ・即時・無料を同時に満たせない。IFTTT の GitHub アクションは Pro 課金必須 |
| メール起票 | GitHub 公式機能なし（第三者サービスは継続性リスク） |

出典: <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue#creating-an-issue-from-a-url-query> / <https://github.com/orgs/community/discussions/113726> / <https://ifttt.com/github> / <https://zapier.com/apps/github/integrations>

## 3. ユースケース実態: 「GitHub Issues で個人タスク管理」は確立された文化

- **Simon Willison 氏**（Issue 9,413 件蓄積・HN 314pt）: 「GitHub issues is _almost_ the best notebook in the world。**唯一欠けているのは同期式オフライン対応。だから携帯ではいまだに Apple Notes がデフォルト**」→ モバイルキャプチャがまさに未充足の穴。
  出典: <https://simonwillison.net/2025/May/26/notes/>
- **azu 氏**: タスクアプリと GitHub の二重管理をやめ Issues に一本化（missue 自作）。
  出典: <https://efcl.info/2020/12/25/missue/>
- 日本語圏（Zenn/Qiita/はてな）で 2020〜2026 年継続的に実践記事あり。「**タスク管理は、アプリを起動するのすら面倒になったら終わる**」(kyoruni 氏) が本質を突く。
  出典: <https://kyoruni.hatenablog.com/entry/2024/06/14> / <https://zenn.dev/hand_dot/articles/85c9640b7dcc66>
- **モバイル即時キャプチャの摩擦は一次証言が濃い**: niyaton 氏は Apple ショートカット+REST API を自作(「タスクは発生した時点で即座に登録するに限ります」)。QuickIssue 開発者は「GitHub mobile は 4 画面の障害物競走」と表現。
  出典: <https://zenn.dev/niyaton/articles/a6d007e046ad27>
- 離脱事例も実在: オフライン・同期問題で Obsidian へ移行した例（市場の狭さの証拠でもある）。
  出典: <https://news.ycombinator.com/item?id=44104761>

## 4. 収益性・市場規模の相場観

- 価格相場: QuickIssue ¥100 買い切り / Anywhere Issue ¥1,000 年 / Quick Issues $2.49 月。QuickIssue 開発者本人が「売上=ラーメン代」と公言。評価件数は各アプリ 3 件程度。
- **結論: ビジネスではなく実用ツール / OSS / ポートフォリオとして設計するのが現実的**。ただし「一般公開」の価値は十分ある（Android×PWA は空白・日本語圏の記事マーケ土壌あり）。

## 5. リーンキャンバス素材

- **課題**: ①思いついた瞬間の Issue 起票がモバイルで遅い（公式アプリ 4 画面・モバイル Web 重い） ②PAT の取得・管理が面倒（HTTP Shortcuts 等の自作解の最大の摩擦） ③リポジトリ・ラベルを毎回選ぶのが面倒
- **既存の代替品**: GitHub 公式アプリ / issues/new プレフィル URL / HTTP Shortcuts / iOS 専用アプリ 3 種 / 自動化プラットフォーム（遅延 or 課金）
- **独自の価値提案**: 「ホーム画面タップ→数秒で Issue 起票。PAT 不要（GitHub ログイン）・リポジトリ/ラベルはショートカットが覚えている」
- **圧倒的優位性**: Android×PWA の空白地帯・セットアップ 0 分（OAuth）・URL パラメータでショートカット無限に作れる（iOS 勢にない）・Web Share Target
- **アーリーアダプター**: GitHub Issues で個人プロジェクト/生活タスクを管理する Android 使いの開発者（日本語圏 Zenn/Qiita 読者層・自分自身がユーザー第 1 号）
- **リスク**: GitHub 公式がモバイル起票 UX を改善する可能性（ただし 2025 年の新 Issue UI 改善でもモバイル Web への言及なし）・市場自体は狭い
