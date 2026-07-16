import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "./types";
import {
  codeChallengeS256,
  createCodeVerifier,
  decryptString,
  encryptString,
  hashSessionId,
  isValidEncryptionKey,
  randomToken,
} from "./crypto";
import {
  buildAuthorizeUrl,
  createIssue,
  DEFAULT_ACCESS_TOKEN_TTL,
  DEFAULT_API_BASE,
  DEFAULT_OAUTH_BASE,
  exchangeCodeForToken,
  fetchAccessibleRepos,
  fetchGitHubUser,
  fetchInstallationCount,
} from "./github";
import {
  createSession,
  deleteSession,
  getUserBySessionHash,
  nowSeconds,
  saveTokens,
  upsertUser,
  type UserRow,
} from "./store";
import { getValidAccessToken } from "./tokens";

/** pre-auth Cookie の TTL（10 分・§4.2-1）。 */
const PREAUTH_TTL = 10 * 60;
/** セッションの TTL（30 日）。refresh token（6 ヶ月）より短く、透過リフレッシュで延命する。 */
const SESSION_TTL = 30 * 24 * 60 * 60;

const PREAUTH_COOKIE = "__Host-preauth";
const SESSION_COOKIE = "__Host-session";

const app = new Hono<{ Bindings: Env }>();

function originOf(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

function callbackUrl(reqUrl: string): string {
  return `${originOf(reqUrl)}/auth/callback`;
}

function jsonError(code: string, message: string) {
  return { error: { code, message } };
}

/**
 * セッション Cookie からログインユーザーを解決する。
 * Cookie 欠落・セッション失効時は、対応する 401 レスポンスをそのまま返す（呼び出し側は user が
 * null かどうかで分岐する）。
 */
async function resolveSessionUser(c: Context<{ Bindings: Env }>): Promise<UserRow | Response> {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) return c.json(jsonError("unauthenticated", "not logged in"), 401);
  const user = await getUserBySessionHash(c.env.DB, await hashSessionId(sessionId));
  if (!user) return c.json(jsonError("unauthenticated", "session invalid or expired"), 401);
  return user;
}

app.get("/api/health", (c) => c.json({ status: "ok" }));

// GET /api/ready: 本番の設定・プロビジョニングを自己診断する（デプロイ後スモークテスト用）。
// 「コードは正しいが本番構成が不正（鍵不正・var 欠落・D1 未マイグレーション）」を検知して
// 汎用 500 でなく可視化する。E2E green ≠ 本番動作、のギャップを埋める（docs/testing-e2e.md）。
app.get("/api/ready", async (c) => {
  const checks = {
    encryptionKey: isValidEncryptionKey(c.env.TOKEN_ENCRYPTION_KEY),
    clientId: Boolean(c.env.GITHUB_CLIENT_ID),
    database: false,
  };
  try {
    await c.env.DB.prepare("SELECT 1 FROM users LIMIT 1").all();
    checks.database = true;
  } catch {
    checks.database = false;
  }
  const ready = checks.encryptionKey && checks.clientId && checks.database;
  return c.json({ ready, checks }, ready ? 200 : 503);
});

// GET /auth/login: state + PKCE を生成し pre-auth Cookie に保存して GitHub へフルページリダイレクト。
app.get("/auth/login", async (c) => {
  const state = randomToken(16);
  const verifier = createCodeVerifier();
  const challenge = await codeChallengeS256(verifier);
  const preauth = await encryptString(c.env.TOKEN_ENCRYPTION_KEY, JSON.stringify({ state, verifier }));

  setCookie(c, PREAUTH_COOKIE, preauth, {
    httpOnly: true,
    secure: true,
    path: "/",
    sameSite: "Lax",
    maxAge: PREAUTH_TTL,
  });

  const authorizeUrl = buildAuthorizeUrl({
    oauthBase: c.env.GITHUB_OAUTH_BASE ?? DEFAULT_OAUTH_BASE,
    clientId: c.env.GITHUB_CLIENT_ID,
    state,
    codeChallenge: challenge,
    redirectUri: callbackUrl(c.req.url),
  });
  return c.redirect(authorizeUrl, 302);
});

