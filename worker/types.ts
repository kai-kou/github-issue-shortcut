/** Worker の環境バインディング（wrangler.jsonc の d1_databases + Workers Secrets）。 */
export interface Env {
  /** D1 データベース（users / sessions / tokens）。wrangler.jsonc の binding 名 "DB"。 */
  DB: D1Database;
  /** GitHub App の Client ID（公開値）。 */
  GITHUB_CLIENT_ID: string;
  /** GitHub App の Client Secret（Workers Secret）。 */
  GITHUB_CLIENT_SECRET: string;
  /** トークン暗号化マスターキー（base64 エンコードした 32 バイト・Workers Secret）。 */
  TOKEN_ENCRYPTION_KEY: string;
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
  /**
   * ショートカットプリセット作成/更新のアプリ側レート制限（1分あたりの上限）を上書きする
   * （E2E 専用・#87）。未設定なら本番既定値（20）のまま。
   */
  SHORTCUT_RATE_LIMIT_PER_WINDOW_OVERRIDE?: string;
}
