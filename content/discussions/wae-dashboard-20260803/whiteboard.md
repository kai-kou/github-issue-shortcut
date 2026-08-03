<!-- discussion_whiteboard:auto -->
# 🧑‍🏫 議論ホワイトボード: Workers Analytics Engine の導入と GitHub Pages 利用状況ダッシュボード（日次・週次・月次）の設計

- 議題ID: `wae-dashboard-20260803`
- 論点: 飼い主の指示: WAE 導入方針で進める / 利用状況を GitHub Pages の専用ダッシュボードで確認できるようにする / UI-UX は最新トレンド・ベストプラクティスをリサーチしてから実装 / 最低限 日次・週次・月次で確認したい。導入可否は決定済みのため蒸し返さず「どう作るか」に集中する。争点は 識別子設計とプライバシー境界 / 公開範囲 / データ供給経路 / 集計と保持の役割分担 / UI-UX / 実装分割 の 6 点。
- 参加者: `privacy-identity`, `data-pipeline`, `delivery-security`, `dashboard-ux`, `scope-delivery`
- 投稿数: 5
- 更新: 2026-08-03T10:18:55+09:00

> このファイルは `tools/discussion_whiteboard.py render` が自動生成する。直接編集せず `post` で追記すること（同時書き込み破損防止）。

## ラウンド 1

### `delivery-security` — 主張
<sub>2026-08-03T10:17:12+09:00</sub>

## delivery-security の立場: 配信経路の推奨は **案 B（データブランチ経由）**、実装は既存ルーティンに統合（D 寄りの運用・B のデータ配置）

### 比較表

| 評価軸 | 案 A（GH Actions が SQL API 直叩き → site/ 焼き込み） | 案 B（データブランチの JSON をダッシュボードが取得） | 案 C（Worker が公開エンドポイントを新設） | 案 D（定期セッションが生成してコミット） |
|---|---|---|---|---|
| **1. トークン置き場** | ❌ **GitHub Secrets に Cloudflare API トークン（Account Analytics Read）を新規登録**。`docs/research/2026-07-10-cloudflare-connector-keyless.md` はまさに「CI に長期キーを持たせない」ためにデプロイ経路を Workers Builds（キーレス）へ切り替えた経緯があり、読み取り専用スコープとはいえ同じ轍を踏む。ローテーション・漏洩監視のコストが恒久的に乗る | ✅ 既存の Cloudflare API MCP（OAuth 認可・スケジュールセッションにも供給済み・同ドキュメント §4）でセッションが直接クエリする。**GitHub Secrets への新規キー登録が不要**（＝キーレス方針と完全に整合） | △ Worker の `wrangler secret` に置けば GitHub Secrets は汚さないが、長期キーがどこかに常駐する構図自体は消えない。加えて「公開エンドポイント」という新しい問題を生む（下記） | ✅ B と同じ（セッション経由なのでキーレス） |
| **2. public 露出の是非** | ⚠️ 生成物が `site/`（public リポジトリの main 履歴）に焼き込まれる。**#189/#202（コスト実額を公開ブランチに残した事故）と同じ失敗パターンに最も近い**。「集計値だけを出す」規律を CI ワークフロー側で機械的に守らせる必要がある | ✅ `telemetry/worker-usage` と同じ隔離パターンを流用できる。**main を汚さず、コード履歴と分離**。README で「利用者を識別する情報は含まない」を明文化する前例が既にあり、WAE 版でも同じ宣言を継承できる | ⚠️ レスポンス自体は都度生成なので静的な履歴汚染は無いが、**エンドポイントの応答内容がそのまま無制限に公開される**（キャッシュしない限り誰でも何度でも生の集計を引ける） | ⚠️ A と同じ懸念（main の `site/` に直接コミットする実装なら履歴汚染。**データブランチに書くなら B と同一**） |
| **3. 更新頻度・鮮度** | ◎ cron 間隔を自由に設定できる（例: 日次〜数時間おき）。ただし `pages.yml` は `site/**` push で毎回 Pages 再デプロイが走る（既存の LP 更新と衝突・無関係な差分でも再デプロイが走る） | ○ 既存のスプリントルーティン（`record_worker_usage.py` と同じ Step で叩ける）の実行頻度に依存。セッションが無い日は更新されない（`session-sprint-rules.md`「対象がないセッションは no-op」）が、テレメトリ専用データブランチは既にこの前提で運用中 | ◎ 常にライブ（アクセス時点の最新値） | ○ B と同じ（ルーティン頻度依存） |
| **4. 障害時の劣化** | △ ワークフロー失敗時は最後に成功したデプロイのまま止まる（サイレント劣化。失敗通知が無いと気づきにくい） | ◎ JSON に `last_updated` を持たせれば「最終更新日時」を出しつつ古いデータのまま表示できる（`record_worker_usage.py` が既にこの設計）。**空白・エラー画面にならない** | ✗ クエリ失敗が **その場でユーザーに見えるエラー/空白** になりうる。リトライ・キャッシュ層を別途設計しないとダッシュボードの可用性が WAE SQL API の可用性に直結する | ◎ B と同じ |
| **5. 追加の攻撃面** | ✅ 新規エンドポイント無し（CI から呼ぶだけ） | ✅ 新規エンドポイント無し（静的 JSON 取得のみ） | ❌ **未認証の新規公開エンドポイントが増える**。#207（`GET /auth/login` の可用性防御）と同種の問題が確実に再発する: WAE SQL API の無料枠は **読み取り 10,000 クエリ/日**（本調査メモ §2）で、書き込み 100,000/日より一桁小さい。ダッシュボードアクセス 1 回 = 1+ クエリなら、bot・スクレイパーに数千アクセスされただけで枠を食い潰しうる。防ぐには新たな Rate Limiting binding・キャッシュ層の追加実装・保守が要る（＝「1 箇所しか使わない抽象化を先回りしない」YAGNI とも逆行するコスト増） | ✅ 新規エンドポイント無し |

### 推奨: **案 B**（B と D は実質同型。実装は「定期セッションが Cloudflare MCP で WAE を叩き、`telemetry/worker-usage` と同じ隔離パターンの新規データブランチ（例: `telemetry/wae-usage`）へ push → ダッシュボード JS がそのブランチの JSON を取得」）

**理由（軸別の決め手）**:
- 軸 1（トークン露出）: A・C は程度の差はあれ長期キーの新規常駐を生むが、**B/D は既存の OAuth 認可 MCP を再利用するだけでキーレス方針と完全に整合する**。これが最大の決め手。
- 軸 2（public 露出）: 新規データブランチを `telemetry/worker-usage` と同じ「main と分離・README で非個人情報を宣言」パターンで作れば、#189/#202 の再発防止規律をそのまま継承できる。
- 軸 5（攻撃面）: C は #207 と同種の「未認証エンドポイントが無料枠を食い潰す」構造的リスクを新設する。**このプロジェクトは既に「クライアントは静的資産のみ・状態を持つ処理は認証必須」の設計（`worker/index.ts` の `resolveTokens` パターン）を貫いており、C はその設計原則から外れる**。

