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
  sha256Base64url,
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
  fetchRepoLabels,
  GitHubApiError,
} from "./github";
import {
  checkRateLimit,
  createSession,
  createShortcut,
  deleteAccount,
  deleteSession,
  deleteShortcut,
  getUserBySessionHash,
  listShortcuts,
  nowSeconds,
  releaseIssueLogReservation,
  releaseRequestIdReservation,
  reserveIssueLog,
  reserveRequestId,
  saveTokens,
  updateShortcut,
  upsertUser,
  type UserRow,
} from "./store";
import { getValidAccessToken } from "./tokens";

/** pre-auth Cookie の TTL（10 分・§4.2-1）。 */
const PREAUTH_TTL = 10 * 60;
/** セッションの TTL（30 日）。refresh token（6 ヶ月）より短く、透過リフレッシュで延命する。 */
const SESSION_TTL = 30 * 24 * 60 * 60;
/** 二重送信防止（FR-24）の照合ウィンドウ（秒）。再タップ・タイムアウト再送を吸収する短時間ウィンドウ。 */
const DUPLICATE_SUBMISSION_WINDOW = 30;
/**
 * オフラインキュー再送の重複防止（B4-4・OQ-8）の照合ウィンドウ（秒）。Service Worker の
 * Background Sync（`vite.config.ts` の `maxRetentionTime: 24 * 60` 分＝24h）保持期間に
 * 安全マージンを加えた長時間ウィンドウ。DUPLICATE_SUBMISSION_WINDOW（30秒・再タップ対策）とは
 * 独立に、client_request_id が同じリクエストを日をまたいでも重複と判定する。
 */
const OFFLINE_QUEUE_DEDUPE_WINDOW = 26 * 60 * 60;
/** client_request_id の長さ上限（crypto.randomUUID() は36文字・将来の形式変更を見込んだ余裕）。 */
const CLIENT_REQUEST_ID_MAX_LENGTH = 100;
/**
 * アプリ側レート制限（不正利用対策・PR-4・OQ-6・2026-07-16 決定）: ユーザーあたり 1 分間に
 * 起票できる回数の上限。GitHub の二次制限（コンテンツ生成系 80 req/min）の 1/8 に抑え、
 * 本アプリ経由の連続起票が GitHub 側の制裁対象になる前にアプリ側で止める。
 */
const ISSUE_RATE_LIMIT_WINDOW_SECONDS = 60;
const ISSUE_RATE_LIMIT_PER_WINDOW = 10;

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
 * GitHub の Issue 作成エラーを種別ごとに識別可能な `{ error: { code, message } }` へ正規化する（B5-2・FR-9）。
 * 401 は再ログイン導線、403 はレート制限/権限不足の区別、410 は Issues 無効、422 は盲目リトライ禁止の
 * 表示にフロント側で振り分けられるよう、GitHub 固有の HTTP ステータスをそのまま透過する。
 */
function issueCreationErrorResponse(c: Context<{ Bindings: Env }>, err: unknown) {
  if (err instanceof GitHubApiError) {
    if (err.retryAfterSeconds !== undefined) {
      c.header("Retry-After", String(err.retryAfterSeconds));
    }
    switch (err.status) {
      case 401:
        return c.json(jsonError("reauth_required", "GitHub authorization expired; please log in again"), 401);
      case 403:
        return c.json(jsonError(err.rateLimited ? "rate_limited" : "forbidden", err.message), 403);
      case 404:
        return c.json(jsonError("not_found", "repository not found or not accessible"), 404);
      case 410:
        return c.json(jsonError("issues_disabled", "issues are disabled for this repository"), 410);
      case 422:
        // spam 判定を含むため盲目リトライ禁止（§7.1）。呼び出し側で自動再試行しないこと。
        return c.json(jsonError("validation_failed", err.message), 422);
      default:
        return c.json(jsonError("upstream_failed", "could not create issue"), 502);
    }
  }
  return c.json(jsonError("upstream_failed", "could not create issue"), 502);
}

