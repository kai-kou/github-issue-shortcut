import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// テスト用のダミー Secrets を miniflare バインディングで注入する（本番は Workers Secrets）。
// TOKEN_ENCRYPTION_KEY は全ゼロ 32 バイトの base64（明らかにテスト用・秘密ではない）。
// 低エントロピーなので秘密スキャナに誤検知されない。
export default defineConfig({
  // ユニットテストのみ対象。e2e/*.spec.ts（Playwright）は vitest では実行しない。
  test: {
    include: ["worker/**/*.test.ts", "src/**/*.test.ts"],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          GITHUB_CLIENT_ID: "test-client-id",
          GITHUB_CLIENT_SECRET: "test-client-secret",
          TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        },
      },
    }),
  ],
});
