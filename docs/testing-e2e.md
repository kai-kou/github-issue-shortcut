# E2E テスト方針（OAuth ログインフロー）

> NFR-15（起票フローの E2E 確認）に対する E2E 自動化の分担。Issue #52・#56。

## ⚠️ スコープと限界（最重要・#56）

**この E2E は「モック IdP + ローカルランタイム + テスト値注入 + マイグレーション済みローカル D1」で走る機能テストであり、`green` は「コードが正しく構成された環境で動く」ことしか意味しない。「本番で動く」ことは保証しない。**

E2E が **構造的に検知できない** もの（実際に本番で 500 を起こした）:

- 本番 secret の妥当性（例: `TOKEN_ENCRYPTION_KEY` が 32 バイトにデコードされない）
- 本番の非 secret var の存在（例: `GITHUB_CLIENT_ID` がデプロイで消える）
- 本番（remote）D1 のマイグレーション適用（例: テーブル未作成で `/auth/callback` 500）
- 実 GitHub との実連携（App の callback 登録・consent）

→ これらは **本番スモークテスト**（下記）と **`/api/ready` 自己診断** で担保する。**モック E2E の green を「本番 E2E で担保できた」と報告してはならない**（教訓 L-118）。

## 何を自動化したか（クラウド CI で自動実行）

**Playwright（Chromium・Pixel モバイルエミュレーション）+ モック GitHub OAuth** で、
ログインフロー全体を実コード（ブラウザ ↔ Worker ↔ D1）で検証する。実 GitHub には触れない。

- 対象: `/auth/login`（state + PKCE 生成）→ 認可（モック）→ `/auth/callback`（トークン交換・
  ユーザー取得・トークン暗号化保存・セッション Cookie 発行）→ `/api/me`（ログイン表示）→ `/auth/logout`。
- 構成:
  - `wrangler dev` がビルド済み SPA + Worker + ローカル D1（`migrations/` 適用）を配信。
  - `e2e/mock-github.mjs` がモック IdP（authorize / access_token / user）を提供。
  - Worker の `GITHUB_OAUTH_BASE` / `GITHUB_API_BASE`（`worker/github.ts` で差し替え可能・
    既定は実 GitHub）をモックに向ける。本番挙動は変えない。
- 実行: `npm run e2e`（`playwright.config.ts` の webServer が上記を起動）。CI は `.github/workflows/ci.yml` の `e2e` ジョブ。
- ローカル実行はプリインストール Chromium を `E2E_CHROMIUM_PATH` で指定可能。

### なぜモック IdP か（リサーチ根拠・#52）

OAuth E2E のベストプラクティスは「フィーチャーテストは常にモック IdP、実プロバイダテストは
PR ゲート外でスケジュール実行」。実 GitHub OAuth をブラウザ自動化すると、CI 環境の IP / UA /
headless シグナルで bot 検知・2FA が誘発され不安定になるため、PR ゲートには入れない。

## どうしても実機手動が残る範囲

以下は実機 Android またはアカウント権限が物理的に必要なため自動化対象外（NFR-15 の手動確認）:

- **実機 Android の PWA 固有挙動**: ホーム画面追加（WebAPK）・standalone 表示での
  Chrome Custom Tab 経由の OAuth リダイレクト往復（#21 の PWA 化と併せて確認）。
- **実 GitHub アカウントでの認可**: 本番 URL での実ログイン（`docs` / Issue #14 の手順）。

Android エミュレータを CI で動かす方法（`reactivecircus/android-emulator-runner`）も存在するが、
native アプリ instrumentation 向けで PWA/WebAPK の standalone OAuth 検証は重く前例が薄いため、
費用対効果で採用しない（実機手動に委ねる）。

## KPI 外形計測（#35・自動計測できる下限値の監視）

NFR-1（サブ秒起動）・NFR-2（起票 10 秒 / タイトルのみ 5 秒）の KPI について、**アプリが理論上出せる下限値** を `e2e/kpi.spec.ts` で外形計測する。上記ログイン E2E と同じ基盤（Pixel 7 エミュレーション + モック GitHub + `wrangler dev`）に載るため追加インフラは不要。

- 実行: `npm run e2e -- kpi.spec.ts`（結果を `test-results/kpi-metrics.json` に書き出す）。
- 計測する指標（すべて機械的に取得可能）:
  - **起票フロー処理時間**: 起動（`goto`）→ タイトル入力可能まで / タイトル入力 / 送信 → 起票完了表示まで（クライアント処理 + API 往復）/ 合計。
  - **Navigation Timing**: TTFB・DOMContentLoaded・load。
  - **Web Vitals**: FCP（`paint` エントリから取得）・LCP（`PerformanceObserver` を `addInitScript` で仕込んで取得）。
