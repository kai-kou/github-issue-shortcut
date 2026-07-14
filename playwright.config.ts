import { defineConfig, devices } from "@playwright/test";

// E2E: Playwright（Chromium・Pixel モバイルエミュレーション）で OAuth ログインフローを検証する。
// - wrangler dev がビルド済み SPA + Worker + ローカル D1 を配信（要 `npm run build` 事前実行）
// - モック GitHub（e2e/mock-github.mjs）を GITHUB_OAUTH_BASE / GITHUB_API_BASE に向ける
// - ローカル実行時はプリインストール Chromium を E2E_CHROMIUM_PATH で指定できる
const chromiumPath = process.env.E2E_CHROMIUM_PATH;
const TOKEN_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:8787",
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
        "npx wrangler d1 migrations apply DB --local && " +
        "npx wrangler dev --port 8787 " +
        "--var GITHUB_CLIENT_ID:e2e-client-id " +
        "--var GITHUB_CLIENT_SECRET:e2e-client-secret " +
        `--var TOKEN_ENCRYPTION_KEY:${TOKEN_KEY} ` +
        "--var GITHUB_OAUTH_BASE:http://localhost:8788 " +
        "--var GITHUB_API_BASE:http://localhost:8788",
      url: "http://localhost:8787/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
  ],
});