/**
 * CSRF 対策: state を変更するエンドポイントで同一 Origin を要求する。Origin ヘッダーが
 * ない場合はブラウザ外からの直接呼び出し（curl 等）として通す（クロスサイトブラウザ由来の
 * 偽装が本チェックの対象）。
 */
function requireSameOrigin(c: Context<{ Bindings: Env }>): Response | null {
  const origin = c.req.header("Origin");
  if (origin && origin !== originOf(c.req.url)) {
    return c.json(jsonError("forbidden", "cross-origin request rejected"), 403);
  }
  return null;
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

// GET /api/labels: 選択リポジトリのラベル一覧（B3-2・FR-14）。UI が開かれたときのみ呼ばれ、
// 起票フローの初期表示（タイトルのみ起票）を遅くしない。
app.get("/api/labels", async (c) => {
  const user = await resolveSessionUser(c);
  if (user instanceof Response) return user;

  const repo = c.req.query("repo")?.trim() ?? "";
  if (!repo) {
    return c.json(jsonError("invalid_request", "repo query parameter is required"), 400);
  }

  try {
    const accessToken = await getValidAccessToken(c.env, user.id);
    const labels = await fetchRepoLabels(c.env.GITHUB_API_BASE ?? DEFAULT_API_BASE, accessToken, repo);
    return c.json({ labels });
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) {
      return c.json(jsonError("not_found", "repository not found or not accessible"), 404);
    }
    return c.json(jsonError("upstream_failed", "could not fetch labels"), 502);
  }
});

// POST /api/issues: 選択リポジトリへ Issue を作成する（B4-1・FR-6・CSRF: 同一 Origin を要求）。
app.post("/api/issues", async (c) => {
  const csrfRejection = requireSameOrigin(c);
  if (csrfRejection) return csrfRejection;
  const user = await resolveSessionUser(c);
  if (user instanceof Response) return user;

  const rateLimit = await checkRateLimit(c.env.DB, user.id, ISSUE_RATE_LIMIT_WINDOW_SECONDS, ISSUE_RATE_LIMIT_PER_WINDOW);
  if (!rateLimit.allowed) {
    c.header("Retry-After", String(rateLimit.retryAfterSeconds));
    return c.json(jsonError("rate_limited", "too many issues submitted; please wait before retrying"), 429);
  }

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(jsonError("invalid_request", "invalid JSON body"), 400);
  }
  if (typeof payload !== "object" || payload === null) {
    return c.json(jsonError("invalid_request", "invalid JSON body"), 400);
  }
  const { repo: repoValue, title: titleValue, body: bodyValue, labels: labelsValue, clientRequestId: clientRequestIdValue } =
    payload as Record<string, unknown>;
  const repo = typeof repoValue === "string" ? repoValue.trim() : "";
  const title = typeof titleValue === "string" ? titleValue.trim() : "";
  const body = typeof bodyValue === "string" ? bodyValue.trim() : "";
  const labels = Array.isArray(labelsValue)
    ? labelsValue.filter((l): l is string => typeof l === "string" && l.trim().length > 0)
    : [];
  // クライアントが起票の最初の送信試行時に生成し、SW/クライアント双方の再送経路で使い回す
  // 冪等性キー（B4-4・OQ-8）。省略可（旧クライアント・queue を経由しない直接呼び出し等）。
  const clientRequestId =
    typeof clientRequestIdValue === "string" && clientRequestIdValue.trim().length > 0
      ? clientRequestIdValue.trim().slice(0, CLIENT_REQUEST_ID_MAX_LENGTH)
      : null;
  if (!repo || !title) {
    return c.json(jsonError("invalid_request", "repo and title are required"), 400);
  }

  // 送信中の再タップ抑止は client 側（送信ボタン無効化）に加え、ほぼ同時の二重タップ・
  // タイムアウト再送等でも GitHub に二重作成させないよう、同一内容（リポジトリ + タイトル + 本文）の
  // 送信枠をサーバー側で原子的に予約してから GitHub を呼ぶ（MUST・FR-24）。GitHub API には
  // 冪等性キーがないため自前で担保する。JSON 配列でハッシュ化し、フィールド境界の曖昧さ
  // （例: repo="a", title="b\nc" と repo="a\nb", title="c" が同一ハッシュになる）を避ける。
  const contentHash = await sha256Base64url(JSON.stringify([repo, title, body, labels]));
  const reserved = await reserveIssueLog(c.env.DB, user.id, repo, contentHash, DUPLICATE_SUBMISSION_WINDOW);
  if (!reserved) {
    return c.json(
      jsonError("duplicate_submission", "this issue was already submitted moments ago"),
      409,
    );
  }

  // オフラインキュー（B4-2）の Background Sync（SW）とクライアント側キューは同一の失敗送信を
  // 独立に再送しうるため、上記の短時間窓（30秒）だけでは日をまたぐ再送の重複を防げない（B4-4・OQ-8）。
  // client_request_id が同じ再送は、経過時間に関わらず長時間窓で重複と判定する。
  if (clientRequestId !== null) {
    const requestIdReserved = await reserveRequestId(c.env.DB, user.id, clientRequestId, OFFLINE_QUEUE_DEDUPE_WINDOW);
    if (!requestIdReserved) {
      return c.json(
        jsonError("duplicate_submission", "this issue was already submitted moments ago"),
        409,
      );
    }
  }

  try {
    const accessToken = await getValidAccessToken(c.env, user.id);
    const issue = await createIssue(c.env.GITHUB_API_BASE ?? DEFAULT_API_BASE, accessToken, repo, { title, body, labels });
    return c.json({ number: issue.number, htmlUrl: issue.htmlUrl }, 201);
  } catch (err) {
    // 予約したまま失敗すると、正当な再試行まで duplicate_submission でブロックし続けてしまうため解放する。
    await releaseIssueLogReservation(c.env.DB, user.id, repo, contentHash);
    if (clientRequestId !== null) await releaseRequestIdReservation(c.env.DB, user.id, clientRequestId);
    return issueCreationErrorResponse(c, err);
  }
});

