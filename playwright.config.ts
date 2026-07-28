import { defineConfig, devices } from "@playwright/test";

// E2E: Playwright（Chromium・Pixel モバイルエミュレーション）で OAuth ログインフローを検証する。
// - wrangler dev がビルド済み SPA + Worker を配信（要 `npm run build` 事前実行・永続層なし）
// - モック GitHub（e2e/mock-github.mjs）を GITHUB_OAUTH_BASE / GITHUB_API_BASE に向ける
// - ローカル実行時はプリインストール Chromium を E2E_CHROMIUM_PATH で指定できる
const chromiumPath = process.env.E2E_CHROMIUM_PATH;
const TOKEN_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // README 掲載用スクリーンショットの撮影シーケンス（e2e/screenshots.spec.ts）は通常の E2E
  // （`npm run e2e` / CI の e2e ジョブ）から除外する。含めると実行のたびに
  // docs/assets/screenshots/*.png が上書きされ、無関係な PR に画像差分が混入する（#193 レビュー指摘）。
  // `npm run screenshots` は PW_SCREENSHOTS=1 を立てて明示的に対象へ戻す。
  testIgnore: process.env.PW_SCREENSHOTS === "1" ? [] : ["**/screenshots.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  // CI 環境ではマシン速度差により非同期 UI 更新（revalidate 差分反映・起票結果表示）が
  // まれに遅延して flaky になる。ローカルは 0（flaky を隠さず気づけるように）、CI のみ
  // リトライで吸収する（#106）。真因が環境速度でなくレート制限等の場合はリトライでも
  // 落ち続けるため、リトライ後も失敗するテストは docs/testing-e2e.md の切り分け手順で調べる。
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:8789",
    ...devices["Pixel 7"],
    ignoreHTTPSErrors: true,
    launchOptions: {
      // コンテナ/CI では user namespace が使えず Chromium が起動できないため無効化する。
      args: ["--no-sandbox"],
      ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    },
  },
  webServer: [
    {
      command: "node e2e/mock-github.mjs",
      url: "http://localhost:8788/health",
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
    },
    {
      command:
        "npx wrangler dev --port 8789 " +
        "--var GITHUB_CLIENT_ID:e2e-client-id " +
        "--var GITHUB_CLIENT_SECRET:e2e-client-secret " +
        `--var TOKEN_ENCRYPTION_KEY:${TOKEN_KEY} ` +
        "--var GITHUB_OAUTH_BASE:http://localhost:8788 " +
        "--var GITHUB_API_BASE:http://localhost:8788 " +
        // E2E は単一のモックユーザー（e2e-user）を全 spec（~40件）が使い回すため、本番の
        // 起票レート制限（10件/分・wrangler.jsonc の ISSUE_RATE_LIMIT）のままだとスイート後半の
        // テストが不正利用と誤判定され 429 で落ちる（テスト分離の問題）。E2E 実行時だけ緩い上限の
        // バインディング（ISSUE_RATE_LIMIT_RELAXED）へ切り替える（本番の上限は変更しない）。
        "--var ISSUE_RATE_LIMIT_RELAXED_ENABLED:1",
      url: "http://localhost:8789/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
  ],
});
