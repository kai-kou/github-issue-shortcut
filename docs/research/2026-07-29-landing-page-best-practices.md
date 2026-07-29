# ランディングページのトレンド・ベストプラクティス（2026-07-29 調査）

> **目的**: GitHub Pages で公開するプロダクト LP（`site/`）の構成・デザイン・コピーを、
> 推測ではなく調査に基づいて決めるための根拠を残す（Issue #214）。
> **範囲**: 開発者向けツールの LP に絞る。EC・リード獲得型 LP の手法（フォーム最適化・
> クーポン訴求など）は本プロダクトに当てはまらないため採用しない。

## 0. 情報の信頼度ランク

| ランク | 意味 |
|--------|------|
| **[A]** | 一次調査・実データに基づく（サンプル数・調査対象が明示されている） |
| **[B]** | 業界メディアの整理記事（複数媒体で一致する主張） |
| **[C]** | 単一媒体の主張・数値の出所が追えないもの（**設計判断の根拠にしない**） |

**重要**: LP 系の記事は「◯◯すると CV が N% 上がる」という出所不明の数値が非常に多い。
本調査では **数値そのものを設計根拠にせず、構造・順序・パターンの一致だけを採用** した。

---

## 1. 中核となる一次調査: 開発者向けツール LP 100 件の分析 [A]

