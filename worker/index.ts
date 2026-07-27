import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "./types";
import {
  codeChallengeS256,
  createCodeVerifier,
  isValidEncryptionKey,
  openVersioned,
  randomToken,
  sealVersioned,
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
  revokeAccessToken,
} from "./github";
import {
  checkRateLimit,
  cleanupStaleIssueLog,
  cleanupStaleRateLimits,
  cleanupStaleRequestIds,
  deleteUserRecords,
  nowSeconds,
  releaseIssueLogReservation,
  releaseRequestIdReservation,
  reserveIssueLog,
  reserveRequestId,
} from "./store";
import {
  clearTokenCookies,
  currentKeyVersion,
  hasValidKeyVersionSetting,
  readTokenBundle,
  SESSION_MAX_AGE,
  setTokenCookies,
  type TokenBundle,
} from "./tokenCookie";
import { isAccessTokenFresh, ReauthRequiredError, refreshTokenBundle } from "./tokens";

/** pre-auth Cookie の TTL（10 分・§4.2-1）。 */
const PREAUTH_TTL = 10 * 60;
/** 二重送信防止（FR-24）の照合ウィンドウ（秒）。再タップ・タイムアウト再送を吸収する短時間ウィンドウ。 */
const DUPLICATE_SUBMISSION_WINDOW = 30;
/**
 * オフラインキュー再送の重複防止（B4-4・OQ-8）の照合ウィンドウ（秒）。Service Worker の
 * Background Sync（`vite.config.ts` の `maxRetentionTime: 24 * 60` 分＝24h）保持期間に
 * 安全マージンを加えた長時間ウィンドウ。DUPLICATE_SUBMISSION_WINDOW（30秒・再タップ対策）とは
 * 独立に、client_request_id が同じリクエストを日をまたいでも重複と判定する。
 */
const OFFLINE_QUEUE_DEDUPE_WINDOW = 26 * 60 * 60;
/**
 * 一時行（`issue_log` / `request_ids` / `rate_limits`）の保持期間（#71・#164）。
 * 最長の照合ウィンドウ（`OFFLINE_QUEUE_DEDUPE_WINDOW` = 26 時間）に十分な安全マージンを取った上で、
 * Cron Trigger（`scheduled` ハンドラ）が古い行を削除する。プライバシーポリシーの「最長 7 日で
 * 自動削除」はこの値が根拠なので、変更するときはポリシー文言も合わせること。
 */
const TEMP_RECORD_RETENTION_SECONDS = 7 * 24 * 60 * 60;
/** client_request_id の長さ上限（crypto.randomUUID() は36文字・将来の形式変更を見込んだ余裕）。 */
const CLIENT_REQUEST_ID_MAX_LENGTH = 100;
/**
 * アプリ側レート制限（不正利用対策・PR-4・OQ-6・2026-07-16 決定）: ユーザーあたり 1 分間に
 * 起票できる回数の上限。GitHub の二次制限（コンテンツ生成系 80 req/min）の 1/8 に抑え、
 * 本アプリ経由の連続起票が GitHub 側の制裁対象になる前にアプリ側で止める。
 *
 * E2E では単一のモックユーザーを ~40 個の spec が使い回すため、この本番向けの上限だと
 * スイート後半のテストが本物の不正利用と誤判定され 429 で落ちる（テスト分離の問題であり
 * アプリのバグではない）。`ISSUE_RATE_LIMIT_PER_WINDOW_OVERRIDE`（E2E の wrangler dev
 * 起動時のみ設定・playwright.config.ts 参照）で上限を引き上げられるようにし、本番の
 * デフォルト値はこの定数のまま変更しない。
 */
const ISSUE_RATE_LIMIT_WINDOW_SECONDS = 60;
const ISSUE_RATE_LIMIT_PER_WINDOW = 10;

/** override が正の整数として解釈できればそれを使い、それ以外（未設定・不正値）は本番既定値のまま。 */
function resolveIssueRateLimitPerWindow(override: string | undefined): number {
  const parsed = override ? Number(override) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : ISSUE_RATE_LIMIT_PER_WINDOW;
}

