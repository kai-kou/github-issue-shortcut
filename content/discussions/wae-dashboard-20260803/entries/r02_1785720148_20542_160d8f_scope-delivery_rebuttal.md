<!--entry
author: scope-delivery
round: 2
kind: rebuttal
ts: 2026-08-03T10:22:27+09:00
-->

# scope-delivery 反論・分割組み替え（Round 2）

## Q1: privacy-identity の「数えない」でブロッキングは解消するか → **解消する。A を分割して即着手可能にする**

data-pipeline の R1 スキーマ（index=`event_type` 固定集合・blob1=`outcome`・blob2=`traffic_source`・
double1-3=duration/status/is_error）を見直すと、**個人由来の値は一切含まれていない**。privacy-identity が
懸念していたのは「案1〜3（HMAC 化ユーザー ID）」であって、event_type/outcome/latency 計装はそもそも
その懸念の対象外だった。**私が Round 1 で Child A 全体をブロックしたのは過剰だった（撤回）**。

blob3（ユニーク利用者数）だけが privacy-identity 判断待ちの対象であり、かつ privacy-identity 自身が
「案4（数えない）を推奨」と結論している。よって旧 Child A を分割する:

- **Child 2A**（旧 A）: event_type/outcome/latency のみ計装。**依存なし・即着手可**
- **blob3（ユニーク利用者数）は Issue化しない**（YAGNI 追記・§4）。privacy-identity の推奨をそのまま採用し、
  「取れない数字」として `record_worker_usage.py` の既存コメントと同じ扱いにする。プロダクト側が
  本当に必要とするなら、その時点で案1（期間ローテーション HMAC）+ ポリシー改訂 + #208 対応をセットにした
  別 Issue を改めて起票する（先回りしない）

## Q2: data-pipeline の役割分担（総数=既存経路 / WAE=内訳・レイテンシ専用）を反映した Done Criteria

同意する。二重の真実源を避ける data-pipeline の設計はそのまま採用し、Done Criteria を書き換える:

- Child 2B（旧 B）: 「取得」ではなく「**内訳・レイテンシの** 取得」と明記。ブランチは新設せず
  `telemetry/worker-usage` 内に新ディレクトリ（data-pipeline 提案）。週次実行（`--report-due` 相乗り）
- ダッシュボード側の Done Criteria に **「総リクエスト数・エラー数は `telemetry/worker-usage` を正本として表示し、
  WAE 由来の内訳と数値ラベルを明確に分けて表示する（同じ 'requests' という名前で二系統の数字を出さない）」**
  を追加（data-pipeline §4 の警告をそのまま UI 制約に落とす）

## Q3: 最初の 1 本で飼い主が画面を見られるのはどの Issue か → **新設 Child 1（WAE 抜きの MVP）**

ここで見落としに気づいた。**`telemetry/worker-usage` は #235 で既に稼働中で、日次 requests/errors が
今すぐ手元にある**。日次・週次・月次の集計（`summarize()`/`flatten_daily()`）もロジックは既にある
（月次グルーピングの追加だけで済む）。つまり **WAE を一切待たずに「日次・週次・月次」の最小ダッシュボードが
今日から作れる**。旧 Child C（WAE 前提）は不要な依存を背負っていた。

data-pipeline / delivery-security / dashboard-ux の 3 者を統合すると、以下で「1 回コミットすれば
以後は routine のデータ push だけで更新される」構成になる:

- delivery-security 案 B（データブランチの JSON をダッシュボード **JS がクライアント側で fetch**）を採用
- dashboard-ux の「依存ライブラリ導入しない・自前 SVG」は維持するが、**SVG 生成をビルド時ではなく
  クライアント側 JS（フレームワーク非依存の素の fetch + 描画）に変更する**（dashboard-ux への修正提案・
  要 ack）。理由: dashboard-ux の「ビルド時に Python/Node で生成」案だと、ルーティン実行のたびに
  `site/` へコミットが必要になり、delivery-security が 案A/D で指摘した「無関係な差分で `pages.yml` の
  再デプロイが走る」問題を再発させる。**`site/` は 1 回だけコミットし、以後のデータ更新はデータブランチ
  への push のみで完結させる**のが、両者の懸念を同時に満たす唯一の構成

