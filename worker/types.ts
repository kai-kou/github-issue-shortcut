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
}