interface ShortcutInput {
  repo: string;
  labels: string[];
  title: string;
}

// GitHub 側の実制約に合わせた上限（GitHub label 名は 50 文字まで）。プリセットは
// 起動 URL の元データに過ぎないため実質無制限にする理由がなく、際限のない D1 行サイズを避ける。
const SHORTCUT_REPO_MAX_LENGTH = 140;
const SHORTCUT_TITLE_MAX_LENGTH = 500;
const SHORTCUT_LABEL_MAX_LENGTH = 50;
const SHORTCUT_LABELS_MAX_COUNT = 20;

/** リクエスト JSON を `{ repo, labels, title }` へ正規化する。少なくとも 1 フィールドが非空でなければ null。
 * 長さ上限を超える場合も null にする（C1-1・FR-16）。 */
async function parseShortcutInput(c: Context<{ Bindings: Env }>): Promise<ShortcutInput | null> {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const { repo: repoValue, labels: labelsValue, title: titleValue } = payload as Record<string, unknown>;
  const repo = typeof repoValue === "string" ? repoValue.trim() : "";
  const labels = Array.isArray(labelsValue)
    ? labelsValue.filter((l): l is string => typeof l === "string" && l.trim().length > 0).map((l) => l.trim())
    : [];
  const title = typeof titleValue === "string" ? titleValue.trim() : "";
  if (!repo && labels.length === 0 && !title) return null;
  if (repo.length > SHORTCUT_REPO_MAX_LENGTH) return null;
  if (title.length > SHORTCUT_TITLE_MAX_LENGTH) return null;
  if (labels.length > SHORTCUT_LABELS_MAX_COUNT) return null;
  if (labels.some((l) => l.length > SHORTCUT_LABEL_MAX_LENGTH)) return null;
  return { repo, labels, title };
}

