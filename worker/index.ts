import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "./types";
import {
  codeChallengeS256,
  createCodeVerifier,
  decryptString,
  encryptString,
  hashSessionId,
  randomToken,
} from "./crypto";
import {
  buildAuthorizeUrl,
  DEFAULT_API_BASE,
  DEFAULT_OAUTH_BASE,
  exchangeCodeForToken,
  fetchGitHubUser,
} from "./github";
import {
  createSession,
  deleteSession,
  getUserBySessionHash,
  nowSeconds,
  saveTokens,
  upsertUser,
} from "./store";

/** GitHub App の access token 既定 TTL（8 時間・§7.1）。expires_in 不在時のフォールバック。 */
const ACCESS_TOKEN_TTL = 8 * 60 * 60;
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

app.get("/api/health", (c) => c.json({ status: "ok" }));

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
    accessExpiresAt: now + (token.expires_in ?? ACCESS_TOKEN_TTL),
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
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) return c.json(jsonError("unauthenticated", "not logged in"), 401);
  const user = await getUserBySessionHash(c.env.DB, await hashSessionId(sessionId));
  if (!user) return c.json(jsonError("unauthenticated", "session invalid or expired"), 401);
  return c.json({ login: user.login, avatarUrl: user.avatar_url, githubUserId: user.github_user_id });
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