出典: [We studied 100 devtool landing pages—here's what really works in 2025 — Evil Martians](https://evilmartians.com/chronicles/we-studied-100-devtool-landing-pages-here-is-what-actually-works-in-2025)

開発者向けツールの LP を 100 件収集して構造を分類した調査。本 LP の骨格はこれを基準にした。

### 1.1 セクションの順序（ほぼ全件で一致）

```
Hero → Trust block → Feature block → Social proof → Supporting blocks（FAQ・料金・比較）→ Final CTA
```

### 1.2 ヒーロー

- **中央寄せ + 下にビジュアル** が支配的。テキスト左 / ビジュアル右の 2 カラムは少数派
- ビジュアルの出現順: アニメーション付き製品 UI > 静的な製品 UI > 切替式 UI > ライブ埋め込み >
  コードスニペット（ライブラリ・SDK・インフラ系）> 抽象イラスト（プレローンチ・バックエンド製品）
- **eyebrow**（タイトル上の小さなラベル）とバナーで「動いているプロダクト感」を出すのが定番

### 1.3 機能ブロックの語り方（効果が高い順）

1. **問題起点（problem-oriented）** — 痛みを提示してから解決を出す。**最も強い**
2. 動作起点（action/task-oriented）— 「Build faster」等。使いどころは示せるが説得力は浅い
3. 機能の羅列 — **最も弱い**
4. 断定的スローガン — 確立した製品でのみ機能する
5. ミッション表明 — 稀だが、課題が本物なら強い

レイアウト形式: フルスクリーンショット / チェス配置（左右交互）/ アイコン付きテキスト /
ベルト（横スクロール）/ **ベントーグリッド** / ステップ / 動画。

### 1.4 CTA

- 主 CTA は **具体的な動詞**（"Start building" / "Download now"）。汎用的な "Get started" より良い
- 副 CTA は視覚的に区別（アウトライン等）し、ドキュメント・OSS へ逃がす
- **デュアル CTA**（有償導線 + 即価値の導線）で、購入層と開発者層の両方を拾う
- **最終 CTA ブロックは全幅・背景を明確に分離**（濃色など）し、ボタンは 1 つに絞る

### 1.5 ソーシャルプルーフ

- ほぼ全件が **手選びの短い引用**（自動収集ではない）。アバター + 氏名 + ロゴ
- 配置は製品説明の後（ページ下部寄り）
- B2B はロゴ、**個人向けツールは GitHub スター数・利用統計などの「大きな数字」**
- アーリーステージなら「最初の顧客・同僚・友人の 1 件」でも成立する

### 1.6 全体の設計原則

- **"No salesy BS"** と **"Clever and simple wins"** の 2 つが支配的
- 派手なインタラクションは避け、堅実なタイポグラフィ・明快な階層・余白で作る
- ほぼ全件が **中央寄せ + max-width コンテナ**

---

## 2. ヒーローセクションの構成 [B]

複数の 2026 年ガイドで一致している内容（[SaaS Hero Section Design — Orbix Studio](https://www.orbix.studio/blogs/saas-hero-section-design) /
[Hero Section Design: 20+ Examples & Best Practices for 2026 — Landy](https://www.landy-ai.com/blog/hero-section-design) /
[SaaS Hero Section Best Practices — ALF Design Group](https://www.alfdesigngroup.com/post/saas-hero-section-best-practices)）。

- 構成要素は 4 つ: **① 成果を述べる見出し ② 補足するサブ見出し ③ 具体的な動詞の CTA ④ 実物の製品ビジュアル**
- **説明はサブ見出しの仕事**。見出しは短く（英語で 7 語以内目安）、専門用語を避けて便益を述べる
- CTA は 2 系統をファーストビューに置く（ヘッダー右上の控えめなもの + ヒーロー直下の主 CTA）
- **モバイルの縦積み順は「見出し → サブ見出し → CTA → ビジュアル」**。見出しがモバイルで
  3 行になると CTA がファーストビューから押し出されるため、**2 行以内** に収める

> 出典群には「最適化したヒーローは CV 15% / 未最適化 2%」等の数値があるが、
> 調査手法が不明のため **[C] 扱いとし採用しない**（構成・順序のみ採用）。

---

## 3. 2026 年のデザイン潮流 [B]

出典: [Top Web Design Trends for 2026 — Figma](https://www.figma.com/resource-library/web-design-trends/) /
[Web Design Trends 2026: The Definitive Guide — Line25](https://line25.com/articles/web-design-trends-2026/) /
[Web Design Trends 2026 — Studio Meyer](https://studiomeyer.io/en/blog/webdesign-trends-2026)

| 潮流 | 内容 | 本 LP での扱い |
|------|------|--------------|
| **ベントーグリッド** | 弁当箱由来のモジュラーレイアウト。情報密度が高くても走査しやすく、サイズ差で階層を作れる | **採用**（機能セクション） |
| **タイポグラフィ主役** | 大きな見出し・強い階層で第一印象を作る | **採用**（ただしカスタムフォントは読み込まない。起動速度優先） |
| **ダークモード** | 「アクセシビリティのトグル」から「視覚的アイデンティティ」へ。2026 年は業種を問わず提供が前提 | **採用**（`prefers-color-scheme` で自動切替。手動トグルは足さない） |
| **マイクロアニメーション** | 小さく応答的な動きでページを「生きている」感じにする | **限定採用**（スクロール表示のみ。`prefers-reduced-motion` で完全停止） |
| **AI パーソナライゼーション** | 訪問者ごとに内容を出し分ける | **不採用**（静的ホスティング・計測なしの方針と矛盾する） |

---

## 4. 本 LP への落とし込み（設計判断の対応表）

| 調査結果 | `site/` での実装 |
|---------|----------------|
| §1.1 セクション順 | Hero → トラストバー → 課題 → 使い方 → できること → 設計目標 → 安全性 → FAQ → 最終 CTA |
| §1.2 eyebrow | 「Android 向け PWA・オープンソース（MIT）」を見出し上に配置 |
| §1.2 実物の製品 UI | 起票フォームの実スクリーンショット（`npm run screenshots` の生成物を切り出し） |
| §1.3 問題起点 | 「スマホからの起票は、なぜこんなに遠いのか」を機能紹介より前に置き、README の competitor 調査に基づく 4 つの痛みを提示 |
| §1.3 ベントーグリッド | 機能セクションを 6 カラムグリッドの可変ブロックで構成（幅広 2 枚 + 標準 6 枚） |
| §1.4 具体的な動詞 CTA | 「アプリを開いて起票する」／副 CTA「GitHub でソースを見る」（デュアル CTA） |
| §1.4 最終 CTA ブロック | 全幅・濃色背景で分離し、主ボタンを 1 つに絞る |
| §1.5 ソーシャルプルーフ | **意図的に省略**。実在の利用者の声・スター数を持たないため、捏造せず「設計目標」と「安全性の事実」で信頼を作る（§5 参照） |
| §1.6 max-width 中央寄せ | `--container: 1120px` |
| §2 モバイル縦積み順 | 390px 幅で「見出し → サブ見出し → CTA → ビジュアル」を確認済み。見出しは 2 行 |
| §2 CTA 2 系統 | ヘッダー右上（小）+ ヒーロー直下（主） |
| §3 ダークモード | `prefers-color-scheme` でトークンを切替。アプリ本体（`src/App.css`）と同じ配色 |
| §3 モーション | `IntersectionObserver` のフェードインのみ。`prefers-reduced-motion: reduce` で無効化 |

### 4.1 調査に反した／採用しなかった判断とその理由

| 調査の示唆 | 本 LP の判断 | 理由 |
|-----------|------------|------|
| ヒーローは中央寄せが支配的（§1.2） | **デスクトップは 2 カラム**（テキスト左 / 端末右） | 製品ビジュアルが縦長のスマホ画面のため、中央寄せだと CTA がファーストビューから押し出される（§2 の CTA 可視性を優先）。モバイルでは調査どおり縦積みになる |
| ソーシャルプルーフを置く（§1.5） | **置かない** | 実在の推薦・利用統計がない。捏造は論外で、空セクションは信頼を損なう。獲得できた時点で §1.5 の形式（手選びの短い引用）で追加する |
| アニメーション付き製品 UI が最上位（§1.2） | 静的スクリーンショット | 動画・アニメの追加はページ重量と保守コストを増やす。まず静的で出し、必要なら後で差し替える（YAGNI） |

---

## 5. 誠実さに関する制約（本リポジトリ固有）

LP 系の一般論は「社会的証明を盛る」「数値を大きく見せる」方向に働くが、本プロダクトは
**プライバシーとログの実態を明記すること自体が差別化** になっている（README・
`docs/research/2026-07-28-data-retention-inventory.md`）。したがって次を制約として置く。

- 実測していない数値を実績として書かない（KPI は **「目標値であり実測値ではない」と明記**）
- 「ログを一切取らない」と書かない（Cloudflare 基盤側に例外ログが 5% サンプリングで最長 3 日残る）
- 可用性を保証しない旨を FAQ に明記する（個人開発 OSS のため）
- 利用者の声・導入数を持っていない以上、社会的証明セクションを作らない

---

## 6. パフォーマンス・アクセシビリティの実装方針

`docs/design/design-guidelines.md` §2 の数値基準を LP にも適用した。LP 固有の判断は以下。

- **ビルドなし・依存ゼロ**（HTML + CSS + 15 行程度の JS）。フレームワーク・CSS ライブラリを入れない
- ヒーロー画像を `preload` + `fetchpriority="high"`、以降は `loading="lazy"`。すべて幅高さ指定で CLS を防ぐ
- 言語切替は `html[data-lang]` の CSS 表示切替。**JS 無効でも日本語が読める**（プログレッシブエンハンスメント）
- `axe-core`（wcag2a / wcag2aa / wcag22aa）で違反ゼロを機械検証（`e2e/lp.spec.ts`）
- 文中のインラインリンクは WCAG 2.2 SC 2.5.8 の **inline 例外** に該当するため 24px 基準の対象外とする

---

## 7. 出典一覧

- [We studied 100 devtool landing pages—here's what really works in 2025 — Evil Martians](https://evilmartians.com/chronicles/we-studied-100-devtool-landing-pages-here-is-what-actually-works-in-2025) [A]
- [SaaS Hero Section Design: Examples, Formulas & Tips 2026 — Orbix Studio](https://www.orbix.studio/blogs/saas-hero-section-design) [B]
- [Hero Section Design: 20+ Examples & Best Practices for 2026 — Landy](https://www.landy-ai.com/blog/hero-section-design) [B]
- [SaaS Hero Section Design: Best Practices That Convert — ALF Design Group](https://www.alfdesigngroup.com/post/saas-hero-section-best-practices) [B]
- [Top Web Design Trends for 2026 — Figma](https://www.figma.com/resource-library/web-design-trends/) [B]
- [Web Design Trends 2026: The Definitive Guide — Line25](https://line25.com/articles/web-design-trends-2026/) [B]
- [Web Design Trends 2026: 12 Developments + Code Examples — Studio Meyer](https://studiomeyer.io/en/blog/webdesign-trends-2026) [B]
- [Best Landing Page Design Trends for 2026 — Moburst](https://www.moburst.com/blog/landing-page-design-trends-2026/) [C]
- [12 Landing Page Best Practices of 2026 — Leadfeeder](https://www.leadfeeder.com/blog/conversion-optimization/landing-pages-convert/) [C]
- [Configuring a publishing source for your GitHub Pages site — GitHub Docs](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)（公開方式の選定根拠）
