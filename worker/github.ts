/**
 * GitHub App の user-to-server OAuth ヘルパー。
 * トークン交換エンドポイントは CORS 非対応のため、必ず Worker（サーバー側）で実行する（§7.1）。
 */

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const API_VERSION = "2026-03-10";
const USER_AGENT = "github-issue-shortcut";

/** GitHub 認可 URL を組み立てる（state + PKCE S256・フルページリダイレクト用）。 */
export function buildAuthorizeUrl(params: {
  clientId: string;
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
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
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<GitHubTokenResponse> {
  const res = await fetch(TOKEN_URL, {
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

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
}

/** access token を使ってログインユーザー情報を取得する。 */
export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const res = await fetch(USER_URL, {
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