**晒してよい指標 / 晒すべきでない指標の線引き（案 B 前提）**:
- ✅ 晒してよい: 日次・週次・月次の **集計値のみ**（総リクエスト数・エラー数・ユニークカウント等の丸めた数値）。`telemetry/worker-usage` の既存公開実績（requests/errors/subrequests）と同水準。
- ❌ 晒すべきでない: 個票・行レベルデータ、IP や識別子そのもの、**コスト・課金の実額**（#189/#202 の直接の再発条件）、`_sample_interval` 補正前の生カウント（誤読を招く）。

**実装時の付帯論点（ブロッカーではないが記録推奨）**:
- `site/`（LP）には現状 `_headers` も CSP も無い（`public/_headers` はアプリ側 SPA 用で別物）。案 B でダッシュボード JS が `raw.githubusercontent.com` 等へ fetch するなら、**最小限の CSP（`connect-src` を取得先ドメインだけに限定）を `site/` にも新設**するのが望ましい（LP の攻撃面を広げない防御）。
- データブランチを GitHub Pages で直接公開する案（別 Pages ソース）も検討可だが、`pages.yml` は現状 `site/**` 限定・単一ソースのため、素直には `raw.githubusercontent.com` 経由 fetch が最小変更。

### `dashboard-ux` — 主張
<sub>2026-08-03T10:17:45+09:00</sub>

## dashboard-ux: ダッシュボード UI/UX 提案（WAE 導入前提）

前提整理: `content/research/2026-08-03-workers-analytics-engine.md` によると WAE は **可視化 UI が無い**・**index は 1 データポイントにつき 1 個**・**保持 3 か月**・**ローカル開発で binding 動作せず**。既存の `#235`（`telemetry/worker-usage`）と同じ「ルーティンが集計してデータブランチにサマリー（静的 JSON/HTML）を残す」動線が前提になる、つまり **本ダッシュボードはライブクエリではなく静的スナップショット**になる可能性が高い。この前提は UI 設計（「更新中」表現・自動リフレッシュの有無）に直結するので、data-pipeline の結論と要すり合わせ。

### 1. 日次/週次/月次の切り替え UI 分析ダッシュボードは全期間が「同一データの異なる集計粒度」であり、別コンテンツへのナビゲーションではない。UI パターン研究では **tabs は別コンテンツへの遷移、segmented control は同一コンテンツの表示切替**と明確に区別されており、「2〜5 個の相互排他な選択肢を同時に見せたい」場面は segmented control が適切と整理されている（[Segmented Control UI: Best Practices](https://www.eleken.co/blog-posts/segmented-control-ui)、[Mobbin: Segmented Control](https://mobbin.com/glossary/segmented-control)）。日付範囲ピッカー（カレンダー UI）は「任意の日付を選ぶ」用途（予約・スケジューリング）向けで、事前集計済みの 3 粒度（日次/週次/月次）から選ぶだけの本ケースには過剰（[Mobbin: Date Picker](https://mobbin.com/glossary/date-picker)）。

**採用案**: `<input type="radio">` + CSS 隣接セレクタで実装するネイティブ segmented control。JS 依存ゼロで動く（D-6 と site/ の「依存ゼロの静的ファイル」方針に完全一致）。`site/` は静的スナップショットなので、3 粒度分のデータをビルド時に全部埋め込み、切替は表示/非表示の CSS トグルだけで完結できる。キーボード操作もラジオボタンのネイティブ挙動（矢印キー）でそのまま担保でき、D-9 のアクセシビリティ要件を追加実装なしで満たす。

```html
<div class="period-switch" role="radiogroup" aria-label="集計期間">
  <input type="radio" name="period" id="period-daily" checked>
  <label for="period-daily">日次</label>
  <input type="radio" name="period" id="period-weekly">
  <label for="period-weekly">週次</label>
  <input type="radio" name="period" id="period-monthly">
  <label for="period-monthly">月次</label>
</div>
```
CSS: `#period-daily:checked ~ .panel--daily { display:block }` 式で 3 パネルを出し分け。既定は **週次**（日次はノイズが多く、月次は直近トレンドが薄い。プロジェクト規模＝1 日平均 63 リクエストでは週次が最も「意味のある変化」が見える粒度）。

### 2. 最初の画面: KPI カード認知負荷研究では「人は一度に 5〜9 項目しか処理できない」とされ、業界コンセンサスは **1 ビューあたり 5〜7 個**（[ClearPoint: KPI Dashboard Best Practices](https://www.clearpointstrategy.com/blog/kpi-dashboard-best-practices)、[Winning Presentations](https://winningpresentations.com/kpi-dashboard-presentation-five-metrics/)）。エンタープライズダッシュボードの実践知見も「上段に主要 KPI 4〜6 個」を推奨（[EPC Group: Power BI KPI Guide](https://www.epcgroup.net/power-bi-kpi-visuals-dashboard-guide-2026)）。また KPI カードは **Vanity Metrics ではなく Actionable Metrics のみ**を載せるべきで、値の変化が具体的なアクションに直結しない指標は外す（[Fanruan: KPI Card Design](https://gallery.fanruan.com/kpi-card-example)）。

**採用案（4 枚・D-10 の意図的ミニマリズムと整合）**:
1. **起票成功数**（選択期間の合計・前期間比 %）— コア KPI（project-mission.md の起票 KPI に直結）
2. **起票成功率**（成功 / 試行）— 4xx/5xx 失敗の可視化。デザインガイドライン D-7「入力を失わせない」の効果測定
3. **応答時間 p95**（doubles に記録があれば）— NN/g 応答時間閾値（design-guidelines.md §0 で 1 秒閾値を採用済み）との整合を見せる
4. **ユニークデバイス数**（`count(DISTINCT index)`）— ただし `_sample_interval` 補正対象外で高頻度書き込み時は過小評価になりうる（調査メモ §6）。**カード内に小さく「概算」バッジを常設**し、正確な値であるかのような誤解を防ぐ（正直な表示は §4 参照）

