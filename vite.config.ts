import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

/**
 * 生成された Service Worker の precache から `manifest.webmanifest` を取り除くプラグイン（#98 の
 * 動的 manifest が効かない根本原因 RC-A の修正）。
 *
 * 背景: Worker（worker/index.ts の GET /manifest.webmanifest）はログインユーザーのショートカット
 * プリセットで manifest.shortcuts を差し替えて配信するが、SW が manifest.webmanifest を precache すると、
 * ブラウザの manifest 取得リクエスト（destination: "manifest"・SW の fetch ハンドラを経由する）を
 * precache ルートが横取りし、静的ビルド成果物（汎用プリセット3件）を返してしまう。結果、動的 manifest が
 * 永遠にブラウザへ届かず、アイコン長押しメニューがユーザー設定のショートカットに置き換わらない。
 *
 * vite-plugin-pwa は manifest を workbox.additionalManifestEntries へ強制追加する（configureStaticAssets）。
 * この追加は Workbox の manifestTransforms より後段（additionalManifestEntriesTransform が最後）に適用される
 * ため、globPatterns/globIgnores/manifestTransforms のいずれでも除外できない。よって生成後の sw.js から
 * 該当 precache エントリを取り除く（precache しないだけで、manifest はインストール時にネットワーク経由で
 * 取得されれば足りる＝オフライン precache は必須ではない）。除外後は manifest リクエストが SW の
 * どのルートにもマッチせず素通りして Worker へ到達し、動的 shortcuts が反映される。
 */
function stripManifestFromSwPrecache(): Plugin {
  const MANIFEST_ENTRY = /\{url:"manifest\.webmanifest",revision:(?:"[^"]*"|null)\},?/;
  return {
    name: "strip-manifest-from-sw-precache",
    apply: "build",
    enforce: "post",
    closeBundle: {
      order: "post",
      handler() {
        // worker 環境の closeBundle では前回ビルドの sw.js が残骸として残るため対象外にする（#137）。
        // environment が未取得（想定外の呼び出し経路）の場合はスキップせず後続の existsSync
        // チェックへフォールスルーする（#98 のフェイルラウド設計を壊さないため・環境名不明を
        // サイレントスキップにしない）。
        if (this.environment && this.environment.name !== "client") return;
        const swPath = resolve(process.cwd(), "dist/client/sw.js");
        if (!existsSync(swPath)) return;
        const src = readFileSync(swPath, "utf8");
        if (!MANIFEST_ENTRY.test(src)) {
          // 生成フォーマットが変わり除外に失敗した場合はビルドを止める（サイレントな回帰を防ぐ）。
          throw new Error(
            "[strip-manifest-from-sw-precache] sw.js に manifest.webmanifest の precache エントリが見つからず除外できませんでした。vite-plugin-pwa/workbox の出力フォーマット変更の可能性があります。",
          );
        }
        // エントリを除去し、末尾が `,]` になった場合（manifest が配列末尾だったケース）は整える。
        const stripped = src.replace(MANIFEST_ENTRY, "").replace(/,\]/g, "]");
        writeFileSync(swPath, stripped);
      },
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    VitePWA({
      registerType: "autoUpdate",
      // manifest は静的アセットのまま返す方針へ戻したため（P1・stateless-architecture.md §7）、
      // 取得リクエストに Cookie を載せる必要はない（#98 の動的 manifest 用の設定を撤去した）。
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
        // manifest.webmanifest の precache 除外は stripManifestFromSwPrecache プラグインで行う
        // （vite-plugin-pwa が additionalManifestEntries へ強制追加するため workbox 設定では除外不可・
        // #98 の動的 manifest 根本原因 RC-A。詳細はファイル冒頭のプラグイン説明を参照）。
        // /auth/* は SW のナビゲーションフォールバック対象外にする（MUST・OAuth コールバックのキャッシュ応答による破壊を防止）。
        // /setup（GitHub App Setup URL 着地点）・/api/* も同様に Worker が都度処理すべきパスのため除外する。
        // 末尾スラッシュなし（例: 将来の /auth・/api 単体ルート）も除外できるよう (\/|$) で揃える。
        navigateFallbackDenylist: [/^\/auth(\/|$)/, /^\/setup(\/|$)/, /^\/api(\/|$)/],
        // オフラインキュー（B4-2・FR-22）の再送は **ページ側の経路に一本化している**
        // （`src/issues/useOfflineQueueSync.ts`。キューの実体は localStorage・`offlineQueue.ts`）。
        //
        // 以前はここに Workbox Background Sync のルート（`issue-post-queue`）を置いていたが、
        // 2 つの理由で撤去した（#177）。
        //
        // 1. **1 度も発火していなかった**: Workbox の RegExpRoute は正規表現を URL 全体（`url.href`）に
        //    対して評価する。`/^\/api\/issues$/` は `https://host/api/issues` に一致しないため、
        //    起票 POST はキューへ積まれていなかった。
        // 2. **パターンを直すだけでは二重起票する**: P3（#165）でサーバー側の重複判定を廃止し、
        //    照合を端末内（`src/issues/sentRequestIds.ts` の client_request_id 予約）へ移した。
        //    Workbox の BackgroundSyncPlugin は自動でキューを再送するが、その再送はこの予約を
        //    参照しないため、ページ側の再送と合わせて同じ起票が 2 件作られうる。SW から予約を
        //    通すには injectManifest 化して SW を自前で書く必要があり、影響範囲が要件に見合わない。
        //
        // FR-22 の「オフライン・ネットワーク失敗時にキューし、回復時に再送できること」は、
        // ページ側経路が満たす（認証済みホーム画面が描画された時点の初回 flush と、その間の
        // `online` イベントで再送される。発火条件の詳細は useOfflineQueueSync.ts のコメント）。
        // 4xx/5xx を自動再送しない要件も同経路が守る（failed としてキューに残し D2-1 の一覧で救済する）。
      },
    }),
    stripManifestFromSwPrecache(),
  ],
});