// GET /auth/callback: state 検証 → トークン交換 → ユーザー取得 → 暗号化保存 → セッション発行。
app.get("/auth/callback", async (c) => {
  const code = c.req.query("code");
  const stateParam = c.req.query("state");
  const preauth = getCookie(c, PREAUTH_COOKIE);
  deleteCookie(c, PREAUTH_COOKIE, { path: "/", secure: true });

  if (!code || !stateParam || !preauth) {
    return c.json(jsonError("invalid_request", "missing code, state, or pre-auth cookie"), 400);
  }

  let pre: { state: string; verifier: string };
  try {
    pre = JSON.parse(await decryptString(c.env.TOKEN_ENCRYPTION_KEY, preauth));
  } catch {
    return c.json(jsonError("invalid_preauth", "pre-auth cookie could not be read"), 400);
  }
  if (pre.state !== stateParam) {
    return c.json(jsonError("state_mismatch", "state does not match"), 400);
  }

  let token;
  let ghUser;
  try {
    token = await exchangeCodeForToken({
      oauthBase: c.env.GITHUB_OAUTH_BASE ?? DEFAULT_OAUTH_BASE,
      clientId: c.env.GITHUB_CLIENT_ID,
      clientSecret: c.env.GITHUB_CLIENT_SECRET,
      code,
      codeVerifier: pre.verifier,
      redirectUri: callbackUrl(c.req.url),
    });
    ghUser = await fetchGitHubUser(c.env.GITHUB_API_BASE ?? DEFAULT_API_BASE, token.access_token!);
  } catch {
    return c.json(jsonError("oauth_failed", "GitHub authorization failed"), 502);
  }

  const now = nowSeconds();
  const userId = await upsertUser(c.env.DB, ghUser);
  const accessEnc = await encryptString(c.env.TOKEN_ENCRYPTION_KEY, token.access_token!);
  const refreshEnc = token.refresh_token
    ? await encryptString(c.env.TOKEN_ENCRYPTION_KEY, token.refresh_token)
    : null;
  await saveTokens(c.env.DB, userId, {
    accessEnc,
    accessExpiresAt: now + (token.expires_in ?? DEFAULT_ACCESS_TOKEN_TTL),
    refreshEnc,
    refreshExpiresAt: token.refresh_token_expires_in ? now + token.refresh_token_expires_in : null,
  });

  const sessionId = randomToken(32);
  await createSession(c.env.DB, await hashSessionId(sessionId), userId, SESSION_TTL);
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    path: "/",
    sameSite: "Lax",
    maxAge: SESSION_TTL,
  });
  return c.redirect("/", 302);
});

// GET /api/me: 現在のログインユーザー情報。
app.get("/api/me", async (c) => {
  const user = await resolveSessionUser(c);
  if (user instanceof Response) return user;
  return c.json({ login: user.login, avatarUrl: user.avatar_url, githubUserId: user.github_user_id });
});

// GET /api/installations: ログインユーザーの GitHub App インストール数（A2-1・FR-4）。
// 0 件なら「App 未インストール」としてフロントがオンボーディング誘導を表示する。
app.get("/api/installations", async (c) => {
  const user = await resolveSessionUser(c);
  if (user instanceof Response) return user;

  try {
    const accessToken = await getValidAccessToken(c.env, user.id);
    const count = await fetchInstallationCount(c.env.GITHUB_API_BASE ?? DEFAULT_API_BASE, accessToken);
    return c.json({ installed: count > 0 });
  } catch {
    return c.json(jsonError("upstream_failed", "could not check GitHub App installations"), 502);
  }
});

// GET /api/repos: ログインユーザーが起票できるリポジトリ一覧（App インストール済み ∩ アクセス可能・B2-1/B2-2）。
app.get("/api/repos", async (c) => {
  const user = await resolveSessionUser(c);
  if (user instanceof Response) return user;

  try {
    const accessToken = await getValidAccessToken(c.env, user.id);
    const repos = await fetchAccessibleRepos(c.env.GITHUB_API_BASE ?? DEFAULT_API_BASE, accessToken);
    return c.json({ repos });
  } catch {
    return c.json(jsonError("upstream_failed", "could not fetch repositories"), 502);
  }
});

// POST /api/issues: 選択リポジトリへ Issue を作成する（B4-1・FR-6・CSRF: 同一 Origin を要求）。
app.post("/api/issues", async (c) => {
  const origin = c.req.header("Origin");
  if (origin && origin !== originOf(c.req.url)) {
    return c.json(jsonError("forbidden", "cross-origin request rejected"), 403);
  }
  const user = await resolveSessionUser(c);
  if (user instanceof Response) return user;

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(jsonError("invalid_request", "invalid JSON body"), 400);
  }
  if (typeof payload !== "object" || payload === null) {
    return c.json(jsonError("invalid_request", "invalid JSON body"), 400);
  }
  const { repo: repoValue, title: titleValue, body: bodyValue } = payload as Record<string, unknown>;
  const repo = typeof repoValue === "string" ? repoValue.trim() : "";
  const title = typeof titleValue === "string" ? titleValue.trim() : "";
  const body = typeof bodyValue === "string" ? bodyValue.trim() : "";
  if (!repo || !title) {
    return c.json(jsonError("invalid_request", "repo and title are required"), 400);
  }

  try {
    const accessToken = await getValidAccessToken(c.env, user.id);
    const issue = await createIssue(c.env.GITHUB_API_BASE ?? DEFAULT_API_BASE, accessToken, repo, { title, body });
    return c.json({ number: issue.number, htmlUrl: issue.htmlUrl }, 201);
  } catch {
    return c.json(jsonError("upstream_failed", "could not create issue"), 502);
  }
});

// POST /auth/logout: サーバー側セッションを無効化（CSRF: 同一 Origin を要求）。
app.post("/auth/logout", async (c) => {
  const origin = c.req.header("Origin");
  if (origin && origin !== originOf(c.req.url)) {
    return c.json(jsonError("forbidden", "cross-origin request rejected"), 403);
  }
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (sessionId) await deleteSession(c.env.DB, await hashSessionId(sessionId));
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.body(null, 204);
});

// GET /setup: GitHub App の Setup URL 着地点（インストール/承認完了後の復帰・最小版）。
app.get("/setup", (c) => c.redirect("/?setup=complete", 302));

export default app;