各カードにスパークライン（語サイズの極小折れ線）を添えて、見出し数値が「急上昇/急落/横ばいのどの文脈にあるか」を一目で示す（[Fanruan](https://gallery.fanruan.com/kpi-card-example)）。5 枚目以降（エラー種別内訳など）は「詳細」リンクの先（別セクション）に格納し、初見 5 秒でコアが分かる状態を守る（[think.design: Dashboard Design in 2026](https://think.design/blog/dashboard-design-in-2026-dos-and-donts/)）。

### 3. グラフの型時系列は **棒グラフ**を既定にする。理由: ① 日次・週次のような離散カウントは棒の方が個々の値の比較・ゼロとの区別がしやすい ② 3 か月保持なので日次でも最大約 90 点、月次では 3〜12 点と少なく、線の「連続性の錯覚」より棒の「離散事実」の方が本データの性質に正直（Tufte のデータインク比原則にも整合。装飾線・グリッド線・凡例枠を最小化し、値そのものを伝える面積を最大化する）。月次のみ、粒度が粗く比較対象が少ないため折れ線でトレンドの傾きを見せる方が読みやすい（好みが分かれる領域だが、離散点が少ない月次は線でも棒でも実害は小さい）。

KPI カードのスパークラインは折れ線（極小サイズでは棒より線の方が視認性が高い、業界標準パターン）。

依存ライブラリ: **導入しない**。理由は D-6（追加ライブラリゼロを先に検討）と `site/` 全体の「依存ゼロ・ビルド不要」方針、かつアプリ側 size-limit 80KB brotli 予算の対象外だが同じ思想を LP にも適用すべき。日次最大 90 点・週次 13 点・月次 12 点程度の小規模データなら、ビルド時（ルーティン実行時）に Python/Node で `<svg><rect>`/`<path>` を直接生成する自前 SVG で十分に足りる。Chart.js 等の JS ランタイムライブラリは「静的スナップショットを表示するだけ」の用途にはオーバースペック。

### 4. 空状態・欠測・サンプリング済みデータの正直な表示欠測データの可視化研究では、**棒グラフでは zero-fill（ゼロ埋め）の方が平均値の認知精度が高い**が、**折れ線グラフでは色でハイライトした「欠測区間」を明示する方が信頼性評価が高い**（[Where's My Data? (Song, VIS 2018)](https://cmci.colorado.edu/visualab/papers/song_VIS_2018.pdf)）。本ダッシュボードは主表示が棒グラフのため、**「データ収集前」と「収集したが 0 件」を視覚的に区別した上でゼロ埋め**する設計を採る:

- **収集したが 0 件**: 通常色の極小バー（ベースラインに 2px 程度の高さを残し「存在するが 0」と分かるようにする。完全に消すと軸線と区別がつかない）
- **WAE 導入前 / データ欠落**: 斜線ハッチングまたは低透明度の同色バー + ホバー/フォーカスで「データなし（計測開始前）」ツールチップ。色だけに依存しないよう **パターン（ハッチング）を併用**（D-9 のアクセシビリティ要件と直結）
- **サンプリング発生**: 調査メモ §4/§6 の通り、現トラフィック（1 日平均 63 件）では基本発動しないが、将来のトラフィック増に備えて `_sample_interval > 1` の日には棒の右肩に小さいドット記号を付け、ツールチップで「この値は推定補正済みです」と明示する（Designing for Disclosure の「disclosure gap」を埋める設計・[arXiv 2508.08383](https://arxiv.org/html/2508.08383)）
- **軸は必ずゼロ始点**（Y 軸切り詰めによる誇張を避ける。過去のバグ報告で頻出する「truncated y-axis」問題を最初から回避)
- ページ全体のヘッダーに **「最終更新: {JST 日時}（静的スナップショット・自動更新なし）」** を明記し、「今まさにライブで見ている」という誤解を防ぐ（datetime-rules.md の JST 統一と整合）

### 5. アクセシビリティ- 色のみに依存しない: 上記ハッチングパターンに加え、KPI カードの増減表示は色（緑/赤）+ 矢印アイコン（▲/▼）+ テキスト（"+12%"）の 3 重表現にする
- コントラスト比: 既存 `--color-text` / `--color-text-muted` トークンをそのまま流用すれば `e2e/a11y.spec.ts`（axe-core）の 4.5:1 基準を満たす。グラフの棒色は accent/primary トークンをそのまま使い、新規カラーを持ち込まない（D-10・トークン一貫性）
- キーボード操作: §1 の radio ベース segmented control は追加実装なしでキーボード完全対応。カード・グラフ内のツールチップは `<button>` + `aria-describedby` で実装し、マウスオーバー専用にしない
- `prefers-reduced-motion`: 数値のカウントアップアニメーション・グラフの描画アニメーションを一切使わない（既定でも最小限という D-9・D-10 の方針に合わせ、そもそも動きを入れない設計が最もシンプル）。既存 `styles.css` の reduced-motion ブロックをそのまま踏襲

### 6. ダークモードLP 本体と同じ `prefers-color-scheme` 自動切替（トグル UI なし）を踏襲するのが一貫性の観点で正しい（既存 LP に手動テーマ切替 UI が無いため、ダッシュボードだけ切替 UI を足すと D-3/D-10 に反する新規要素になる）。グラフ固有で新規に必要なトークンはグリッド線・ツールチップ背景の 2 つのみ:
```css
--color-chart-grid: var(--color-border-subtle);
--color-chart-tooltip-bg: var(--color-surface);
```
既存の `:root` / `@media (prefers-color-scheme: dark)` ブロックに追記するだけで済み、新規デザインシステムを持ち込まない。

### 7. 全体ワイヤーフレーム（上から下)```
[ヘッダー] タイトル「利用状況」+ 最終更新 {JST} バッジ（静的スナップショット明記）
[期間セグメンテッドコントロール] 日次 / 週次 / 月次（radio+CSS、既定=週次）
[KPIカード行] 4枚グリッド（起票成功数 / 成功率 / p95応答時間 / ユニークデバイス数[概算]）
  各カード: 見出しラベル + 大きい数値 + 前期間比(色+矢印+%) + 極小スパークライン
[メイン時系列グラフ] 選択期間の棒グラフ（0件=極小バー／欠測=ハッチング／サンプリング=ドット注記）
  凡例: 色ではなくパターンも併記した簡潔なキャプション1行
[詳細セクション（任意・折りたたみ<details>）] エラー種別内訳・生データCSVリンク等
[フッター注記] データ保持3か月・サンプリング方式・WAE公式ページへのリンク
```

### 出典一覧
- [Segmented Control UI: Best Practices](https://www.eleken.co/blog-posts/segmented-control-ui)
- [Mobbin: Segmented Control](https://mobbin.com/glossary/segmented-control)
- [Mobbin: Date Picker](https://mobbin.com/glossary/date-picker)
- [ClearPoint: KPI Dashboard Best Practices 2026](https://www.clearpointstrategy.com/blog/kpi-dashboard-best-practices)
- [Winning Presentations: 5 metrics vs 15](https://winningpresentations.com/kpi-dashboard-presentation-five-metrics/)
- [EPC Group: Power BI KPI Visuals & Dashboard Guide 2026](https://www.epcgroup.net/power-bi-kpi-visuals-dashboard-guide-2026)
- [Fanruan: KPI Card Design](https://gallery.fanruan.com/kpi-card-example)
- [think.design: Dashboard Design in 2026](https://think.design/blog/dashboard-design-in-2026-dos-and-donts/)
- [Song et al., "Where's My Data? Evaluating Visualizations with Missing Data" (VIS 2018)](https://cmci.colorado.edu/visualab/papers/song_VIS_2018.pdf)
- [Designing for Disclosure in Data Visualizations (arXiv 2508.08383)](https://arxiv.org/html/2508.08383)
- 社内: `content/research/2026-08-03-workers-analytics-engine.md`（WAE の SQL API・サンプリング仕様・保持期間）
- 社内: `docs/design/design-guidelines.md`（D-1〜D-10・数値基準）

### `privacy-identity` — 主張
<sub>2026-08-03T10:18:05+09:00</sub>

# privacy-identity: WAE index 設計とプライバシー帰結（Round 1）

## 前提の確認

- `bundle.u`（GitHub 数値ユーザー ID）は既に `TOKEN_ENCRYPTION_KEY` で HMAC 化され、
  レート制限・連投抑止のキーとして **秒〜10 秒オーダーの保持** で使われている
  （`worker/index.ts` `rateLimitKey` / `duplicateSubmissionKey`・stateless-architecture.md §6.1）。
  これは「カウンタだけを短時間持つ」設計で、法的にも実務的にもリスクが低い。
- WAE の index は **1 データポイントにつき 1 個・96 バイト・保持 3 か月**。
  「日次・週次・月次」を 1 個の index だけで賄うことはできない（期間ごとに別の index 値が要る）。
- GDPR/APPI の前提: **鍵付きハッシュ（HMAC）は「匿名化」ではなく「仮名化」**。
  鍵を保持し、かつ書き込み時点で元の GitHub ユーザー ID から自前で HMAC を計算している以上、
  「第三者は復元できない」は真でも「当社（鍵の保持者）は再識別できる」が常に真になる。
  → **どの HMAC 案も法的には個人データ／個人関連情報として扱うべき**（仮名加工情報の要件
  （元データとの照合表廃棄等）は満たさない。単に「復元困難」なだけ）。

## 選択肢比較

### 案 1: 日次ソルト付き HMAC（期間ごとに異なる鍵材料）

- 実装: `index = base64url(HMAC(TOKEN_ENCRYPTION_KEY, "analytics-{daily|weekly|monthly}:{期間ラベル}:{userId}"))`
  を **期間ごとに 3 回書き込む**（1 データポイント 1 index の制約への対処。書き込み予算は
  現状 63 req/日 × 3 = 189/日 で Free 枠 100,000/日 に対して誤差）。
- ①ステートレス約束を破るか: **部分的に破る**。単発カウンタ（10 秒）とは性質が異なり、
  「その期間内に誰が来たか」を再現可能な形で **3 か月** 持つ。ただし期間をまたぐ相関は
  鍵を持つ者にしかできない（第三者の SQL API 閲覧だけでは日次⇄週次⇄月次を繋げられない）。
- ②ポリシー追記: **必要**（§1 収集するデータ・§3 利用目的・§5 に新規記載）。
- ③個人データ該当性: **該当**（仮名化データ。当社が鍵を持ち再識別可能なため）。
- ④WAE 制約適合: 適合するが **3 回書き込みの設計変更が要る**。
- ⑤鍵: 既存 `TOKEN_ENCRYPTION_KEY` を prefix 分離で流用可能（既存 3 用途と同じパターン）。
  ただし **#208（HKDF 未対応）** の下では、鍵漏えい時に「特定の GitHub ユーザー ID について
  過去 3 か月のどの期間に活動していたか」を攻撃者が再計算で復元できる。これは既存 3 用途
  （即時失効するレート制限カウンタ）より **保持期間が長い分だけ実害が大きい新しいリスク面**。
  #208 のクローズを本機能の前提条件にするか、少なくとも「鍵漏えい時の影響範囲が拡大する」
  ことをリスク台帳に明記すべき。

### 案 2: IP ベース

- 生 IP を index にする案は論外（明確な個人データ・複数人共有 IP で精度も低い）。
- HMAC 化 IP も、stateless-architecture.md #207 で既に指摘済みの通り **IPv4 は 2^32 空間しかなく
  鍵漏えい時は全数探索で復元しうる**（GitHub ユーザー ID より脆弱）。IP は「誰が来たか」の
  代理指標としても粒度が粗い（NAT・キャリア CGNAT で同一 IP に多人数、外出先で複数 IP）。
- ①ステートレス約束: 破る。②ポリシー: 要追記。③個人データ: 該当（IP アドレスは GDPR/APPI とも
  個人データ性が明確）。④WAE 適合: するが精度が悪い。⑤鍵: 流用可能だが上記の理由で **非推奨**。
- **却下**: user-ID 系より優れている点が無く、リスクだけ高い。

### 案 3: 既存の認証 Cookie 由来 ID（`bundle.u`）をそのまま／固定鍵 HMAC で流用

- 生の `u` をそのまま index にする案は論外（GitHub ユーザー ID が索引に平文で載る＝
  完全に個人データ・即アウト）。
- 固定鍵（期間ローテーションなし）の HMAC にしても、**同一の擬似 ID が 3 か月間ずっと同じ値**
  になる。これは `count(DISTINCT index)` で日次・週次・月次の集計はできるが、副作用として
  **「この擬似 ID が来た日を SQL API で全部並べる」だけで、D1 で持っていたのと実質同じ
  3 か月分の個人別アクティビティ履歴が再構成できてしまう**。
- これは D1 撤去（P1〜P4）の動機そのもの（「消えないデータが増え続ける」「永続層をなくす」）
  に真っ向から反する。案 1（期間ローテーション）より **明確に悪い**（期間をまたぐ相関を
  鍵なしでも SQL クエリだけで誰でも作れてしまう）。
- **却下**: 固定鍵で 3 か月保持は、単一 index の制約を言い訳にして D1 相当のものを
  WAE の名前で作り直すことになる。

### 案 4: 数えない（リクエスト数・起票成功数のみ計測）

- index には個人由来の値を一切置かない（例: `"issue_success"` / `"issue_fail"` / `"request"`
  のような固定の区分ラベルのみ。GitHub ユーザー ID・IP は書き込まない）。
- ①ステートレス約束: **完全に守る**（個人データが一切発生しない）。
- ②ポリシー追記: **不要**（個人データを扱わないため現行の「サーバーは保存しない」記述と矛盾しない）。
- ③個人データ該当性: **非該当**（そもそも個人由来の値が無い）。
- ④WAE 制約適合: 最も単純に適合（index の 96 バイト制約・3 か月保持のいずれも気にする必要がない）。
- ⑤鍵: **不要**（TOKEN_ENCRYPTION_KEY を触らないため #208 のリスク拡大が起きない）。
- 失うもの: 「ユニーク利用者数」は取れない（取れるのはリクエスト数・起票成功数の推移のみ）。
  ただし調査メモ §7 が言う残課題は「①可視化 UI ②識別子の設計」であり、②を最初から
  発生させないのが最も確実な解決になる。

## 推奨

**案 4（数えない）を推奨する。**

理由:
1. `docs/design/stateless-architecture.md` の決定（「サーバーに個人データを一切保持しない」
   「シンプルさを優先する」）と完全に整合し、プライバシーポリシー改訂も不要（変更コスト最小）。
2. 「ユニーク利用者数」は本アプリの KPI として必須ではない（ミッションは PAT レスの起票体験で
   あり、成長分析基盤ではない）。リクエスト数・起票成功数の推移だけでも「使われているか」
   「起票が失敗していないか」は十分観測できる。
3. 案 1・案 3 はどちらも「仮名化データ＝法的には個人データ」という土俵から抜けられず、
   ポリシー改訂・鍵管理（#208 未解決のまま拡張）という追加コストを払う一方、得られる価値
   （ユニーク利用者数）は代替不能なほど大きくない。

**ただし、プロダクト側がユニーク利用者数を本当に必要とするなら**、次点は **案 1（期間ごとに
異なる鍵材料の HMAC・3 回書き込み）**。その場合の必須条件:
- プライバシーポリシー §1 / §3 / §5 に追記（文案は下記）。
- `docs/design/stateless-architecture.md` に「例外的に 3 か月保持する仮名化 ID」として明記し、
  D1 撤去の原則からの逸脱であることを自覚的に記録する。
- #208（HKDF による用途別鍵分離）を本機能とセットで検討する。少なくとも「鍵漏えい時、
  過去 3 か月の期間別アクティビティが再計算で分かる」というリスクをリスク台帳・Issue に残す。
- 案 3（固定鍵・非ローテーション）は選ばない。

## プライバシーポリシー追記文案（案 1 を採用する場合のみ）

`src/i18n/translations.ts` の `privacy.sections`（日本語版）向け。英語版は対で追記要。

### §1 収集するデータ に追加する箇条書き

> 利用状況の把握のため、GitHub のユーザー ID から日次・週次・月次それぞれ異なる秘密鍵付き
> ハッシュ（HMAC-SHA256）を作成し、Cloudflare Workers Analytics Engine に一時的な識別子として
> 送信します。ユーザー ID そのもの・Issue の内容・トークンは送信しません。

### §3 利用目的 の文末に追加

> …および利用状況の把握（日次・週次・月次のおおよその利用者数の集計）のためにのみデータを
> 利用します。

### §5（見出しを「5. サーバー基盤に残る記録・利用状況の集計」に変更し）新規段落

> 本アプリは、起票の成功回数やおおよその利用者数といった利用状況を把握するため、Cloudflare
> Workers Analytics Engine を利用しています。ここに送信するのは、GitHub のユーザー ID を
> 秘密鍵付きハッシュ（HMAC-SHA256）に変換した値のみで、ユーザー ID そのもの・アクセストークン・
> Issue の内容は含まれません。ハッシュの元になる鍵は日次・週次・月次でそれぞれ異なるため、
> この記録単体から期間をまたいで特定の利用者の行動を追跡することはできません。ただし、当社
> サーバーはこのハッシュを生成するための鍵を保持しており、法令上はこの値も個人データとして
> 取り扱います。データは Cloudflare 側で自動的に最長 3 か月で削除されます。

（英語版は上記と対応する内容を `privacy.sections`（en）に追記する。）

### `scope-delivery` — 主張
<sub>2026-08-03T10:18:16+09:00</sub>

# scope-delivery 主張（Round 1）— Epic + 子 Issue 分割案

## 0. 前提として拾った既存資産（新規実装を削る根拠）

- **`tools/record_worker_usage.py` + `tools/telemetry_branch.py`**（#235）が
  「定期取得 → マージ → `telemetry/*` データブランチへ plain git push（main を汚さない）」の
  パターンを既に確立・実戦投入済み。WAE 側の定期取得ツールは **このパターンをコピー改修すれば
  ほぼ新規設計が要らない**（月次 JSON・フィールド毎 max マージ・冪等 push・self-test の型は流用可）。
- **`docs/routines/sprint-session.md` Step 1.6** が「毎回のルーティンで使用量チェック + 履歴化」を
  すでに実行する定期実行動線。WAE の取得もここに 1 手順追加するだけで済み、**新しい定期実行の仕組み
  （cron・Scheduled Task）を新設する必要はない**。
- **`site/` + `.github/workflows/pages.yml`** が `site/**` push → GitHub Pages 公開まで完成済み
  （ビルド不要・静的ファイルそのまま公開・`main` からのみ公開）。ダッシュボードも
  **静的 1 ページを `site/` 配下に置くだけ**で新規インフラ不要。
- 上記より、**Epic の実装コストの中心は「WAE への計装（Worker 側コード変更）」と「取得ツール」であり、
  ダッシュボード自体は既存 LP と同じ薄い静的ページで足りる**。可視化 UI が無い（研究メモ §5）のは
  WAE 側の制約であって、こちら側で SPA やチャートライブラリを増設する理由にはならない。

## 1. Epic

**`feat: Workers Analytics Engine 導入 + GitHub Pages 利用状況ダッシュボード（日次/週次/月次）`**

- 参照: `content/research/2026-08-03-workers-analytics-engine.md` / 本議論 `wae-dashboard-20260803` / Issue #195
- 導入可否は決定済み。本 Epic は「どう作るか」のみを扱う
- 子 Issue はチェックボックスで列挙し、**着手順は依存関係どおり厳守**（後述）

## 2. 最初の 1 本で価値が出る最小構成（=初手で全部作ろうとする案への反論）

「WAE 導入 → 計装 → 取得ツール → データブランチ履歴化 → ダッシュボード表示」を **1 PR / 1 スプリントで
やろうとしない**。`session-sprint-rules.md` の 1 スプリント上限は `sp:8`（超えたら分割必須）であり、
上記を全部積むと確実に超える。むしろ **Child D 完了時点（日次サマリーだけが Pages に出る）が
最初の価値提供ライン**。週次・月次のトレンド表示、比較、フィルタは価値が出た後の第 2 弾でよい
（研究メモにも「見る運用が成立するか」が最大の不確定要素とある。まず 1 指標を出して運用が回るか
検証する方が、最初から週次/月次/フィルタまで全部作るより手戻りが少ない）。

## 3. 子 Issue 分割案

### Child A（最優先・全ての土台）

**`feat: WAE binding 導入と最小計装（ローカル no-op ガード込み）`**

- 内容: wrangler 設定に `analytics_engine_datasets` binding を追加。Worker 側で最小限のイベント
  （研究メモ §3: 1 データポイントに index 1 個・96B 以内 / blob 合計 16KB 以内）を書き込む。
  識別子・index/blob 設計そのものは **privacy-identity の結論に従う**（本 Issue は「配線」担当で
  「何を記録するか」は決めない・スコープを越境しない）
- **依存**: privacy-identity の識別子設計が本議論で consensus に達するまで着手不可（ブロッキング）。
  合意が本ラウンドで出ない場合、Child A は `status:blocked` で起票し議論の続きを待つ
- Done Criteria:
  - [ ] binding 未設定（ローカル/テスト環境）で `writeDataPoint` 呼び出しが例外を投げず no-op になることをテストで確認（研究メモ §3: ローカル開発では binding が動作しない、との仕様を実機/テストで裏取り）
  - [ ] 本番デプロイ後 `SHOW TABLES`（SQL API）で該当データセットの存在を実機確認
  - [ ] 1 リクエストあたりの `writeDataPoint` 呼び出し回数が Worker invocation あたりの上限（250）に対して明らかに余裕があることをコードレビューで確認
- SP: **sp:5**（新規領域＝初の WAE binding・実機検証必須・Dynamic 補正 +1〜2 を base sp:3 に加算）
- 機械検証: 上記 Done Criteria 3 点（テスト + 実機 SQL API 確認）。テストは `npm test`（既存テスト基盤に追加）

### Child B（A に依存）

**`feat: WAE 集計値の定期取得・テレメトリブランチ履歴化ツール`**

- 内容: `tools/record_worker_usage.py` のパターンを踏襲した `tools/record_wae_usage.py`
  （or 既存ツールへの機能追加。命名は data-pipeline の判断に委ねる）。SQL API から日次集計を取得し、
  `telemetry_branch.py` を再利用して `telemetry/worker-usage`（既存拡張）または新規データブランチへ
  push。`docs/routines/sprint-session.md` Step 1.6 に手順を 1 項目追記
- **依存**: Child A（データが書き込まれていないと取得できない）
- **保持 3 か月の制約**（研究メモ §3）に対する運用上の注意を Done Criteria に明記
- Done Criteria:
  - [ ] self-test PASS（マージ・冪等 push ロジックのユニットテスト。`record_worker_usage.py` の self-test と同水準）
  - [ ] 実機で SQL API を 1 回叩き、取り込み → push が成功し `git show origin/<branch>:...` でデータブランチへの反映を確認
  - [ ] `sprint-session.md` Step 1.6 に取得手順が追記され、次回ルーティン実行時に実際に取り込まれることを確認（=1 回の定期実行サイクルで実証）
- SP: **sp:3**（パターン流用のため base のみ。SQL API のレスポンス形状が事前確認と乖離した場合のみ次スプリントで +1 相当のフォロー Issue を切る）
- 機械検証: self-test + データブランチの diff 実在確認

### Child C（B に依存・最小価値スライス）

**`feat: 利用状況ダッシュボード最小版（日次サマリーのみ）を GitHub Pages に公開`**

- 内容: `site/` 配下に静的 1 ページ（例 `site/analytics/index.html`）を追加。
  直近 30 日の日次数値（requests / errors、WAE 由来の指標）をカード表示するだけ
  （グラフライブラリ・フィルタ UI・比較機能は入れない＝ YAGNI、後述§4）。データ供給経路
  （コミット時に JSON を焼き込むか、クライアント側で telemetry データブランチの raw JSON を fetch するか）は
  **data-pipeline / delivery-security の結論に従う**（本 Issue はどちらの案が確定しても差し替え可能な
  最小 UI に留める）
- **依存**: Child B（表示するデータが無いと作れない）
- Done Criteria:
  - [ ] 本番 Pages URL で直近 30 日の日次サマリーが表示されることを目視確認（`pages.yml` の `paths: site/**` により push だけで自動デプロイされる既存動線をそのまま使う）
  - [ ] データ未取得日・binding 未設定期間があっても表示がクラッシュしない（空データのフォールバック表示）ことを確認
- SP: **sp:3**（UI 自体は薄いが UX リサーチの反映が要るため base に留め、詳細見積もりは dashboard-ux に委ねる）
- 機械検証: 本番 URL の実機確認（スクリーンショット or curl でのレンダリング確認）+ 空データケースのユニット/E2E テスト

### Child D（C に依存・第 2 弾。MVP には含めない）

**`improvement: 週次/月次トレンド表示への拡張`**

- 内容: Child C の日次カードに、週次・月次の推移（例: 直近 4 週間の bar・直近 6 か月の月次合計）を追加。
  Child C が実際に運用され「見に行く習慣」が確認できてから着手する（研究メモの最大の不確定要素への対応）
- **依存**: Child C（の運用実績）
- Done Criteria:
  - [ ] 週次・月次の集計値が本番 Pages で表示されることを目視確認
  - [ ] 既存の `--summary` 集計ロジック（週 7 日 / 月次 JSON 単位）と数値が一致することをテストで確認（二重実装によるズレ防止）
- SP: **sp:3**
- 機械検証: 数値突合テスト + 本番目視確認

## 4. YAGNI として明示的に「作らない」

- **フィルタ UI（日付レンジピッカー・指標の絞り込み）**: 現状 1 人運用・低トラフィック（実測 1 日平均 63
  リクエスト）で、固定 3 粒度（日/週/月）を並べるだけで用が足りる。可変フィルタは「使われない管理画面」化
  するリスクが高く、子 Issue 化しない（要望が出たら改めて起票）
- **クライアント側のライブ再クエリ（WAE SQL API を毎回叩く動的ダッシュボード）**: 研究メモ §2 の通り
  課金軸は「クエリ **回数**」。自動リロードするダッシュボードは無料枠を無駄に消費するうえ、
  Pages はビルド不要の静的配信が前提（`pages.yml` の設計方針に反する）。**静的スナップショット
  （ルーティン実行のたびに更新）で十分**、というのが scope レンズの結論。この経路を採らない場合は
  delivery-security 側の API トークン公開リスクも同時に消える
- **Grafana 連携**（研究メモ §5 で言及される代替 UI）: 1 人 + AI 運用に外部ツールの追加運用対象を増やす
  だけで、GitHub Pages という完成済みの公開先がある以上不要
- **Child A で「利用者の識別子を多目的に汎用化する」実装**（複数の index 軸を先回りで用意する等）:
  1 箇所（このダッシュボード）でしか使わない抽象化を先回りしない。公式 FAQ（研究メモ §6）も
  「精度のために index を増やす」設計を非推奨としており、YAGNI と公式ガイダンスが一致する

## 5. 依存関係と着手順（まとめ）

```
privacy-identity の識別子設計 consensus（本議論内で確定）
  → Child A（WAE binding + 計装）
      → Child B（取得ツール + テレメトリ履歴化）
          → Child C（ダッシュボード最小版・日次のみ）※ここで初めてユーザーに見える価値が出る
              → Child D（週次/月次拡張・運用実績を見てから着手）
```

Child A 着手前に識別子設計が固まらない場合、Child A は `status:blocked` で起票し本議論の続きを待つ
（見切り実装をしない）。Child B/C/D は前工程の Issue がクローズするまで着手しない
（`sprint-session.md` Step 2 の「依存に未完了 Issue があればスキップ」に従う）。

## 6. オープンな依存（他レンズへの質問）

- **privacy-identity**: Child A の index/blob に何を入れるか（識別子の粒度・保持方針）が Round 1 で
  合意できるか。合意できないなら Child A を `blocked` にする前提で進めてよいか
- **data-pipeline**: Child B のデータブランチ設計（既存 `telemetry/worker-usage` に相乗りするか新設するか）
  と、Child C のデータ供給経路（コミット焼き込み vs クライアント fetch）の方針
- **delivery-security**: クライアント fetch 案を採る場合、`raw.githubusercontent.com` 経由の
  telemetry データブランチ直接参照は許容範囲か（API トークンを一切露出しない経路なので scope レンズとしては
  一番シンプルだが、セキュリティ観点の可否判断は委ねる）

### `data-pipeline` — 主張
<sub>2026-08-03T10:18:34+09:00</sub>

# data-pipeline: WAE スキーマ・集計クエリ・役割分担 案（R1）

## 1. WAE スキーマ（index 1 個・96B / blobs ≤20・16KB / doubles ≤20）

| フィールド | 内容 | 値の例 |
|---|---|---|
| **index1**（サンプリングキー） | `event_type`（意味のあるルート単位・低〜中カーディナリティ固定集合） | `issue_create` / `auth_login` / `auth_callback` / `auth_refresh` / `auth_logout` / `api_me` / `api_installations` / `api_repos` / `api_labels` / `account_delete` |
| blob1 | `outcome`（status + `jsonError.code` から粗く分類） | `ok` / `client_error` / `rate_limited` / `duplicate_blocked` / `auth_error` / `upstream_error` |
| blob2 | `traffic_source`（`ISSUE_RATE_LIMIT_RELAXED_ENABLED==="1"` から） | `prod` / `e2e` |
| blob3（**保留・privacy-identity 判断待ち**） | 擬似匿名セッション ID（DISTINCT 用） | 未定 |
| double1 | `duration_ms`（ハンドラ開始〜終了） | 12.4 |
| double2 | `status_code` | 200 / 401 / 429 |
| double3 | `is_error`（0/1、status≥400） | 0 / 1 |

**index を `event_type` にする理由**: WAE の equitable sampling は「同一 index 値内」で効く。route 単位にしておけば、まれなイベント（`account_delete` 等）は常に全件保持され、特定ルートが bot に叩かれて急増しても他ルートの精度は落ちない（`AUTH_LOGIN_RATE_LIMIT` の存在＝ログイン系が狙われる前提と整合）。現状トラフィック（63 req/日平均）ではサンプリングはまず発動しないが、将来の耐性として妥当。

**意図的に含めないもの**: repo フルネーム・Issue の title/body/labels（プライバシー・容量の両面で不要）。「どのリポジトリで使われているか」が要るなら raw ではなく HMAC バケット化を別途検討（MVP スコープ外）。

**blob3（ユニーク利用者数）は決定を privacy-identity に委ねる**: 研究メモ §6 の通り `count(DISTINCT)` はサンプリング補正の対象外＆低トラフィックでは実害なし。ただし HMAC でも「同一鍵が 3 か月分の挙動データに紐付く」のは、既存のレート制限キー（ウィンドウ内のみのカウンタ）より踏み込んだ保持になる。技術的には可能という設計だけ置き、採否は不参加。

## 2. writeDataPoint の挿入点（`worker/index.ts`）

ルート別に埋め込むのではなく、SECURITY_HEADERS ミドルウェアの直後に 1 箇所だけ追加する（既存の全ハンドラを変更しない）:

```ts
const EVENT_TYPE_BY_PATH: Record<string, string> = {
  "/api/issues": "issue_create", "/auth/login": "auth_login",
  "/auth/callback": "auth_callback", "/auth/refresh": "auth_refresh",
  "/auth/logout": "auth_logout", "/api/me": "api_me",
  "/api/installations": "api_installations", "/api/repos": "api_repos",
  "/api/labels": "api_labels", "/api/account": "account_delete",
};
app.use("*", async (c, next) => {
  const eventType = EVENT_TYPE_BY_PATH[new URL(c.req.url).pathname];
  if (!eventType || !c.env.ANALYTICS) return next(); // /api/health, /api/ready 等は対象外・binding 未設定は no-op
  const t0 = Date.now();
  await next();
  try {
    c.env.ANALYTICS.writeDataPoint({
      indexes: [eventType],
      blobs: [outcomeOf(c.res.status), c.env.ISSUE_RATE_LIMIT_RELAXED_ENABLED === "1" ? "e2e" : "prod"],
      doubles: [Date.now() - t0, c.res.status, c.res.status >= 400 ? 1 : 0],
    });
  } catch { /* observability は best-effort。失敗させない */ }
});
```

`wrangler.jsonc` に `analytics_engine_datasets: [{ binding: "ANALYTICS", dataset: "gis_usage" }]` を追加、`worker/types.ts` に `ANALYTICS?: AnalyticsEngineDataset` を追加（`?` はローカル/vitest-pool-workers で binding が無い可能性への保険・要実機確認）。`/api/ready` の `checks` には **含めない**（rate limiter 等のセキュリティ制御と違い、analytics 欠落はアプリの安全性に無関係。誤ってハードゲート化しない）。

## 3. 集計クエリ（サンプリング補正込み・`gis_usage` 想定）

```sql
-- 日次（直近30日・イベント種別×結果）
SELECT toDate(timestamp) AS day, index1 AS event_type, blob1 AS outcome,
       SUM(_sample_interval) AS requests,
       SUM(double3 * _sample_interval) AS errors,
       round(SUM(double1 * _sample_interval) / SUM(_sample_interval), 1) AS avg_duration_ms
