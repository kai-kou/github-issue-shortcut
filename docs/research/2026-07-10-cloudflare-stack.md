# リサーチ: Cloudflare 技術スタック（2026-07-10 実施）

> 専門リサーチチーム（エッジインフラ班）による調査結果の要約。全て 2026-07-10 時点の一次情報で検証済み。

## 1. ホスティング: Workers（static assets）一択

- Cloudflare 公式が「新規プロジェクトは Workers で始めるべき。今後の投資・最適化・機能開発はすべて Workers に向ける」と明言（2025-04 Developer Week）。Pages はサポート継続だが投資凍結（公式の deprecation はなし）。
  出典: <https://blog.cloudflare.com/full-stack-development-on-cloudflare-workers/> / <https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/>
- Workers static assets は **配信無料・無制限**（Worker 起動分のみ課金）。`_headers`/`_redirects` ネイティブ対応。SPA フォールバック（`not_found_handling = "single-page-application"`）・`run_worker_first`（ルート単位で Worker 優先実行）対応。
  出典: <https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/> / <https://developers.cloudflare.com/workers/static-assets/>

## 2. フレームワーク: Vite + React SPA + Hono API（単一 Worker）

- `@cloudflare/vite-plugin` は 2025-04 に GA。公式チュートリアル自体が「React SPA + Worker API を 1 Worker で」構成で、API ルート拡充の次の一手として Hono を公式に案内。
  出典: <https://developers.cloudflare.com/workers/vite-plugin/> / <https://developers.cloudflare.com/workers/vite-plugin/tutorial/>
- Hono v4.x は活発に更新中（作者は Cloudflare Developer Advocate）。`llms-full.txt` 提供で AI エージェントと相性良好。JSX/SSR・RPC クライアント・`@hono/zod-validator` エコシステムあり。
  出典: <https://hono.dev/llms.txt> / <https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/>
- 対抗馬の評価: **HonoX は 2026-07 時点でまだ alpha**（同一メジャー内破壊的変更あり）・React Router v8 は SSR 前提で「SPA モードは CF Vite プラグイン未対応」・Next.js (OpenNext) は最重量（バンドル 3MiB 無料枠制限に注意）・Astro/SvelteKit は SSR ファーストで PWA SPA とは方向が違う。
  出典: <https://github.com/honojs/honox> / <https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/> / <https://opennext.js.org/cloudflare>

## 3. データ層: KV は落とし穴あり・セッションは D1 or Durable Objects

- Cloudflare のプロダクト選択ガイドは「セッション・認証情報・設定」に KV を挙げるが、**認証班の詳細調査で重大な注意点が判明**:
  - KV は結果整合性（書き込み反映まで最大 60 秒超・**ネガティブルックアップもキャッシュ** される）
  - **1 key あたり 1 write/秒**・無料枠 1,000 writes/日 → OAuth state の書き込み→即読みや、リフレッシュトークンのローテーション保存と相性が悪い
  出典: <https://developers.cloudflare.com/kv/concepts/how-kv-works/> / <https://developers.cloudflare.com/kv/platform/limits/>
- **D1**（SQLite・強整合のプライマリ 1 台）は無料枠 5M 行読取/日・100K 行書込/日・5GB で、セッションストアとして十分。
  出典: <https://developers.cloudflare.com/d1/platform/pricing/>
- **Durable Objects は 2025-04 から無料プランで利用可**（SQLite バックエンド）。ユーザー単位のトランザクショナルな状態（リフレッシュトークンのローテーション直列化）に最適。
  出典: <https://developers.cloudflare.com/durable-objects/platform/pricing/>
- 使い分け推奨: セッション + トークン = **D1**（またはユーザー単位 DO）/ 読み取り中心の設定キャッシュ = KV も可 / リアルタイム協調なし → DO は必要になってから。

## 4. 開発・デプロイ・テスト

- **wrangler v4**（2025-03 GA）・設定は `wrangler.jsonc` 推奨。
  出典: <https://developers.cloudflare.com/workers/wrangler/configuration/>
