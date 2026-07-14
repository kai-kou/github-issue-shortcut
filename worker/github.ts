/**
 * GitHub App の user-to-server OAuth ヘルパー。
 * トークン交換エンドポイントは CORS 非対応のため、必ず Worker（サーバー側）で実行する（§7.1）。
 *
 * エンドポイントの base URL は引数で差し替え可能（既定は実 GitHub）。
 * E2E テストではモック GitHub（ローカル）を指すことで、実 GitHub に触れずに
 * OAuth 往復フローを検証できる（IdP モックは OAuth E2E のベストプラクティス）。
 */

/** GitHub OAuth（authorize / token）の既定 base。 */
export const DEFAULT_OAUTH_BASE = "https://github.com";
/** GitHub REST API の既定 base。 */
export const DEFAULT_API_BASE = "https://api.github.com";
/** GitHub App の access token 既定 TTL（8 時間・§7.1）。expires_in 不在時のフォールバック。 */
export const DEFAULT_ACCESS_TOKEN_TTL = 8 * 60 * 60;

const API_VERSION = "2026-03-10";
const USER_AGENT = "github-issue-shortcut";

/** GitHub 認可 URL を組み立てる（state + PKCE S256・フルページリダイレクト用）。 */
export function buildAuthorizeUrl(params: {
  oauthBase: string;
  clientId: string;
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): string {
  const url = new URL(`${params.oauthBase}/login/oauth/authorize`);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface GitHubTokenResponse {
  access_token?: string;
  /** access token の有効秒数（GitHub App は 28800 = 8h）。 */
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** authorization code をサーバー側でトークンに交換する。 */
export async function exchangeCodeForToken(params: {
  oauthBase: string;
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<GitHubTokenResponse> {
  const res = await fetch(`${params.oauthBase}/login/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json()) as GitHubTokenResponse;
  if (!res.ok || data.error || !data.access_token) {
    throw new Error(`GitHub token exchange failed: ${data.error ?? `HTTP ${res.status}`}`);
  }
  return data;
}

/** リフレッシュトークンで access token を更新する（単回使用ローテーション・A1-2）。 */
export async function refreshAccessToken(params: {
  oauthBase: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<GitHubTokenResponse> {
  const res = await fetch(`${params.oauthBase}/login/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      refresh_token: params.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as GitHubTokenResponse;
  if (!res.ok || data.error || !data.access_token) {
    throw new Error(`GitHub token refresh failed: ${data.error ?? `HTTP ${res.status}`}`);
  }
  return data;
}

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
}

/** access token を使ってログインユーザー情報を取得する。 */
export async function fetchGitHubUser(apiBase: string, accessToken: string): Promise<GitHubUser> {
  const res = await fetch(`${apiBase}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`GitHub user fetch failed: HTTP ${res.status}`);
  const user = (await res.json()) as GitHubUser;
  return { id: user.id, login: user.login, avatar_url: user.avatar_url };
}
