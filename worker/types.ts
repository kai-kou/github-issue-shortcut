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
  /**
   * 同一内容の連投抑止（不正利用対策・PR-4 拡張・#179）。キーは `HMAC(userId + contentHash)` で、
   * サーバーには内容そのものも生ハッシュも渡さず、逆引き不能な鍵だけを Cloudflare 側に渡す
   * （`worker/index.ts` の `duplicateSubmissionKey`）。永続層を持たない P3 方針のまま、
   * 「同一ユーザー・同一内容の起票は 10 秒に 1 回まで」をサーバー側で強制する。
   */
  ISSUE_DUPLICATE_SUBMISSION_LIMIT: RateLimit;
  /**
   * E2E 専用の緩い上限（本番では使わない）。単一のモックユーザーが複数 spec で同一内容
   * （例: マジック文字列 `__mock_422__`）を短時間に繰り返し送るため、本番の 10 秒窓のままだと
   * 無関係なテストが 429（duplicate_submission）で落ちる。`ISSUE_RATE_LIMIT_RELAXED_ENABLED`
   * が "1" のときだけこちらを使う。
   */
  ISSUE_DUPLICATE_SUBMISSION_LIMIT_RELAXED: RateLimit;
  /**
   * 認証不要で叩ける `GET /auth/login` のレート制限（#207）。他の 2 つと違いユーザー ID を
   * キーにできないため、接続元 IP（`CF-Connecting-IP`）の HMAC をキーに使う（生 IP は渡さない・
   * `worker/index.ts` の `authLoginRateLimitKey`）。上流の GitHub を消費しない経路で
   * Worker のリクエスト数・CPU 時間だけを消耗させる可用性攻撃を頭打ちにする。
   */
  AUTH_LOGIN_RATE_LIMIT: RateLimit;
  /**
   * E2E 専用の緩い上限（本番では使わない）。E2E は全 spec が同一ホスト（= 同一キー）から
   * 繰り返しログインするため、本番の上限（20 件/分）のままではスイート後半が 429 で落ちる。
   * `ISSUE_RATE_LIMIT_RELAXED_ENABLED` が "1" のときだけこちらを使う。
   */
  AUTH_LOGIN_RATE_LIMIT_RELAXED: RateLimit;
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