- シナリオ: ① ショートカット起動（`/new?repo=...` でリポジトリ初期選択済み）② 通常起動（リポジトリ選択タップ込み）。
- 参考実測（コンテナ・best-case）: 合計 0.6〜0.7 秒 / FCP 76〜168ms / LCP 324〜336ms。NFR-2 の 10 秒目標に対し桁違いに余裕がある（アプリ側の処理は十分速い）。

### ⚠️ この計測が意味すること / しないこと

- ✅ **意味する**: 機能ゲート（起票フロー完走）+ クライアント処理 + API 往復 + レンダリング指標の **回帰監視**。「アプリ処理が遅くなった」ことは検知できる。
- ❌ **意味しない**: 実機体感の代替。この数値は高性能コンテナ・モック GitHub のローカル即応・自動打鍵（人間のタイピングなし）で測った **best-case** であり、以下は含まない:
  - WebAPK / standalone のホーム画面 **コールドスタート**（Service Worker 初期化込み）
  - 実機タップ → ソフトキーボード表示の体感遅延
  - 実機 CPU / thermal throttling
  - 実 GitHub API の RTT（モックはローカル即応）

→ したがって `kpi.spec.ts` の参考閾値（10s）は **下限値の安全網** であり、NFR-2 の実機 10 秒基準そのものの合否判定ではない。**実機体感の最終確認は「どうしても実機手動が残る範囲」（上節）に委ねる**。

### 将来拡張（claude -p headless での無人計測）

CI で無人実行する場合は `claude -p`（headless）に Playwright / Chrome DevTools MCP を `.mcp.json` で付与し、`--permission-mode dontAsk --output-format json` で回せる。Chrome DevTools MCP を併用すると LCP / INP / CLS を CDP トレースで自動取得でき、CDP throttle で低速回線・CPU スロットリング下の計測も追加できる（実機の絶対値は再現しないが、条件を揃えた回帰比較には有効）。src 側の計測イベント（FR-26・M2）を実装すれば、外形計測に加えて実ユーザーの分布計測も可能になる。

## 本番スモークテスト（リリースゲート・#56）

デプロイ後、本番エンドポイントの実経路を検証する。E2E が見逃す本番の設定・プロビジョニング不良を捕捉する層。

```bash
tools/smoke_prod.sh   # 既定で本番 URL を検査。引数でプレビュー URL も可
```

チェック内容:

- `/api/health` → 200
- `/api/ready` → 200（`TOKEN_ENCRYPTION_KEY` の 32 バイト妥当性・`GITHUB_CLIENT_ID` の存在・D1 テーブル存在を自己診断）
- `/auth/login` → 302 で GitHub 認可 URL へ、かつ `client_id` が空でない

`.github/workflows/smoke.yml` がスケジュール（6 時間ごと）+ 手動実行で本番に対して走らせ、本番デグレを早期検知する。**新しいマイグレーション・secret 変更・デプロイの後は、このスモークが緑であることをリリースの合否とする。**

## E2E の CI flaky 切り分け手順（#106）

E2E は `fullyParallel: false` / `workers: 1` の直列実行だが、CI では **同じテストがローカルで通るのに CI でだけ落ちる** flaky が起きうる。原因は大きく 2 系統あり、**対処が正反対**（リトライで直る／リトライでは直らない）なので、まず切り分ける。

| 系統 | 典型症状 | 根本原因 | 対処 |
|------|---------|---------|------|
| **A. 環境速度差（timeout）** | `toBeVisible` / `toHaveText` が `Timeout ...ms exceeded`。特に revalidate 差分反映・起票結果表示など **非同期 UI 更新** を待つアサーション | CI マシンが遅く、非同期 UI 更新（fetch → setState → 再描画）がアサーションの猶予内に間に合わない | `playwright.config.ts` の `retries: process.env.CI ? 2 : 0` が吸収する（リトライで通る）。恒常的に遅いアサーションは個別に `{ timeout }` を延長 |
| **B. テスト分離漏れ（レート制限 429）** | スイート後半の起票系テストが `429` / 「時間をおいて…」表示で失敗。**リトライしても落ち続ける**（フルスイート実行時のみ・単体実行では再現しない） | 全 spec（~40 件）が単一モックユーザー（`e2e-user`）を共有し、本番の起票レート制限（10 件/分・`worker/index.ts` `ISSUE_RATE_LIMIT_PER_WINDOW`）を超える | `playwright.config.ts` の webServer で `--var ISSUE_RATE_LIMIT_PER_WINDOW_OVERRIDE:1000` を渡し、E2E 実行時だけ上限を引き上げる（**本番既定値は変更しない**）。新規に起票系 spec を足すときも同じ webServer 上で走るので追加設定は不要 |