- CI は 2 択:
  - **Workers Builds**（git 連携・push で build+deploy・無料 3,000 分/月・非本番ブランチは自動でプレビューアップロード・**ブランチ単位のプレビュー URL が PR コメントに自動投稿**）
  - **GitHub Actions + wrangler-action@v3**（テスト・lint をゲートにした本格パイプライン向き）
  - 推奨: テストを CI ゲートにしたいので GitHub Actions を一次、プレビューは Workers Builds 併用も可。
  出典: <https://developers.cloudflare.com/workers/ci-cd/builds/configuration/> / <https://github.com/cloudflare/wrangler-action>
  > **2026-07-10 M0 スプリント更新（キーレス構成へ変更）**: 上記の「GitHub Actions を一次」は `wrangler-action@v3`（`CLOUDFLARE_API_TOKEN` の発行・GitHub Secrets 登録が必須）を前提にしていたが、実装フェーズの事実確認で GitHub Actions からは deploy せず **Workers Builds のみでデプロイ**（ビルドトークン自動生成・キーレス）、GitHub Actions は `vitest`・lint 等の品質ゲート専任に変更した。事実確認の詳細は [`2026-07-10-cloudflare-connector-keyless.md`](2026-07-10-cloudflare-connector-keyless.md) を参照。
- テスト: `@cloudflare/vitest-pool-workers`（workerd 内で Vitest 実行・bindings 直接アクセス・テストファイル単位のストレージ分離）。Vitest 4 系必須（v0.13.0+）。
  出典: <https://developers.cloudflare.com/workers/testing/vitest-integration/>
- 段階的デプロイ: `wrangler versions upload/deploy` でカナリア配信（割合指定）可能。
  出典: <https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/>

## 5. PWA ツーリング

- **vite-plugin-pwa v1.3.0**（2026-05 更新・Workbox 7・活発）。代替の Serwist も現役。manifest 生成・Service Worker（generateSW / injectManifest）・開発時 SW 対応。
  出典: <https://github.com/vite-pwa/vite-plugin-pwa/releases> / <https://vite-pwa-org.netlify.app/guide/>
- 将来の Android アプリ化: **TWA + Bubblewrap（v1.24.1・2025-09 更新・現役）** or PWABuilder。Google 公式推奨パスとして 2026 年も健在。
  出典: <https://github.com/GoogleChromeLabs/bubblewrap> / <https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities>

## 6. AI ネイティブ観点

- Cloudflare は「Docs for agents」プログラムで全ドキュメントに `llms.txt`/`llms-full.txt`・Markdown コンテンツネゴシエーション・**公式 Docs MCP サーバー**（<https://docs.mcp.cloudflare.com/mcp>）・**Claude Code 向け Agent setup ガイド** を提供。
  出典: <https://developers.cloudflare.com/docs-for-agents/> / <https://developers.cloudflare.com/agent-setup/claude-code/>
- Hono・Vite・Svelte も llms.txt 対応。React Router は未対応（404）。
- Cloudflare Agents SDK は LLM エージェント用のフレームワークであり、**本アプリ（通常の PWA + API）には不要**。
  出典: <https://developers.cloudflare.com/agents/>

## 7. 推奨技術スタック（構成）

```text
[Android Chrome / ホーム画面ショートカット]
        │ HTTPS
        ▼
Cloudflare Workers（単一 Worker）
├── static assets: Vite + React SPA（PWA: vite-plugin-pwa / Workbox 7）
├── API: Hono（/api/*, /auth/*）… run_worker_first
│     ├── GitHub OAuth（GitHub App user token・手書き or @octokit/auth-oauth-user）
│     └── Issue 作成プロキシ（POST /repos/{o}/{r}/issues）
├── D1: セッション・暗号化トークン・ユーザー設定
└── Secrets: GitHub App client secret・トークン暗号鍵

開発: wrangler v4 + wrangler.jsonc / vitest-pool-workers / TypeScript
CI/CD: GitHub Actions（test / lint）+ Workers Builds（deploy・プレビュー URL・キーレス）
将来: TWA（Bubblewrap）で Play ストア配布
```

**選定理由**: ①Cloudflare 公式 GA ツーリングの王道パターンそのもの ②React + Vite + Hono は LLM の学習データ・公式 llms.txt とも厚く AI エージェント開発と相性最良 ③SPA なので PWA（オフライン・ショートカット起動）の実装が素直 ④単一 Worker でインフラが最小。
