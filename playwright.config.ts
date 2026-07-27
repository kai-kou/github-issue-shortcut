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
        "npx wrangler d1 migrations apply DB --local && " +
        "npx wrangler dev --port 8789 " +
        "--var GITHUB_CLIENT_ID:e2e-client-id " +
        "--var GITHUB_CLIENT_SECRET:e2e-client-secret " +
        `--var TOKEN_ENCRYPTION_KEY:${TOKEN_KEY} ` +
        "--var GITHUB_OAUTH_BASE:http://localhost:8788 " +
        "--var GITHUB_API_BASE:http://localhost:8788 " +
        // E2E は単一のモックユーザー（e2e-user）を全 spec（~40件）が使い回すため、本番の
        // 起票レート制限（10件/分・worker/index.ts ISSUE_RATE_LIMIT_PER_WINDOW）のままだと
        // スイート後半のテストが不正利用と誤判定され 429 で落ちる（テスト分離の問題）。
        // E2E 実行時だけ上限を引き上げる（本番既定値は変更しない）。
        "--var ISSUE_RATE_LIMIT_PER_WINDOW_OVERRIDE:1000",
      url: "http://localhost:8789/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
  ],
});
