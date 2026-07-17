import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-512-maskable.png"],
      manifest: {
        name: "GitHub Issue Shortcut",
        short_name: "Issue Shortcut",
        description: "スマホから数秒で GitHub Issue を起票する PWA",
        lang: "ja",
        start_url: "/",
        display: "standalone",
        background_color: "#0d1117",
        theme_color: "#0d1117",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        // Android 共有シートからの受け（B3-4・FR-18）。GET のためブラウザが action にクエリ文字列を
        // 付けて遷移するだけで、専用エンドポイントは不要（/new のプレフィル解析に合流させる・§4.4）。
        // text は共有元アプリの本文（共有 URL がここに入ることが多い）をそのまま body 扱いにする。
        share_target: {
          action: "/new",
          method: "GET",
          params: {
            title: "title",
            text: "body",
            url: "url",
          },
        },
      },
      workbox: {
        // /auth/* は SW のナビゲーションフォールバック対象外にする（MUST・OAuth コールバックのキャッシュ応答による破壊を防止）。
        // /setup（GitHub App Setup URL 着地点）・/api/* も同様に Worker が都度処理すべきパスのため除外する。
        // 末尾スラッシュなし（例: 将来の /auth・/api 単体ルート）も除外できるよう (\/|$) で揃える。
        navigateFallbackDenylist: [/^\/auth(\/|$)/, /^\/setup(\/|$)/, /^\/api(\/|$)/],
      },
    }),
  ],
});
