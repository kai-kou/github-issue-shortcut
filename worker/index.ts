import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "./types";
import {
  codeChallengeS256,
  createCodeVerifier,
  hmacSha256Base64url,
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
import { SECURITY_HEADERS } from "./securityHeaders";
import { nowSeconds } from "./time";
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
/**
 * アプリ側レート制限（不正利用対策・PR-4・OQ-6）のウィンドウ長（秒）。上限値そのものは
 * Workers Rate Limiting binding 側の設定（wrangler.jsonc の `ratelimits`・起票 10 件/分）で、
 * ここではその period と揃えた値を 429 の `Retry-After` に使う。binding は残り時間を返さないため、
 * 「最長でも 1 ウィンドウ待てば回復する」上界として保守的に固定値を返す（従来の互換）。
 */
const ISSUE_RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * 同一内容の連投抑止（不正利用対策・PR-4 拡張・#179）の Retry-After に使うウィンドウ長（秒）。
 * Rate Limiting binding の period（10/60 のみ選択可）と揃える。
 */
const DUPLICATE_SUBMISSION_WINDOW_SECONDS = 10;

/**
 * `GET /auth/login` のレート制限（#207）のウィンドウ長（秒）。`wrangler.jsonc` の
 * `AUTH_LOGIN_RATE_LIMIT` の period と揃え、429 の `Retry-After` に使う（binding は残り時間を
 * 返さないため、他の制限と同じく「最長でも 1 ウィンドウ待てば回復する」上界を返す）。
 */
const AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * 入力長・件数の上限（不正利用対策・#179）。GitHub の実測上限（dead-claudia/github-limits、
 * 2026-07-28 に一次情報を確認）に合わせ、超過分は GitHub へ転送する前にここで 400 にして弾く
 * （従来は巨大ペイロードがそのまま GitHub へ転送され、GitHub 側 422 になるまで Worker CPU と
 * レート制限枠を消費していた）。label の 1 件あたり上限（50 文字）は GitHub の実測上限であり、
 * `src/shortcuts/shortcutsStore.ts` の `SHORTCUT_LABEL_MAX_LENGTH` と同じ値に揃えている。
 */
const ISSUE_TITLE_MAX_LENGTH = 256;
const ISSUE_BODY_MAX_LENGTH = 65536;
const ISSUE_LABEL_MAX_LENGTH = 50;
const ISSUE_LABELS_MAX_COUNT = 100;

/**
 * リポジトリ名（`owner/name`）の形式検証。`worker/github.ts` は受け取った値を
 * `${apiBase}/repos/${repoFullName}/issues` のように文字列結合して `fetch` に渡すため、形式を
 * ここで固定しないと URL パーサーの正規化が働き、実際のリクエスト先が別のエンドポイントへ化ける
 * （例: `../orgs/x/repos#` → `https://api.github.com/orgs/x/repos`）。
 *
 * owner は GitHub のアカウント名の規則（英数字とハイフンのみ・先頭末尾はハイフン不可・39 文字以内）に
 * 従う。repo 名は `.` `_` `-` を先頭に置けるため（`owner/.github` は実在する正規のリポジトリ）
 * 文字種だけを制限し、パスセグメントとして特別扱いされる `.` と `..` だけを別途弾く。
 * この 2 つさえ通さなければ、`/` `#` `?` `%` を含まない値は URL 正規化の影響を受けない。
 */
const REPO_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

function isValidRepoFullName(value: string): boolean {
  const slash = value.indexOf("/");
  if (slash < 0 || value.indexOf("/", slash + 1) >= 0) return false;
  const owner = value.slice(0, slash);
  const name = value.slice(slash + 1);
  if (!REPO_OWNER_PATTERN.test(owner) || !REPO_NAME_PATTERN.test(name)) return false;
  return name !== "." && name !== "..";
}

/**
 * 使用するレート制限バインディングを選ぶ。既定は本番の上限（10 件/分）で、E2E の
 * wrangler dev 起動時（`ISSUE_RATE_LIMIT_RELAXED_ENABLED=1`）だけ緩い上限へ切り替える
 * （単一モックユーザーを全 spec が使い回すため・playwright.config.ts）。
 */
function resolveIssueRateLimiter(env: Env): RateLimit {
  return env.ISSUE_RATE_LIMIT_RELAXED_ENABLED === "1" ? env.ISSUE_RATE_LIMIT_RELAXED : env.ISSUE_RATE_LIMIT;
}

/**
 * 同一内容の連投抑止バインディングを選ぶ（`resolveIssueRateLimiter` と同じ切り替え方針）。
 */
function resolveIssueDuplicateLimiter(env: Env): RateLimit {
  return env.ISSUE_RATE_LIMIT_RELAXED_ENABLED === "1"
    ? env.ISSUE_DUPLICATE_SUBMISSION_LIMIT_RELAXED
    : env.ISSUE_DUPLICATE_SUBMISSION_LIMIT;
}

/**
 * `GET /auth/login` のレート制限バインディングを選ぶ（#207・上 2 つと同じ切り替え方針）。
 * E2E は全 spec が同一ホストから何度もログインするため、本番の上限では後半が 429 で落ちる。
 */
function resolveAuthLoginRateLimiter(env: Env): RateLimit {
  return env.ISSUE_RATE_LIMIT_RELAXED_ENABLED === "1" ? env.AUTH_LOGIN_RATE_LIMIT_RELAXED : env.AUTH_LOGIN_RATE_LIMIT;
}

const PREAUTH_COOKIE = "__Host-preauth";

const app = new Hono<{ Bindings: Env }>();

// 全レスポンスにセキュリティヘッダーを付ける（#209・多層防御）。静的アセットは Worker を
// 経由しない（`run_worker_first` が /api/* /auth/* /setup だけ）ため、そちらは public/_headers が
// 同じ値を付ける。詳細と二重管理の理由は worker/securityHeaders.ts のコメント。
app.use("*", async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    c.res.headers.set(name, value);
  }
});

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

