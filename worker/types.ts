/** Worker の環境バインディング（wrangler.jsonc の ratelimits + Workers Secrets）。 */
export interface Env {
  /**
   * 起票のアプリ側レート制限（PR-4・OQ-6）。Workers Rate Limiting binding（2025-09 GA）で、
   * カウンタは Cloudflare が管理し Worker 側に永続層を持たない（P3・stateless-architecture.md §3）。
   * キーは GitHub 数値ユーザー ID のハッシュのみで、個人データそのものは渡さない。
   */
  ISSUE_RATE_LIMIT: RateLimit;
  /**
   * E2E 専用の緩い上限のレート制限（本番では使わない）。E2E は単一のモックユーザーを
   * 全 spec（~40件）が使い回すため、本番の上限（10件/分）のままではスイート後半が
   * 不正利用と誤判定されて 429 で落ちる（テスト分離の問題）。
   * `ISSUE_RATE_LIMIT_RELAXED_ENABLED` が "1" のときだけこちらを使う。
   */
  ISSUE_RATE_LIMIT_RELAXED: RateLimit;
  /** "1" のとき `ISSUE_RATE_LIMIT_RELAXED` を使う（E2E の wrangler dev 起動時のみ設定・playwright.config.ts）。 */
  ISSUE_RATE_LIMIT_RELAXED_ENABLED?: string;
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
}
