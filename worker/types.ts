/** Worker の環境バインディング（wrangler.jsonc の d1_databases + Workers Secrets）。 */
export interface Env {
  /**
   * D1 データベース。P2 以降は個人データを保存せず、重複防止（issue_log / request_ids）と
   * レート制限（rate_limits）の暫定置き場としてのみ使う（P3 で撤去予定）。binding 名 "DB"。
   */
  DB: D1Database;
  /** GitHub App の Client ID（公開値）。 */
  GITHUB_CLIENT_ID: string;
  /** GitHub App の Client Secret（Workers Secret）。 */
  GITHUB_CLIENT_SECRET: string;
  /** トークン暗号化マスターキー（base64 エンコードした 32 バイト・Workers Secret）。 */
  TOKEN_ENCRYPTION_KEY: string;
  /**
   * トークン Cookie の鍵バージョン（1〜255・既定 1）。`TOKEN_ENCRYPTION_KEY` をローテーションする
   * ときに合わせて +1 する。旧バージョンで封入された Cookie は復号されず再ログインになるだけで、
   * 端末内のデータ（下書き・ショートカット）は失われない（stateless-architecture.md §4）。
   */
  TOKEN_KEY_VERSION?: string;
  /** GitHub OAuth（authorize/token）の base URL。未設定なら実 GitHub。E2E でモックを指すため。 */
  GITHUB_OAUTH_BASE?: string;
  /** GitHub REST API の base URL。未設定なら実 GitHub。E2E でモックを指すため。 */
  GITHUB_API_BASE?: string;
  /** ビルド済み静的アセット（manifest.webmanifest 等）を取得するバインディング（wrangler.jsonc の assets.binding）。 */
  ASSETS: Fetcher;
  /**
   * 起票のアプリ側レート制限（1分あたりの上限）を上書きする（E2E 専用・PR-4/OQ-6）。
   * 未設定なら本番既定値（10）のまま。E2E は単一モックユーザーを全 spec が使い回すため、
   * playwright.config.ts の wrangler dev 起動時のみ大きな値を設定する。
   */
  ISSUE_RATE_LIMIT_PER_WINDOW_OVERRIDE?: string;
}
