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
        // WebAPK が既存アプリを再利用起動する際にクエリ付き URL（例: ホーム画面に手動追加した
        // `/new?repo=...` ショートカット）を落とさず window.launchQueue 経由で受け取れるようにする
        // （#98・モバイルは実質 navigate-existing 挙動・docs/research/2026-07-10-mobile-ux-pwa.md §3）。
        launch_handler: { client_mode: "navigate-existing" },
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
        // アイコン長押しメニューの定番プリセット（C2-1・FR-17）。manifest shortcuts は
        // 全ユーザー共通の静的定義（Android Chrome 最大 3 個・WebAPK 反映は約 24h 周期）のため、
        // リポジトリ個別のプリセットではなく汎用のラベル起票導線にとどめる
        // （ユーザー個別プリセットは URL ベースのショートカット作成ヘルパー C1-1/#13 が担当）。
        shortcuts: [
          {
            name: "新しい Issue を作成",
            short_name: "新規 Issue",
            url: "/new",
            icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
          },
          {
            name: "バグを報告",
            short_name: "バグ報告",
            url: "/new?labels=bug",
            icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
          },
          {
            name: "改善案を起票",
            short_name: "改善案",
            url: "/new?labels=enhancement",
            icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
          },
        ],
      },
      workbox: {
        // /auth/* は SW のナビゲーションフォールバック対象外にする（MUST・OAuth コールバックのキャッシュ応答による破壊を防止）。
        // /setup（GitHub App Setup URL 着地点）・/api/* も同様に Worker が都度処理すべきパスのため除外する。
        // 末尾スラッシュなし（例: 将来の /auth・/api 単体ルート）も除外できるよう (\/|$) で揃える。
        navigateFallbackDenylist: [/^\/auth(\/|$)/, /^\/setup(\/|$)/, /^\/api(\/|$)/],
        // オフラインキュー（B4-2・FR-22）: ネットワーク到達不能時の起票 POST を Workbox Background
        // Sync（IndexedDB キュー・約 24h 保持）に積み、オンライン復帰時に自動再送する。ページを閉じて
        // いても再送される保証はこの SW 側の経路が担い、フォアグラウンドでの確実な UI 更新・キュー表示は
        // クライアント側の再送経路（src/issues/useOfflineQueueSync.ts）が担う（二重化。重複は
        // 既存の issue_log 照合・B4-3・#70 がサーバー側で吸収する）。4xx/5xx はネットワーク成功
        // レスポンスのため Background Sync のリトライ対象にならず、要件どおり自動再送されない。
        runtimeCaching: [
          {
            urlPattern: /^\/api\/issues$/,
            method: "POST",
            handler: "NetworkOnly",
            options: {
              backgroundSync: {
                name: "issue-post-queue",
                options: { maxRetentionTime: 24 * 60 },
              },
            },
          },
        ],
      },
    }),
  ],
});