FROM gis_usage
WHERE timestamp > NOW() - INTERVAL '30' DAY AND blob2 = 'prod'
GROUP BY day, event_type, outcome ORDER BY day DESC, event_type;

-- 週次（直近12週）
SELECT toStartOfWeek(timestamp, 1) AS week_start, index1 AS event_type,
       SUM(_sample_interval) AS requests, SUM(double3 * _sample_interval) AS errors
FROM gis_usage
WHERE timestamp > NOW() - INTERVAL '12' WEEK AND blob2 = 'prod'
GROUP BY week_start, event_type ORDER BY week_start DESC, event_type;

-- 月次（保持上限 3 か月ぶん）
SELECT toStartOfMonth(timestamp) AS month_start, index1 AS event_type,
       SUM(_sample_interval) AS requests, SUM(double3 * _sample_interval) AS errors
FROM gis_usage
WHERE timestamp > NOW() - INTERVAL '3' MONTH AND blob2 = 'prod'
GROUP BY month_start, event_type ORDER BY month_start DESC, event_type;
```

**要実機確認**: `toDate`/`toStartOfWeek`/`toStartOfMonth`・`NOW() - INTERVAL` の正確な構文は WAE SQL API（ClickHouse 系）で未検証（研究メモは aggregate 関数のみ実測確認済み）。実装 Issue で `SELECT 1` 系の疎通確認クエリから始めて構文を確定させる。
**`blob2='prod'` フィルタは必須**: E2E（`ISSUE_RATE_LIMIT_RELAXED_ENABLED=1`）のトラフィックを混入させない。これが無いと playwright の反復リクエストがダッシュボードの数字を汚染する。
**日付境界は UTC のまま**（JST 変換しない）: 既存 `record_worker_usage.py` の日次値・無料枠リセット（UTC 00:00）と揃える判断（datetime-rules.md は表示系は JST 原則だが、本件は Cloudflare 側の機械境界に合わせる整合性を優先。異論あれば表示層だけ JST 変換する代替可）。

## 4. #235 との役割分担（二重の真実源を作らない）

- **総リクエスト数の正本は既存経路のまま**（`workersInvocationsAdaptive` → `record_worker_usage.py` → `telemetry/worker-usage`）。無料枠 Warning/Critical 判定もここが継続担当。
- **WAE では総リクエスト数を「再計測」しない**。理由: ① 対象ルートの一致範囲が微妙に異なる（静的アセットは元々 Worker を経由しない点は共通だが、`/api/health`・`/api/ready` を WAE 側は意図的に除外する設計のため単純合算しても既存の値と一致しない）② サンプリングの有無で数値のブレ方が違う → 同じ「requests」という名前で 2 系統の数字が出ると事故る。
- **WAE が持つ付加価値は「既存経路が取れない軸」だけ**: `event_type × outcome` の内訳、レイテンシ、（採用されれば）ユニーク系。ダッシュボードは両方を並べて出す（総数は telemetry/worker-usage、内訳は WAE 由来と明示）。

## 5. 3 か月保持 と自前履歴化

- 新規ファイル `tools/record_wae_usage.py` を追加（`telemetry_branch.py` の `push_entries`/`sync_remote_ref`/`read_local_jsons`/`json_at` をそのまま再利用・commit_cost_telemetry.py と同じ薄いラッパー）。
  - **既存 `record_worker_usage.py` を拡張しない理由**: データ形状が別物（GraphQL の `workersInvocationsAdaptive` 配列 vs SQL API の行×`event_type`×`outcome` の多次元集計）。`extract_daily`/`merge_month` は「1 日 1 レコード」前提で、多次元キーを混ぜると self-test も含め責務が濁る。commit_cost_telemetry.py / record_worker_usage.py が既に「別ソース＝別スクリプト・共有は低レベル永続化層のみ」という前例を作っている。
  - **ブランチは新設しない**: 同じ `telemetry/worker-usage` ブランチ内に新ディレクトリ `content/analytics/worker_usage_by_event/YYYY-MM.json`（週次集計・粒度は日×event_type×outcome の SUM 済み件数のみ、生イベントは残さない＝WAE の 3 か月保持を超えて個票が残らない）。
  - 実行頻度は **週次**（Step 1.6 の `--report-due` と同じケイデンスに相乗り）。毎スプリントではなく、クエリ回数と git 差分を抑える。
- ダッシュボード（GitHub Pages）は **ビルド時にこのデータブランチ 2 本（`telemetry/worker-usage` の総数 + 新設ディレクトリの内訳）を読んで静的生成**。ページ配信時に WAE を直接叩かない（Cloudflare API トークンをクライアントに渡さないため必須）。

## 6. 無料枠（クエリ 10,000 件/日）を守る呼び出し設計

- WAE への SQL 呼び出しは **ルーティン実行時のみ**（Cloudflare API token を持つのはセッション側。GitHub Pages 静的サイトからは絶対に呼ばない＝上記 §5 の帰結）。
- 1 回のルーティン実行で **日次・週次・月次の 3 クエリのみ**（`GROUP BY GROUPING SETS` で 1 クエリに統合できるか実装時に確認、できなければ 3 クエリのまま。要実機確認）。
- **週次にしか push しない**（§5）ため、クエリ自体も週次でよい可能性が高い。ただし当日の異常検知（急激なエラー増）に使うなら日次クエリだけ毎回実行し、週次・月次クエリは `--report-due` の日だけ叩く、という非対称頻度が無料枠にもっとも優しい。
- 試算: 週次 3 クエリ × 週 1 回 ≈ 3 件/週。日次 1 クエリ × 毎スプリント（1 日に複数セッションでも数件〜数十件）でも 10,000 件/日には遠く及ばない。

## サマリー

index=`event_type`（低カーディナリティ固定集合）・blob1=`outcome`・blob2=`traffic_source`（E2E 除外に必須）・double1-3=duration/status/is_error という最小スキーマを提案。総リクエスト数の正本は既存 `record_worker_usage.py` のまま変更せず、WAE は「内訳・レイテンシ」専用に限定して二重の真実源を回避。履歴化は `telemetry_branch.py` を再利用する新規薄いスクリプト（同一ブランチ・新ディレクトリ）で週次実行し、クエリ無料枠は静的サイトから直接叩かない設計で自然に守られる。ユニーク利用者数（blob3 候補）は privacy-identity の判断待ちとして未確定のまま提示。