### 切り分けフロー

```
CI で E2E が落ちた
  ↓ ローカルで対象 spec を単体実行（npm run e2e -- <spec>）
  ├─ 単体では通る／フルスイートで落ちる → B（テスト分離）。429 か確認。
  │    override が効いていない or 新しい共有状態の枯渇を疑う（レート制限以外の
  │    D1 行・localStorage 汚染も含む。afterEach のクリーンアップ漏れを点検）
  └─ 単体でも CI でだけ落ちる → A（環境速度）。retries で吸収されるはず。
       retries 後も落ちるなら真の不具合（アサーション対象の非同期処理が壊れている）
```

**リトライ後も落ち続けるテストを「flaky だから」で放置しない**（B か真の不具合の兆候）。`retries` はローカルでは `0`（flaky を隠さず気づけるように）、CI でのみ `2`。

### 新規 E2E を足すときの再発防止

- 起票（`POST /api/issues`）を含む spec は、上記 webServer の override 前提で書く（追加設定不要）。
- テスト間で共有される状態（D1 のショートカット行・localStorage）は `afterEach` / `finally` で必ず片付ける（`e2e/repos-shortcuts-swr-cache.spec.ts` の `finally` が模範）。
- プレースホルダ等の **表示文言をセレクタに使うテキストと衝突させない**（例: name プレースホルダ「日報」を title セレクタ `/バグ報告|Bug report/` と別語にした回帰・strict mode 違反回避）。

## Workers Builds の「テスト → ビルド」順と unit テストの制約（#107）

デプロイ品質ゲートである **Cloudflare Workers Builds は `npm test`（unit）を `npm run build` より前に実行する**。このため **ビルド生成物（`dist/client`）に依存する unit テストは Workers Builds で必ず 404/500 で落ちる**（ローカルでは `npm run build` 済みなので気づけない）。

### 原則: dist 依存の結合テストを unit テストに置かない

- `SELF.fetch("/manifest.webmanifest")` のように **`ASSETS` バインディング経由でビルド済みファイルを読む** エンドポイントの結合テストを `worker/*.test.ts`（vitest・miniflare）に書くと、Workers Builds のテスト段では `dist/client` が未生成のため落ちる。
- 代わりに **2 層で担保** する:
  1. **純関数の unit テスト**: ビルド生成物に依存しないロジック（例: `buildDynamicManifest` — ユーザーの上位 3 ショートカットを `manifest.shortcuts` に反映する純関数）を直接テストする。dist 非依存なので Workers Builds のテスト段でも通る。
  2. **E2E（`npm run e2e`）**: 実際に `wrangler dev` がビルド済み SPA + Worker を配信した状態で `/manifest.webmanifest` の実レスポンスを検証する（`e2e/pwa.spec.ts`）。ビルド後に走るのでエンドポイント結合を実挙動で担保できる。

> ⚠️ **`wrangler.jsonc` の `assets.directory`（`./dist/client`）は削除しない**。miniflare のテスト環境が `ASSETS` バインディングを解決するために必要で、これを消すと逆にローカル unit テストが壊れる（過去に「Workers Builds 対策」として誤って削除し、manifest テストを 500/404 にした回帰あり）。Workers Builds 対策は「dist 依存テストを unit に置かない」であって「`assets.directory` を消す」ではない。

### 判定チェックリスト（新規 Worker テスト追加時）

- [ ] そのテストは `dist/client` の実ファイル（`ASSETS.fetch` / `SELF.fetch` で静的アセットを引く）に依存していないか？
- [ ] 依存しているなら unit ではなく E2E（ビルド後実行）へ回したか？
- [ ] ロジック部分は dist 非依存の純関数に切り出して unit テスト化したか？

## 参照

- `tools/smoke_prod.sh` / `.github/workflows/smoke.yml` / `worker/index.ts` の `/api/ready`
- `playwright.config.ts` / `e2e/login.spec.ts` / `e2e/mock-github.mjs`
- `e2e/repos-shortcuts-swr-cache.spec.ts`（#101 SWR・afterEach クリーンアップの模範）・`e2e/pwa.spec.ts`（#107 manifest 実挙動）
- `docs/requirements/00-requirements.md` NFR-15・§4.2
- Issue #52・#14・#106・#107