/**
 * レート制限のキー（PR-4）。GitHub の数値ユーザー ID を **秘密鍵付きハッシュ（HMAC-SHA256）** にして渡し、
 * Cloudflare 側にはカウンタと逆引き不能な鍵だけが載るようにする（保持ゼロ方針・§8）。
 * 無塩ハッシュにしないのは、GitHub のユーザー ID が公開かつ実質連番で、総当たりで逆引きできてしまうため
 * （それでは「ユーザー ID そのものは渡さない」というプライバシーポリシーの主張が成立しない）。
 * ID は AEAD で認証済みの Cookie 由来のため、他人になりすましてキーを分散させることはできない。
 */
function rateLimitKey(env: Env, bundle: TokenBundle): Promise<string> {
  return hmacSha256Base64url(env.TOKEN_ENCRYPTION_KEY, `issue-rate-limit:${bundle.u}`);
}

/**
 * `GET /auth/login` のレート制限キー（#207）。このエンドポイントは **認証不要** のため、
 * 他の 2 つのように「ユーザー ID 由来」のキーは作れない。攻撃者と正規利用者を区別できる粒度は
 * 接続元 IP だけなので、Cloudflare がエッジで付与する `CF-Connecting-IP`（クライアントからは
 * 詐称できない）を使う。
 *
 * ただし **生 IP を Cloudflare のカウンタキーに渡さない**。`rateLimitKey` と同じく秘密鍵付き
 * ハッシュ（HMAC-SHA256）にして、逆引き不能な鍵とカウンタだけが載るようにする
 * （プライバシーポリシー §2「サーバーは個人データを保存しない」との整合・保持ゼロ方針 §8）。
 *
 * ヘッダーが無い環境（`wrangler dev` 等）は固定バケットへ落ちる。全アクセスが 1 つの
 * カウンタを共有することになるが、本番では Cloudflare が必ず付与するため影響しない。
 */
function authLoginRateLimitKey(env: Env, clientIp: string | undefined): Promise<string> {
  return hmacSha256Base64url(env.TOKEN_ENCRYPTION_KEY, `auth-login-rate-limit:${clientIpBucket(clientIp)}`);
}