function shortcutJson(shortcut: { id: string; repo: string; labels: string[]; title: string }) {
  return { id: shortcut.id, repo: shortcut.repo, labels: shortcut.labels, title: shortcut.title };
}

/** CSRF（同一 Origin）検証 + セッション認証をまとめて行う。/api/shortcuts の POST/PUT/DELETE
 * 3 ルートで同一の 4 行ガードが重複していたため共通化した（セルフレビュー指摘）。 */
async function requireAuthenticatedSameOrigin(c: Context<{ Bindings: Env }>): Promise<UserRow | Response> {
  const csrfRejection = requireSameOrigin(c);
  if (csrfRejection) return csrfRejection;
  return resolveSessionUser(c);
}

// GET /api/shortcuts: ログインユーザーのショートカットプリセット一覧（C1-1・FR-16）。
app.get("/api/shortcuts", async (c) => {
  const user = await resolveSessionUser(c);
  if (user instanceof Response) return user;
  const shortcuts = await listShortcuts(c.env.DB, user.id);
  return c.json({ shortcuts: shortcuts.map(shortcutJson) });
});

// POST /api/shortcuts: ショートカットプリセットを作成する（CSRF: 同一 Origin を要求）。
app.post("/api/shortcuts", async (c) => {
  const user = await requireAuthenticatedSameOrigin(c);
  if (user instanceof Response) return user;

  const input = await parseShortcutInput(c);
  if (!input) {
    return c.json(jsonError("invalid_request", "at least one of repo, labels, or title is required"), 400);
  }
  const shortcut = await createShortcut(c.env.DB, user.id, input);
  return c.json(shortcutJson(shortcut), 201);
});

// PUT /api/shortcuts/:id: ショートカットプリセットを更新する（所有者チェック・CSRF: 同一 Origin を要求）。
app.put("/api/shortcuts/:id", async (c) => {
  const user = await requireAuthenticatedSameOrigin(c);
  if (user instanceof Response) return user;

  const input = await parseShortcutInput(c);
  if (!input) {
    return c.json(jsonError("invalid_request", "at least one of repo, labels, or title is required"), 400);
  }
  const id = c.req.param("id");
  const updated = await updateShortcut(c.env.DB, user.id, id, input);
  if (!updated) {
    return c.json(jsonError("not_found", "shortcut not found"), 404);
  }
  return c.json(shortcutJson({ id, ...input }));
});

// DELETE /api/shortcuts/:id: ショートカットプリセットを削除する（所有者チェック・CSRF: 同一 Origin を要求）。
app.delete("/api/shortcuts/:id", async (c) => {
  const user = await requireAuthenticatedSameOrigin(c);
  if (user instanceof Response) return user;

  const deleted = await deleteShortcut(c.env.DB, user.id, c.req.param("id"));
  if (!deleted) {
    return c.json(jsonError("not_found", "shortcut not found"), 404);
  }
  return c.body(null, 204);
});

// POST /auth/logout: サーバー側セッションを無効化（CSRF: 同一 Origin を要求）。
app.post("/auth/logout", async (c) => {
  const csrfRejection = requireSameOrigin(c);
  if (csrfRejection) return csrfRejection;
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (sessionId) await deleteSession(c.env.DB, await hashSessionId(sessionId));
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.body(null, 204);
});

// DELETE /api/account: アカウント削除（FR-12・PR-3）。全テーブルの該当ユーザー行を削除し
// セッション Cookie を破棄する（CSRF: 同一 Origin を要求）。
app.delete("/api/account", async (c) => {
  const csrfRejection = requireSameOrigin(c);
  if (csrfRejection) return csrfRejection;
  const user = await resolveSessionUser(c);
  if (user instanceof Response) return user;

  await deleteAccount(c.env.DB, user.id);
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.body(null, 204);
});

// GET /setup: GitHub App の Setup URL 着地点（インストール/承認完了後の復帰・最小版）。
app.get("/setup", (c) => c.redirect("/?setup=complete", 302));

export default app;
