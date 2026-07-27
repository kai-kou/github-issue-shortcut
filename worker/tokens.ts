/**
 * トークンの鮮度判定とリフレッシュ（ステートレス版・stateless-architecture.md §5）。
 *
 * トークンは D1 ではなく暗号化 Cookie（`worker/session.ts`）にあるため、サーバー側の行ロックは
 * 存在しない。リフレッシュトークンは単回使用ローテーションのため、並行リフレッシュの直列化は
 * **クライアントの Web Locks API**（`src/auth/tokenRefresh.ts`）が担い、サーバーは
 * 「復号 → 使用 → 必要なら Set-Cookie で書き戻し」の単純な流れに徹する。
 *
 * API プロキシ（/api/*）は暗黙のリフレッシュを行わない。access token が失効していれば
 * `token_expired`（401）を返し、クライアントが `/auth/refresh` を 1 本化して呼び直す。
 * こうすることで並行レスポンスの Set-Cookie が互いを上書きする事故を構造的に避ける。
 */
import { DEFAULT_ACCESS_TOKEN_TTL, DEFAULT_OAUTH_BASE, refreshAccessToken } from "./github";
import type { TokenBundle } from "./session";
import type { Env } from "./types";

/** access token の期限切れ判定の前倒しバッファ（秒）。ぎりぎりでの失効を避ける。 */
export const EXPIRY_BUFFER = 60;

/** 再ログインが必要な状態（refresh token 不在・リフレッシュ拒否）を表す。 */
export class ReauthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReauthRequiredError";
  }
}

/** access token がまだ使えるか（バッファ込み）。 */
export function isAccessTokenFresh(bundle: TokenBundle, now: number, buffer = EXPIRY_BUFFER): boolean {
  return bundle.ae > now + buffer;
}

/**
 * refresh token で access token を更新し、新しいトークン一式を返す（呼び出し側が Cookie へ書き戻す）。
 * refresh token が無い・GitHub に拒否された場合は `ReauthRequiredError` を投げる。
 * 単回使用ローテーションのため、失敗時に自動リトライしてはならない（§5-3: 即・再ログイン導線）。
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
    throw new ReauthRequiredError(err instanceof Error ? err.message : "token refresh failed");
  }

  return {
    a: refreshed.access_token!,
    ae: now + (refreshed.expires_in ?? DEFAULT_ACCESS_TOKEN_TTL),
    // GitHub がローテーション後の refresh_token を返さない場合は既存値を維持する。
    r: refreshed.refresh_token ?? bundle.r,
    re: refreshed.refresh_token_expires_in ? now + refreshed.refresh_token_expires_in : bundle.re,
    u: bundle.u,
  };
}