/**
 * レート制限の集計単位にする接続元識別子。**IPv6 は /64（先頭 4 ハクテット）に丸める**。
 *
 * 丸めないと制限が実質無効になる: IPv6 では 1 契約者に /64〜/56 が割り当てられるのが普通で、
 * 攻撃者は自分のプレフィックス内でアドレスを 1 リクエストごとに変えるだけで、毎回別バケットとして
 * 数えられる（Rate Limiting binding はキーを不透明な文字列として扱い、サブネット集約をしない。
 * Cloudflare 自身も「IP は共有されうるのでキーに使うなら注意」としている）。ゾーンの WAF
 * Rate Limiting Rule が IPv6 を既定で /64 単位に集約するのと同じ粒度へ揃える。
 *
 * IPv4 はアドレスをそのまま使う（/24 等へ丸めると共有 NAT の巻き添えが増えるだけで、
 * IPv6 のような無償の横展開はできないため）。
 */
function clientIpBucket(clientIp: string | undefined): string {
  // ヘッダーが無い環境（`wrangler dev` 等）は固定バケットへ落ちる。本番では Cloudflare が必ず付与する。
  if (!clientIp) return "unknown";
  if (!clientIp.includes(":")) return clientIp; // IPv4
  // ドット付き 10 進を含む IPv6 表記は丸めない。代表例は IPv4 射影表記（`::ffff:203.0.113.9`）で、
  // 上位 64 ビットが定数のため丸めると全アドレスが 1 バケットに潰れ、正規利用者を巻き込む。
  //
  // この判定は `.` を含む IPv6 表記全般（非推奨の IPv4 互換 `::a.b.c.d`・ドキュメント慣習の NAT64
  // 表記 `64:ff9b::a.b.c.d` 等）に効くが、それで丸め漏れは起きない: RFC 5952 の正規表現が
  // ドット付き 10 進を使うのは IPv4 射影・IPv4 互換の 2 ケースだけで（NAT64 の下位 32 ビットは
  // 通常のハクテット表記でシリアライズされる）、`CF-Connecting-IP` にはエッジが正規化した表記しか
  // 載らない。加えて NAT64 は IPv4-only 宛先へ到達するための機構であり、ネイティブ IPv6 を提供する
  // Cloudflare 宛では発生しない。仮に現れてもアドレスはゲートウェイの変換テーブルに紐づき、
  // 攻撃者が 1 リクエストごとに振り直せる値ではない（＝この関数が防ぐ攻撃には使えない）。
  if (clientIp.includes(".")) return clientIp;

  const [head, tail] = clientIp.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const hextets =
    tail === undefined
      ? headParts
      : [...headParts, ...new Array(Math.max(0, 8 - headParts.length - tailParts.length)).fill("0"), ...tailParts];
  // `2001:0db8:...` と `2001:db8:...` を同じバケットにするため先頭のゼロを落として正規化する。
  const network = hextets
    .slice(0, 4)
    .map((hextet) => hextet.toLowerCase().replace(/^0+(?=.)/, "") || "0")
    .join(":");
  return `${network}::/64`;
}

/**
 * 同一内容の連投抑止（不正利用対策・PR-4 拡張・#179）のキー。`HMAC(userId + contentHash)` にすることで、
 * サーバーには内容そのものはおろか無塩ハッシュも渡さず、逆引き不能な鍵だけを Cloudflare 側に渡す
 * （`rateLimitKey` と同じ仮名化方針）。フィールド境界の曖昧さを避けるため JSON 配列にしてからハッシュ化する
 * （クライアント側の `src/issues/submitGuard.ts` の `submissionKey` と同じ組み立て方）。
 */
async function duplicateSubmissionKey(
  env: Env,
  bundle: TokenBundle,
  content: { repo: string; title: string; body: string; labels: string[] },
): Promise<string> {
  // GitHub の labels は集合であり順序・重複に意味を持たない。正規化せずにハッシュ化すると
  // 同じラベルの並び替えや重複追加だけで別ハッシュになり、連投抑止をラベルの選び直しで
  // 回避できてしまう（#193 レビュー指摘）。title / body は空白差分も別内容として扱ってよいため
  // 正規化しない。
  const normalizedLabels = Array.from(new Set(content.labels)).sort();
  const contentHash = await sha256Base64url(
    JSON.stringify([content.repo, content.title, content.body, normalizedLabels]),
  );
  return hmacSha256Base64url(env.TOKEN_ENCRYPTION_KEY, `issue-duplicate:${bundle.u}:${contentHash}`);
}

