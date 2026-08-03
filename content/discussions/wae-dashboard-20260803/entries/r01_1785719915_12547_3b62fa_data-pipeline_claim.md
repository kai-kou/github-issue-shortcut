<!--entry
author: data-pipeline
round: 1
kind: claim
ts: 2026-08-03T10:18:34+09:00
-->

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