const PREAUTH_COOKIE = "__Host-preauth";

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
 * トークン Cookie から「いま使える access token」を解決する（ステートレス認証・§4）。
 *
 * Cookie 欠落・開封不能（改ざん・鍵ローテーション）は `unauthenticated`（401）、access token の
 * 期限切れは `token_expired`（401）を返す。**ここでは暗黙のリフレッシュを行わない**（§5-2）:
 * クライアントが Web Locks で 1 本化した `/auth/refresh` を呼び直し、同じリクエストを再送する。
 * 並行 API レスポンスの Set-Cookie が互いを上書きする事故を構造的に避けるための分離。
 */
async function resolveTokens(c: Context<{ Bindings: Env }>): Promise<TokenBundle | Response> {
  const now = nowSeconds();
  const bundle = await readTokenBundle(c, now);
  if (!bundle) return c.json(jsonError("unauthenticated", "not logged in"), 401);
  if (!isAccessTokenFresh(bundle, now)) {
    return c.json(jsonError("token_expired", "access token expired; refresh required"), 401);
  }
  return bundle;
}

/**
 * GitHub 側でトークンを失効させる（ベストエフォート）。
 * 失敗しても Cookie 破棄は続行する（ログアウト操作自体をネットワーク障害で失敗させない）。
 */
async function revokeTokenBestEffort(c: Context<{ Bindings: Env }>, bundle: TokenBundle): Promise<void> {
  await revokeAccessToken({
    apiBase: c.env.GITHUB_API_BASE ?? DEFAULT_API_BASE,
    clientId: c.env.GITHUB_CLIENT_ID,
    clientSecret: c.env.GITHUB_CLIENT_SECRET,
    accessToken: bundle.a,
  });
}

/** 重複防止・レート制限のキー（P3 でクライアント側へ移すまでの暫定・GitHub の数値ユーザー ID）。 */
function userKeyOf(bundle: TokenBundle): string {
  return String(bundle.u);
}

app.get("/api/health", (c) => c.json({ status: "ok" }));

// GET /api/ready: 本番の設定・プロビジョニングを自己診断する（デプロイ後スモークテスト用）。
// 「コードは正しいが本番構成が不正（鍵不正・var 欠落・D1 未マイグレーション）」を検知して
// 汎用 500 でなく可視化する。E2E green ≠ 本番動作、のギャップを埋める（docs/testing-e2e.md）。
app.get("/api/ready", async (c) => {
  const checks = {
    encryptionKey: isValidEncryptionKey(c.env.TOKEN_ENCRYPTION_KEY),
    // TOKEN_KEY_VERSION の不正値はサイレントに 1 へフォールバックするため、設定ミスをここで可視化する
    // （鍵を交換したのにバージョンが上がらないと、旧鍵の Cookie を安価に弾けない）。
    keyVersion: hasValidKeyVersionSetting(c.env),
    clientId: Boolean(c.env.GITHUB_CLIENT_ID),
    database: false,
  };
  try {
    // 個人データは持たないが、重複防止・レート制限用のテーブル（P3 まで暫定）は必要。
    // 列まで指定するのは「Worker だけ先にデプロイされ migration が未適用」を検知するため
    // （テーブルの存在だけを見ると、旧スキーマ（user_id 列）でも ready を返してしまう）。
    await c.env.DB.prepare("SELECT user_key FROM issue_log LIMIT 1").all();
    checks.database = true;
  } catch {
    checks.database = false;
  }
  const ready = checks.encryptionKey && checks.keyVersion && checks.clientId && checks.database;
  return c.json({ ready, checks }, ready ? 200 : 503);
});