app.get("/api/health", (c) => c.json({ status: "ok" }));

// GET /api/ready: 本番の設定・プロビジョニングを自己診断する（デプロイ後スモークテスト用）。
// 「コードは正しいが本番構成が不正（鍵不正・var 欠落・バインディング未設定）」を検知して
// 汎用 500 でなく可視化する。E2E green ≠ 本番動作、のギャップを埋める（docs/testing-e2e.md）。
app.get("/api/ready", (c) => {
  const checks = {
    encryptionKey: isValidEncryptionKey(c.env.TOKEN_ENCRYPTION_KEY),
    // TOKEN_KEY_VERSION の不正値はサイレントに 1 へフォールバックするため、設定ミスをここで可視化する
    // （鍵を交換したのにバージョンが上がらないと、旧鍵の Cookie を安価に弾けない）。
    keyVersion: hasValidKeyVersionSetting(c.env),
    clientId: Boolean(c.env.GITHUB_CLIENT_ID),
    // レート制限バインディング（PR-4）の設定漏れは、起票が全て素通りする＝不正利用対策が
    // 効いていない状態になる。500 になるまで気づけないので ready で先に可視化する。
    rateLimiter: typeof c.env.ISSUE_RATE_LIMIT?.limit === "function",
    // 同一内容の連投抑止バインディング（#179）の設定漏れも同様に、429 になるまで気づけない。
    duplicateLimiter: typeof c.env.ISSUE_DUPLICATE_SUBMISSION_LIMIT?.limit === "function",
    // 認証不要で叩ける /auth/login の可用性防御（#207）。設定漏れは 500 にならず「無制限に
    // 叩ける状態」として静かに成立してしまう（気づけるのは請求か障害が起きてから）。
    authLoginRateLimiter: typeof c.env.AUTH_LOGIN_RATE_LIMIT?.limit === "function",
    // E2E 用の緩和フラグ（上限 1000 件/分）が本番 vars に紛れ込むと、上限が実質無効のまま
    // 200 を返してしまう。「効いていない状態」を検知するのがこのチェックの目的なので、
    // 緩和モードで動いていること自体を not-ready として扱う。
    rateLimiterStrict: c.env.ISSUE_RATE_LIMIT_RELAXED_ENABLED !== "1",
  };
  const ready =
    checks.encryptionKey &&
    checks.keyVersion &&
    checks.clientId &&
    checks.rateLimiter &&
    checks.duplicateLimiter &&
    checks.authLoginRateLimiter &&
    checks.rateLimiterStrict;
  return c.json({ ready, checks }, ready ? 200 : 503);
});

