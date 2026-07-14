import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// テスト用のダミー Secrets を miniflare バインディングで注入する（本番は Workers Secrets）。
// TOKEN_ENCRYPTION_KEY は可読 ASCII の 32 バイト（明らかにテスト用プレースホルダ）を
// 実行時に base64 化する。秘密に見える高エントロピー文字列をソースに直書きしない。
const TEST_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          GITHUB_CLIENT_ID: "test-client-id",
          GITHUB_CLIENT_SECRET: "test-client-secret",
          TOKEN_ENCRYPTION_KEY: TEST_TOKEN_KEY,
        },
      },
    }),
  ],
});