// GET /auth/login: state + PKCE を生成し pre-auth Cookie に保存して GitHub へフルページリダイレクト。
app.get("/auth/login", async (c) => {
  const state = randomToken(16);
  const verifier = createCodeVerifier();
  const challenge = await codeChallengeS256(verifier);
  const preauth = await sealVersioned(
    c.env.TOKEN_ENCRYPTION_KEY,
    currentKeyVersion(c.env),
    JSON.stringify({ state, verifier }),
  );

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

// GET /auth/callback: state 検証 → トークン交換 → ユーザー取得 → 暗号化トークン Cookie を発行。
// サーバー側には何も保存しない（ステートレス・§4）。
app.get("/auth/callback", async (c) => {
  const code = c.req.query("code");
  const stateParam = c.req.query("state");
  const preauth = getCookie(c, PREAUTH_COOKIE);
  deleteCookie(c, PREAUTH_COOKIE, { path: "/", secure: true });

  // OAuth during installation ON の GitHub App は、インストール完了後に /auth/login を経由せず
  // installation_id/setup_action 付きでこの callback へ復帰させる（pre-auth Cookie は持たない）。
  // ログイン用の state/code チェックでは弾かず、フロントに認証状態の再判定をさせる。
  if (!preauth && (c.req.query("installation_id") || c.req.query("setup_action"))) {
    return c.redirect(`${originOf(c.req.url)}/?setup=complete`, 302);
  }

  if (!code || !stateParam || !preauth) {
    return c.json(jsonError("invalid_request", "missing code, state, or pre-auth cookie"), 400);
  }

  let pre: { state: string; verifier: string };
  try {
    pre = JSON.parse(await openVersioned(c.env.TOKEN_ENCRYPTION_KEY, currentKeyVersion(c.env), preauth));
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
  await setTokenCookies(
    c,
    {
      a: token.access_token!,
      ae: now + (token.expires_in ?? DEFAULT_ACCESS_TOKEN_TTL),
      r: token.refresh_token ?? null,
      re: token.refresh_token_expires_in ? now + token.refresh_token_expires_in : null,
      x: now + SESSION_MAX_AGE,
      u: ghUser.id,
    },
    now,
  );
  return c.redirect("/", 302);
});

// POST /auth/refresh: refresh token をローテーションして Cookie を書き戻す（§5・CSRF: 同一 Origin を要求）。
// クライアントは Web Locks API でこの呼び出しを 1 本化する（多タブ・SW をまたいだ同時リフレッシュは
// 単回使用の refresh token を失効させ、再ログインを招くため）。
app.post("/auth/refresh", async (c) => {
  const csrfRejection = requireSameOrigin(c);
  if (csrfRejection) return csrfRejection;

  const now = nowSeconds();
  const bundle = await readTokenBundle(c, now);
  if (!bundle) {
    // 開けない Cookie（改ざん・鍵ローテーション・絶対期限切れ）は残しておくと、クライアントが
    // 「まだ期限内」と誤認して 401 を繰り返す。ここで確実に掃除して再ログイン導線へ倒す。
    clearTokenCookies(c);
    return c.json(jsonError("unauthenticated", "not logged in"), 401);
  }

  // ロック取得までの間に他タブが更新済みなら GitHub を呼ばない（二重ローテーション＝失効の回避）。
  if (isAccessTokenFresh(bundle, now)) {
    return c.json({ expiresAt: bundle.ae });
  }

  try {
    const refreshed = await refreshTokenBundle(c.env, bundle, now);
    await setTokenCookies(c, refreshed, now);
    return c.json({ expiresAt: refreshed.ae });
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      // 単回使用トークンの失効は自動リトライせず、Cookie を破棄して再ログイン導線へ倒す（§5-3）。
      clearTokenCookies(c);
      return c.json(jsonError("reauth_required", "GitHub authorization expired; please log in again"), 401);
    }
    return c.json(jsonError("upstream_failed", "could not refresh GitHub token"), 502);
  }
});

// GET /api/me: 現在のログインユーザー情報。サーバーに保存しないため GitHub /user を都度取得する
// （クライアント側は localStorage にキャッシュ済みで、起動時の表示はネットワークを待たない・#119）。
app.get("/api/me", async (c) => {
  const bundle = await resolveTokens(c);
  if (bundle instanceof Response) return bundle;

  try {
    const ghUser = await fetchGitHubUser(c.env.GITHUB_API_BASE ?? DEFAULT_API_BASE, bundle.a);
    return c.json({ login: ghUser.login, avatarUrl: ghUser.avatar_url, githubUserId: ghUser.id });
  } catch {
    return c.json(jsonError("upstream_failed", "could not fetch GitHub user"), 502);
  }
});

// GET /api/installations: ログインユーザーの GitHub App インストール数（A2-1・FR-4）。
// 0 件なら「App 未インストール」としてフロントがオンボーディング誘導を表示する。
app.get("/api/installations", async (c) => {
  const bundle = await resolveTokens(c);
  if (bundle instanceof Response) return bundle;

  try {
    const count = await fetchInstallationCount(c.env.GITHUB_API_BASE ?? DEFAULT_API_BASE, bundle.a);
    return c.json({ installed: count > 0 });
  } catch {
    return c.json(jsonError("upstream_failed", "could not check GitHub App installations"), 502);
  }
});

// GET /api/repos: ログインユーザーが起票できるリポジトリ一覧（App インストール済み ∩ アクセス可能・B2-1/B2-2）。
app.get("/api/repos", async (c) => {
  const bundle = await resolveTokens(c);
  if (bundle instanceof Response) return bundle;

  try {
    const repos = await fetchAccessibleRepos(c.env.GITHUB_API_BASE ?? DEFAULT_API_BASE, bundle.a);
    return c.json({ repos });
  } catch {
    return c.json(jsonError("upstream_failed", "could not fetch repositories"), 502);
  }
});

// GET /api/labels: 選択リポジトリのラベル一覧（B3-2・FR-14）。UI が開かれたときのみ呼ばれ、
// 起票フローの初期表示（タイトルのみ起票）を遅くしない。
app.get("/api/labels", async (c) => {
  const bundle = await resolveTokens(c);
  if (bundle instanceof Response) return bundle;

  const repo = c.req.query("repo")?.trim() ?? "";
  if (!repo) {
    return c.json(jsonError("invalid_request", "repo query parameter is required"), 400);
  }

  try {
    const labels = await fetchRepoLabels(c.env.GITHUB_API_BASE ?? DEFAULT_API_BASE, bundle.a, repo);
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
  // 認証・トークンの鮮度はレート制限や重複予約より前に確定させる。期限切れ（401 token_expired）で
  // 引き返す場合に予約・カウンタを消費してしまうと、クライアントがリフレッシュ後に同じ内容を
  // 再送したとき duplicate_submission で弾かれてしまうため。
  const bundle = await resolveTokens(c);
  if (bundle instanceof Response) return bundle;
  const userKey = userKeyOf(bundle);

  const rateLimitPerWindow = resolveIssueRateLimitPerWindow(c.env.ISSUE_RATE_LIMIT_PER_WINDOW_OVERRIDE);
  const rateLimit = await checkRateLimit(c.env.DB, userKey, ISSUE_RATE_LIMIT_WINDOW_SECONDS, rateLimitPerWindow);
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
  // 上限超過は他の入力（shortcut フィールド等）と同様「無視」であり、切り詰めはしない
  // （切り詰めると、別々の長い ID が同じ切り詰め後の値に衝突し、無関係な送信を誤って
  // 重複判定してしまうため）。
  const clientRequestIdTrimmed = typeof clientRequestIdValue === "string" ? clientRequestIdValue.trim() : "";
  const clientRequestId =
    clientRequestIdTrimmed.length > 0 && clientRequestIdTrimmed.length <= CLIENT_REQUEST_ID_MAX_LENGTH
      ? clientRequestIdTrimmed
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
  const reserved = await reserveIssueLog(c.env.DB, userKey, repo, contentHash, DUPLICATE_SUBMISSION_WINDOW);
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
    const requestIdReserved = await reserveRequestId(c.env.DB, userKey, clientRequestId, OFFLINE_QUEUE_DEDUPE_WINDOW);
    if (!requestIdReserved) {
      // この呼び出しでは GitHub を呼んでいない（=実質的に何も送信していない）ため、直前に
      // reserveIssueLog が新規予約・更新した content_hash 予約を残したままにしない。残すと、
      // 以降 30 秒はこの内容の正当な別送信まで duplicate_submission としてブロックしてしまう。
      await releaseIssueLogReservation(c.env.DB, userKey, repo, contentHash);
      return c.json(
        jsonError("duplicate_submission", "this issue was already submitted moments ago"),
        409,
      );
    }
  }

  try {
    const issue = await createIssue(c.env.GITHUB_API_BASE ?? DEFAULT_API_BASE, bundle.a, repo, { title, body, labels });
    return c.json({ number: issue.number, htmlUrl: issue.htmlUrl }, 201);
  } catch (err) {
    // 予約したまま失敗すると、正当な再試行まで duplicate_submission でブロックし続けてしまうため解放する。
    // 一方の解放が例外を投げても他方は解放を試みる（片方だけ最大 26h 取り残される事故を避ける）。
    await Promise.allSettled([
      releaseIssueLogReservation(c.env.DB, userKey, repo, contentHash),
      ...(clientRequestId !== null ? [releaseRequestIdReservation(c.env.DB, userKey, clientRequestId)] : []),
    ]);
    return issueCreationErrorResponse(c, err);
  }
});

// POST /auth/logout: トークン Cookie を破棄する（CSRF: 同一 Origin を要求）。
// サーバー側にセッションを持たないため、Cookie を消せばそれでログアウトが完了する。
app.post("/auth/logout", async (c) => {
  const csrfRejection = requireSameOrigin(c);
  if (csrfRejection) return csrfRejection;
  const bundle = await readTokenBundle(c, nowSeconds());
  // Cookie を消すだけでは、値をコピーされていた場合にアクセスを止められない（自己完結型の
  // クレデンシャルのため）。GitHub 側でトークン自体を失効させてログアウトを実効化する。
  if (bundle) await revokeTokenBestEffort(c, bundle);
  clearTokenCookies(c);
  return c.body(null, 204);
});

// DELETE /api/account: アカウント削除（FR-12・PR-3）。サーバーは個人データを保持しないため、
// 消すのはトークン Cookie だけ（端末内データの削除はクライアント側、GitHub 連携解除は利用者操作）。
// 未認証でも 204 を返さず 401 にするのは、UI の削除導線がログイン済み前提のため（挙動は従来どおり）。
app.delete("/api/account", async (c) => {
  const csrfRejection = requireSameOrigin(c);
  if (csrfRejection) return csrfRejection;
  const bundle = await readTokenBundle(c, nowSeconds());
  if (!bundle) return c.json(jsonError("unauthenticated", "not logged in"), 401);

  // 個人データは保持していないが、重複防止・レート制限の一時行は GitHub の数値ユーザー ID を
  // キーに持つため、退会時に確実に消す（残っていないことを保証する）。
  await deleteUserRecords(c.env.DB, userKeyOf(bundle));
  await revokeTokenBestEffort(c, bundle);
  clearTokenCookies(c);
  return c.body(null, 204);
});

// GET /setup: GitHub App の Setup URL 着地点（インストール/承認完了後の復帰・最小版）。
app.get("/setup", (c) => c.redirect("/?setup=complete", 302));

export default {
  fetch: app.fetch,
  // Cron Trigger（wrangler.jsonc の triggers.crons）: issue_log の保持期間ポリシー（#71）を実行する。
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // 一時行（いずれも user_key = GitHub の数値ユーザー ID を含む）を保持期間で掃除する。
    // 1 つでも掃除漏れがあると「サーバーに個人データを残さない」方針が崩れるため、
    // 片方が失敗しても他方は実行されるよう allSettled でまとめる。
    ctx.waitUntil(
      Promise.allSettled([
        cleanupStaleIssueLog(env.DB, TEMP_RECORD_RETENTION_SECONDS),
        cleanupStaleRequestIds(env.DB, TEMP_RECORD_RETENTION_SECONDS),
        cleanupStaleRateLimits(env.DB, TEMP_RECORD_RETENTION_SECONDS),
      ]),
    );
  },
};