// GET /auth/login: state + PKCE を生成し pre-auth Cookie に保存して GitHub へフルページリダイレクト。
app.get("/auth/login", async (c) => {
  // レート制限は暗号処理より前に評価する（#207）。このエンドポイントは認証不要で叩けるうえ、
  // 1 リクエストごとに PKCE 生成・AES-256-GCM 封入を行う一方 GitHub API を一切消費しないため、
  // 上流のレート制限に当たらないまま Worker のリクエスト数と CPU 時間だけを消耗させられる。
  // 無料プランの上限に到達すると、その日は正規利用者を含む全員が起票できなくなる。
  const rateLimit = await resolveAuthLoginRateLimiter(c.env).limit({
    key: await authLoginRateLimitKey(c.env, c.req.header("CF-Connecting-IP")),
  });
  if (!rateLimit.success) {
    c.header("Retry-After", String(AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS));
    // ここはブラウザのフルページ遷移で到達する（XHR ではない）ため、他のエンドポイントの
    // JSON エラー本文ではなく、そのまま読める平文を返す。i18n の実体はクライアント側にあり
    // このレスポンスでは読み込めないので、日英を併記する。
    return c.text(
      "ログイン要求が多すぎます。しばらく待ってから、もう一度お試しください。\n" +
        "Too many login requests. Please wait a moment and try again.\n",
      429,
    );
  }

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
  if (!isValidRepoFullName(repo)) {
    return c.json(jsonError("invalid_request", "repo must be in owner/name format"), 400);
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
  // 認証・トークンの鮮度はレート制限より前に確定させる。期限切れ（401 token_expired）で引き返す
  // 場合にカウンタを消費してしまうと、クライアントがリフレッシュ後に再送したとき本来より早く
  // 上限に達してしまうため。
  const bundle = await resolveTokens(c);
  if (bundle instanceof Response) return bundle;

  const rateLimit = await resolveIssueRateLimiter(c.env).limit({ key: await rateLimitKey(c.env, bundle) });
  if (!rateLimit.success) {
    c.header("Retry-After", String(ISSUE_RATE_LIMIT_WINDOW_SECONDS));
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
  const { repo: repoValue, title: titleValue, body: bodyValue, labels: labelsValue } = payload as Record<string, unknown>;
  const repo = typeof repoValue === "string" ? repoValue.trim() : "";
  const title = typeof titleValue === "string" ? titleValue.trim() : "";
  const body = typeof bodyValue === "string" ? bodyValue.trim() : "";
  const labels = Array.isArray(labelsValue)
    ? labelsValue.filter((l): l is string => typeof l === "string" && l.trim().length > 0)
    : [];
  if (!repo || !title) {
    return c.json(jsonError("invalid_request", "repo and title are required"), 400);
  }
  if (!isValidRepoFullName(repo)) {
    return c.json(jsonError("invalid_request", "repo must be in owner/name format"), 400);
  }

  // 入力長・件数の上限（不正利用対策・#179）。GitHub へ転送する前にここで弾き、GitHub 側 422 に
  // なるまで Worker CPU とレート制限枠を浪費させない。
  if (
    title.length > ISSUE_TITLE_MAX_LENGTH ||
    body.length > ISSUE_BODY_MAX_LENGTH ||
    labels.length > ISSUE_LABELS_MAX_COUNT ||
    labels.some((l) => l.length > ISSUE_LABEL_MAX_LENGTH)
  ) {
    return c.json(jsonError("invalid_request", "title, body, or labels exceed the allowed length"), 400);
  }

  // 二重送信防止（FR-24）の主判定は端末内（localStorage / IndexedDB）で行う（P3・stateless-architecture.md §3）。
  // クライアント側ガード（src/issues/submitGuard.ts）は仕様として fail-open のため、正規の Cookie を
  // 持つスクリプトから直接同一内容を反復送信されると、旧実装ではボリュームレート制限の範囲内で
  // 素通りしていた（#179）。ここでは内容そのものを一切保存せず、Rate Limiting binding のカウンタ
  // だけで「同一ユーザー・同一内容は 10 秒に 1 回まで」というフロアを敷く。
  const duplicateLimit = await resolveIssueDuplicateLimiter(c.env).limit({
    key: await duplicateSubmissionKey(c.env, bundle, { repo, title, body, labels }),
  });
  if (!duplicateLimit.success) {
    c.header("Retry-After", String(DUPLICATE_SUBMISSION_WINDOW_SECONDS));
    // クライアント側ガードが検出した二重送信と同じ表示コードを使う（#179 決定）。利用者から見れば
    // 「同一内容を連続で送った」という事象は判定の場所（端末 or サーバー）に関わらず同一であり、
    // 表示を分ける理由がない。i18n の新規追加は不要（src/issues/submitError.ts が既に処理する）。
    return c.json(jsonError("duplicate_submission", "this content was already submitted moments ago"), 429);
  }

  try {
    const issue = await createIssue(c.env.GITHUB_API_BASE ?? DEFAULT_API_BASE, bundle.a, repo, { title, body, labels });
    return c.json({ number: issue.number, htmlUrl: issue.htmlUrl }, 201);
  } catch (err) {
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

  // P3 以降、サーバーに残るユーザー由来の記録は無い（重複防止の一時行は端末内へ、レート制限は
  // Cloudflare 管理のカウンタへ移した）。削除対象はトークンそのものだけ。
  await revokeTokenBestEffort(c, bundle);
  clearTokenCookies(c);
  return c.body(null, 204);
});

// GET /setup: GitHub App の Setup URL 着地点（インストール/承認完了後の復帰・最小版）。
app.get("/setup", (c) => c.redirect("/?setup=complete", 302));

// Cron Trigger（保持期間クリーンアップ・#71）は P3 で不要になった（掃除すべき行が無くなったため）。
export default app;
