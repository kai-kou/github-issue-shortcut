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

/**
 * user access token に紐づく GitHub App のインストール数を取得する（A2-1・FR-4）。
 * 0 件なら「App インストール済み ∩ ユーザーがアクセス可」なリポジトリが存在しないと判定できる。
 */
export async function fetchInstallationCount(apiBase: string, accessToken: string): Promise<number> {
  const res = await fetch(`${apiBase}/user/installations`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`GitHub installations fetch failed: HTTP ${res.status}`);
  const data = (await res.json()) as { total_count?: number };
  return data.total_count ?? 0;
}

export interface CreatedIssue {
  number: number;
  htmlUrl: string;
}

/**
 * GitHub API が非 2xx を返したときに送出するエラー。呼び出し側（Worker のルートハンドラ）が
 * `status` / `rateLimited` / `retryAfterSeconds` を見て種別ごとの表示に振り分けられるよう、
 * 汎用 Error でなく構造化情報を持たせる（B5-2・FR-9）。
 */
export class GitHubApiError extends Error {
  readonly status: number;
  /** GitHub の `Retry-After` ヘッダ（秒）。二次レート制限時に付与される。 */
  readonly retryAfterSeconds?: number;
  /** 403 がレート制限由来か（権限不足の 403 と区別するため）。 */
  readonly rateLimited: boolean;

  constructor(status: number, message: string, options: { retryAfterSeconds?: number; rateLimited?: boolean } = {}) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.rateLimited = options.rateLimited ?? false;
  }
}

/** 非 2xx レスポンスから GitHubApiError を組み立てる（GitHub のエラー本文 `message` を可能なら採用）。 */
async function githubApiErrorFrom(res: Response, fallbackMessage: string): Promise<GitHubApiError> {
  let message = fallbackMessage;
  try {
    const data = (await res.json()) as { message?: string };
    if (data.message) message = data.message;
  } catch {
    // GitHub のエラー本文が JSON でない場合はフォールバック文言のまま
  }
  const retryAfterHeader = res.headers.get("Retry-After");
  const retryAfterParsed = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  // Retry-After は delta-seconds 形式を想定する。HTTP-date 形式等で数値化できない場合は無視する。
  const retryAfterSeconds = Number.isFinite(retryAfterParsed) ? retryAfterParsed : undefined;
  // 一次制限は X-RateLimit-Remaining: 0、二次制限は Retry-After 付与で判定する（§7.1）。
  const rateLimited = retryAfterSeconds !== undefined || res.headers.get("X-RateLimit-Remaining") === "0";
  return new GitHubApiError(res.status, message, { retryAfterSeconds, rateLimited });
}

/** リポジトリ（owner/repo）へ Issue を作成する（B4-1・FR-6）。API バージョンを pin する。 */
export async function createIssue(
  apiBase: string,
  accessToken: string,
  repoFullName: string,
  input: { title: string; body: string },
): Promise<CreatedIssue> {
  const res = await fetch(`${apiBase}/repos/${repoFullName}/issues`, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify(input.body ? { title: input.title, body: input.body } : { title: input.title }),
  });
  if (!res.ok) throw await githubApiErrorFrom(res, `GitHub issue creation failed: HTTP ${res.status}`);
  const data = (await res.json()) as { number: number; html_url: string };
  return { number: data.number, htmlUrl: data.html_url };
}

const PER_PAGE = 100;

function authHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": USER_AGENT,
  };
}

/** user access token に紐づく GitHub App インストール ID の一覧を取得する（ページング対応）。 */
export async function fetchInstallations(
  apiBase: string,
  accessToken: string,
  perPage: number = PER_PAGE,
): Promise<{ id: number }[]> {
  const installations: { id: number }[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${apiBase}/user/installations?per_page=${perPage}&page=${page}`, {
      headers: authHeaders(accessToken),
    });
    if (!res.ok) throw new Error(`GitHub installations fetch failed: HTTP ${res.status}`);
    const data = (await res.json()) as { installations?: { id: number }[] };
    const batch = data.installations ?? [];
    installations.push(...batch);
    if (batch.length < perPage) break;
  }
  return installations;
}

export interface RepoSummary {
  id: number;
  fullName: string;
  private: boolean;
}

/**
 * ログインユーザーが起票できるリポジトリ一覧（App インストール済み ∩ アクセス可能）を取得する（B2-1/B2-2・FR-5）。
 * インストールが 0 件なら空配列を返す。
 */
export async function fetchAccessibleRepos(apiBase: string, accessToken: string): Promise<RepoSummary[]> {
  const installations = await fetchInstallations(apiBase, accessToken);
  const repos: RepoSummary[] = [];
  for (const installation of installations) {
    for (let page = 1; ; page++) {
      const res = await fetch(
        `${apiBase}/user/installations/${installation.id}/repositories?per_page=${PER_PAGE}&page=${page}`,
        { headers: authHeaders(accessToken) },
      );
      if (!res.ok) throw new Error(`GitHub installation repositories fetch failed: HTTP ${res.status}`);
      const data = (await res.json()) as {
        repositories?: { id: number; full_name: string; private: boolean }[];
      };
      const batch = data.repositories ?? [];
      repos.push(...batch.map((r) => ({ id: r.id, fullName: r.full_name, private: r.private })));
      if (batch.length < PER_PAGE) break;
    }
  }
  const deduped = Array.from(new Map(repos.map((r) => [r.id, r])).values());
  deduped.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return deduped;
}
