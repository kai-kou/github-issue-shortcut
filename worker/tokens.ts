/**
 * トークンの鮮度判定とリフレッシュ（ステートレス版・stateless-architecture.md §5）。
 *
 * トークンは D1 ではなく暗号化 Cookie（`worker/tokenCookie.ts`）にあるため、サーバー側の行ロックは
 * 存在しない。リフレッシュトークンは単回使用ローテーションのため、並行リフレッシュの直列化は
 * **クライアントの Web Locks API**（`src/auth/tokenRefresh.ts`）が担い、サーバーは
 * 「復号 → 使用 → Set-Cookie で書き戻し」の単純な流れに徹する。
 *
 * API プロキシ（/api/*）は暗黙のリフレッシュを行わない。access token が失効していれば
 * `token_expired`（401）を返し、クライアントが `/auth/refresh` を 1 本化して呼び直す。
 * こうすることで並行レスポンスの Set-Cookie が互いを上書きする事故を構造的に避ける。
 */
import {
  DEFAULT_ACCESS_TOKEN_TTL,
  DEFAULT_OAUTH_BASE,
  refreshAccessToken,
  TokenRefreshRejectedError,
} from "./github";
import type { TokenBundle } from "./tokenCookie";
import type { Env } from "./types";

/**
 * access token の期限切れ判定の前倒しバッファ（秒）。ぎりぎりでの失効を避ける。
 * クライアント側の先回りリフレッシュ閾値（`REFRESH_SKEW_SECONDS`）はこの値以上にすること
 * （小さいとサーバーだけが失効と判断し、毎リクエスト 401 → リフレッシュの往復が増える）。
 */
export const EXPIRY_BUFFER = 60;

/** 再ログインが必要な状態（refresh token 不在・GitHub による拒否）を表す。 */
export class ReauthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReauthRequiredError";
  }
}

/** access token がまだ使えるか（バッファ込み）。 */
export function isAccessTokenFresh(bundle: TokenBundle, now: number): boolean {
  return bundle.ae > now + EXPIRY_BUFFER;
}

/**
 * refresh token で access token を更新し、新しいトークン一式を返す（呼び出し側が Cookie へ書き戻す）。
 *
 * - refresh token が無い / GitHub が拒否した（`bad_refresh_token` 等）→ `ReauthRequiredError`。
 *   単回使用ローテーションのため自動リトライしてはならない（§5-3: 即・再ログイン導線）
 * - ネットワーク断・GitHub の 5xx → そのまま送出する。**再ログインを強制しない**
 *   （まだ有効な refresh token を持つ利用者を一過性障害で追い出さないため）
 *
 * ログイン状態の絶対期限（`x`）はリフレッシュで延長しない（盗まれた Cookie の無期限延命を防ぐ）。
 */
export async function refreshTokenBundle(env: Env, bundle: TokenBundle, now: number): Promise<TokenBundle> {
  if (!bundle.r) throw new ReauthRequiredError("access token expired and no refresh token available");

  let refreshed;
  try {
    refreshed = await refreshAccessToken({
      oauthBase: env.GITHUB_OAUTH_BASE ?? DEFAULT_OAUTH_BASE,
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      refreshToken: bundle.r,
    });
  } catch (err) {
    if (err instanceof TokenRefreshRejectedError) throw new ReauthRequiredError(err.message);
    throw err;
  }

  return {
    a: refreshed.access_token!,
    ae: now + (refreshed.expires_in ?? DEFAULT_ACCESS_TOKEN_TTL),
    // GitHub がローテーション後の refresh_token を返さない場合は既存値を維持する。
    r: refreshed.refresh_token ?? bundle.r,
    re: refreshed.refresh_token_expires_in ? now + refreshed.refresh_token_expires_in : bundle.re,
    x: bundle.x,
    u: bundle.u,
  };
}
