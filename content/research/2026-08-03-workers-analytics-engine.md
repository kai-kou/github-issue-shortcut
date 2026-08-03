# Workers Analytics Engine（WAE）調査メモ

> 調査日: 2026-08-03 JST。一次情報（developers.cloudflare.com / changelog）に基づく。
> 主要数値は本セッションで直接 WebFetch して裏取り済み（pricing / aggregate-functions）。推測は明記する。
> 用途: Issue #195（利用状況計測の再評価）および WAE 導入・ダッシュボード実装の設計材料。

## 1. WAE とは / ステータス

- Worker から **非同期・高カーディナリティ** なイベントを書き込み、**SQL API** で集計する時系列分析基盤。
  公式表現は "unlimited-cardinality analytics at scale"。
  出典: https://developers.cloudflare.com/analytics/analytics-engine/
- 書き込みは `env.<BINDING>.writeDataPoint({ indexes, blobs, doubles })`。**非ブロッキング**（`await` 不要）。
  出典: https://developers.cloudflare.com/analytics/analytics-engine/get-started/
- GA/ベータの明示表記は現行ドキュメントに無い（2024-04 の D1 GA 告知と同時に WAE のアップデートが
  announced された経緯あり）。**推測**: 定常運用されているが「GA」ラベルの一次確認は取れていない。

## 2. 料金（実測確認: pricing ページ・最終更新 2026-04-23）

| プラン | データポイント書き込み | 読み取りクエリ |
|---|---|---|
| **Workers Free** | **100,000 件/日** まで込み | **10,000 件/日** まで込み |
| **Workers Paid**（$5/月〜） | 1,000 万件/月 込み・超過 **$0.25 / 100 万件** | 100 万件/月 込み・超過 **$1.00 / 100 万件** |

- **Free プランで利用可能**（Paid 移行は不要）。
- 公式の明記: **"Currently, you will not be billed for your use of Workers Analytics Engine."**
  → 2026-08-03 時点で **課金は未開始**（将来の価格を先出ししている状態）。
- 課金軸は「書き込み数」と「クエリ **回数**」のみ。**クエリの複雑さ・カーディナリティでは課金されない**。
  裏返しとして、自動リロードするダッシュボードは **クエリ回数** で無料枠を食う。
  出典: https://developers.cloudflare.com/analytics/analytics-engine/pricing/

### 本プロジェクト規模での試算

実測（2026-07-13〜08-02）は 30 日で 1,317 requests・1 日平均 63。1 リクエスト = 1 データポイントでも
Free 枠 100,000 件/日 に対して **約 0.06%**。読み取りもルーティンが 1 日数回叩く程度なら
10,000 件/日 の枠に対して誤差。**コストは実質ゼロ**。

## 3. 制限（limits ページ）

| 項目 | 値 |
|---|---|
| **データ保持** | **3 か月** |
| 1 データポイントあたり blobs | 最大 20 個・**合計 16KB**（2025-06-20 に 5KB→16KB へ引き上げ） |
| 1 データポイントあたり doubles | 最大 20 個 |
| 1 データポイントあたり **indexes** | **1 個・96 バイト以内** |
| 1 Worker invocation あたり | 最大 250 データポイント |

出典: https://developers.cloudflare.com/analytics/analytics-engine/limits/ ／
https://developers.cloudflare.com/changelog/post/2025-06-20-increased-blob-size-limits-in-Workers-Analytics/

- **保持 3 か月** のため、長期トレンドを残すなら自前でのエクスポート・履歴化が必須
  （#235 で導入した `telemetry/worker-usage` と同じ構造の課題）。
- **ローカル開発では binding が動作しない**（Pages Functions のドキュメントに明記）。実装時は
  「binding 未設定なら no-op」のガードが要る。**要実機確認**: Workers の `wrangler dev` /
  vitest-pool-workers での挙動は未検証。
  出典: https://developers.cloudflare.com/pages/functions/bindings/

## 4. サンプリング（`_sample_interval`）

- 発動条件は 2 つ: ① **書き込み時**（特定 index へ高頻度に書き込まれた場合）② **クエリ時**（時間範囲が
  長い・複雑なクエリ）。
- 方式は "equitable sampling"。**まれな index 値は全件保持** され、高頻度な index ほどサンプリング率が上がる。
- 各行に `_sample_interval`（サンプルレートの逆数）が付く。補正式:
  - 件数: `SUM(_sample_interval)`（`count()` ではない）
  - 合計: `SUM(value * _sample_interval)`
  - 平均: `SUM(value * _sample_interval) / SUM(_sample_interval)`
  出典: https://developers.cloudflare.com/analytics/analytics-engine/sampling/

## 5. 読み出し

- **SQL API**: `POST https://api.cloudflare.com/client/v4/accounts/<account_id>/analytics_engine/sql`
  （`Authorization: Bearer <token>`・トークン権限は **Account > Account Analytics > Read**）。
  `SHOW TABLES` でデータセット一覧。
  出典: https://developers.cloudflare.com/analytics/analytics-engine/sql-api/
- **集計関数**（実測確認済み）: `count()` / **`count(DISTINCT col)`** / `sum()` / `avg()` /
  `min()` / `max()` / `quantileExactWeighted()` / `argMin()` / `argMax()` / `first_value()` /
  `last_value()` / `topK()` / `topKWeighted()` / `countIf()` / `sumIf()` / `avgIf()`。
  **HyperLogLog 系の近似関数（`uniq()` / `approx_distinct()`）は無い**
  （`approx_distinct` は別プロダクト R2 SQL の関数であり WAE のものではない）。
  出典: https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/aggregate-functions/
- **可視化 UI は無い**。SQL API 直叩きか Grafana（Altinity の ClickHouse プラグイン）連携が前提。
  出典: https://developers.cloudflare.com/analytics/analytics-engine/grafana/
- GraphQL Analytics API 経由で WAE のカスタムデータセットを読む経路は、今回の調査では確認できなかった
  （**推測**: 読み出しは SQL API が主経路）。

## 6. 「ユニーク利用者数」への適用可否

- `count(DISTINCT ...)` は **使える**。
- ただし **`_sample_interval` による補正は件数・合計・平均にしか定義されておらず、`count(DISTINCT)` は
  補正対象外**。高頻度書き込みでサンプリングが効いている状況では **過小評価** になりうる。
- 公式 FAQ は「ユニークカウント精度のために index の値を大量に増やす」設計を **非推奨**
  （多数 index にまたがる読み出しが遅くなるトレードオフ）。
- **本プロジェクトの現トラフィック（1 日平均 63 リクエスト）ではサンプリングはまず発動しない** ため、
  低トラフィックであることが精度面では有利に働く。
  出典: https://developers.cloudflare.com/analytics/faq/wae-faqs/

## 7. 既存の判断との関係

- 2026-07-28 の議論（`content/discussions/ga4-adoption-20260728/`）の結論は「GA4 不採用・当面 D（何もしない）・
  **告知前後で C（WAE）を再評価**」。本調査は WAE 側の条件（無料枠内・課金未開始・Cookie 同意や
  越境移転の新設が不要）が良好であることを確認しており、**当時の推奨 C を覆す材料は無い**。
- 残る障壁は **コストではなく** ①「見る運用」の成立（可視化 UI が無い）②識別子の設計
  （保持ゼロの設計思想 `docs/design/stateless-architecture.md` との折り合い）。
- ①については #235 で「ルーティンが集計してデータブランチにサマリーを残す」動線が既に存在する。