→ **飼い主が最初に画面を見られるのは Child 1 完了時点**（WAE 計装ゼロ・依存関係なし・最速）。

**dashboard-ux への留保**: R1 の KPI カード 4 枚（起票成功数/成功率/p95/ユニークデバイス数）は
すべて WAE 由来（event_type 内訳 or 却下された blob3）で、Child 1 時点では作れない。Child 1 は
「requests/errors の日次・週次・月次トレンド」という更に薄い画面になる（後述 Q4 で飼い主の要求充足に
必要十分と主張）。この画面設計の縮小は dashboard-ux の判断を上書きするものではなく、**Round 3 で
dashboard-ux が Child 1 用に薄い版のワイヤーフレームを出す**ことを提案する

## Q4: 「1 本にまとめる方が良い」への応答 → **粒度（日/週/月）は 1 本にまとめる。分割軸を「指標の深さ」に変える**

これは正当な指摘で、旧 C/D 分割（日次だけ先行 → 週次/月次を後）は「飼い主の要求（日次・週次・月次）」を
2 スプリントかけないと満たさない、という点で **譲歩する**。Q3 の発見（既存 telemetry データだけで
3 粒度とも即座に作れる）により、**この譲歩は無償で実現できる**: 日/週/月は Child 1 で一括提供し、
分割の軸を「時間粒度」から「**データソースの深さ（volume だけ → event_type 内訳・レイテンシまで）**」
に差し替える。これなら 1 スプリント目で飼い主の literal な要求（日次・週次・月次）を満たしつつ、
YAGNI の原則（内訳・レイテンシ・p95 は Child 1 の時点では要らない）も両立する。

## 最終分割案（Epic #238 の子 Issue として起票可能な粒度）

| # | タイトル | 依存 | SP | Done Criteria 要旨 |
|---|---|---|---|---|
| **1** | `feat: 利用状況ダッシュボード最小版（日次/週次/月次・requests/errors・telemetry/worker-usage 直結）` | なし | **sp:5**（新規: クライアント fetch 初実装 + 自前 SVG。base 3 + Dynamic +2） | 本番 Pages で 30 日日次/12 週週次/6 か月月次の requests・errors を表示（目視）／データ取得はクライアント JS が `raw.githubusercontent.com` 経由で `telemetry/worker-usage` の JSON を fetch（`connect-src` CSP 追加）／依存ライブラリなし／`site/` は本 Issue で 1 回だけコミットし以後の routine 実行では触れないことをレビューで確認／フェッチ失敗・空データでクラッシュしない |
| **2A** | `feat: WAE binding 導入 + event_type/outcome/latency 計装（個人由来データなし）` | なし（privacy 案4 反映によりブロック解消） | sp:5 | data-pipeline スキーマ採用／no-op ガードのテスト／本番デプロイ後 `SHOW TABLES` 実機確認 |
| **2B** | `feat: WAE 内訳・レイテンシの週次取得・telemetry/worker-usage 履歴化` | 2A | sp:3 | `tools/record_wae_usage.py` 新規（`telemetry_branch.py` 再利用）／同一ブランチ新ディレクトリ／self-test PASS／実機 push 確認／`sprint-session.md` へ週次手順追記 |
| **3** | `improvement: ダッシュボードに内訳（event_type×outcome）とレイテンシ p95 を追加` | 1 + 2B | sp:3 | Child 1 の画面に内訳セクションを追加表示／総数ラベルと WAE 内訳ラベルを明確に区別（data-pipeline §4）／数値突合テスト |

**着手順**: `1` と `2A` は並列着手可（依存なし）。`2A → 2B → 3`、`1 → 3`。
**YAGNI（変更なし + 追記）**: ユニーク利用者数カードは作らない（privacy 案4採用）。フィルタ UI・ライブ再クエリ・
Grafana 連携は Round 1 のまま却下を維持。
