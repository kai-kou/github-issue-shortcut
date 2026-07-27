/**
 * トークン Cookie（ステートレス認証の中核・stateless-architecture.md §4）。
 *
 * GitHub のトークンはサーバー（D1）に保存せず、Worker の鍵で暗号化して利用者の端末の
 * HttpOnly Cookie に置く。サーバーは「復号 → 使用 → 必要なら Set-Cookie で書き戻し」だけを行い、
 * 永続化しない（個人データ保持ゼロ・Epic #162）。
 *
 * - `__Host-gh`     : `base64url(keyVersion || iv || AES-256-GCM(JSON))`。HttpOnly のため JS から読めない
 * - `__Host-gh-exp` : access token の有効期限（UNIX 秒）だけを持つ。JS から読める（個人データではない）
 *
 * 鍵バージョンを先頭に持たせることで暗号鍵のローテーションが可能になる。旧鍵で封入された Cookie は
 * 復号せず再ログインへ倒すだけで、失われるデータは無い（下書き・ショートカットは端末内にある）。
 */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { isValidKeyVersion, MIN_KEY_VERSION, openVersioned, sealVersioned } from "./crypto";
import type { Env } from "./types";

/** 暗号化トークン Cookie の名前。 */
export const TOKEN_COOKIE = "__Host-gh";
/** access token の有効期限だけを載せる Cookie（JS から読める）。 */
export const TOKEN_EXP_COOKIE = "__Host-gh-exp";

/**
 * トークン Cookie の Max-Age 既定値（約 6 か月）。GitHub の refresh token の有効期限に合わせる。
 * GitHub が `refresh_token_expires_in` を返した場合はそちらを優先する。
 */
export const DEFAULT_REFRESH_TOKEN_TTL = 6 * 30 * 24 * 60 * 60;

/** Cookie の共通属性（`__Host-` プレフィックスの要件: Secure + Path=/ + Domain 指定なし）。 */
const COOKIE_BASE = { secure: true, path: "/", sameSite: "Lax" } as const;

/**
 * Cookie に封入するトークン一式。キーを 1 文字にしているのは Cookie サイズ（4KB 上限）を
 * 節約するため（実測は `session.test.ts` の封入サイズ検証を参照）。
 */
export interface TokenBundle {
  /** access token。 */
  a: string;
  /** access token の有効期限（UNIX 秒）。 */
  ae: number;
  /** refresh token（GitHub が返さない構成では null）。 */
  r: string | null;
  /** refresh token の有効期限（UNIX 秒・不明なら null）。 */
  re: number | null;
  /**
   * GitHub の数値ユーザー ID。P3 でクライアント側へ移すまでの暫定として、重複防止（issue_log /
   * request_ids）とレート制限のキーに使う。Cookie は AES-GCM で認証済みのため、クライアントが
   * 他人の ID を騙ることはできない。
   */
  u: number;
}

/** 現行の鍵バージョン（未設定・不正値なら 1）。鍵ローテーション時に `TOKEN_KEY_VERSION` を上げる。 */
export function currentKeyVersion(env: Env): number {
  const parsed = env.TOKEN_KEY_VERSION ? Number(env.TOKEN_KEY_VERSION) : NaN;
  return isValidKeyVersion(parsed) ? parsed : MIN_KEY_VERSION;
}

function isTokenBundle(value: unknown): value is TokenBundle {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.a === "string" &&
    v.a.length > 0 &&
    typeof v.ae === "number" &&
    (v.r === null || typeof v.r === "string") &&
    (v.re === null || typeof v.re === "number") &&
    typeof v.u === "number"
  );
}

/** トークン一式を現行の鍵バージョンで封入する。 */
export function sealTokenBundle(env: Env, bundle: TokenBundle): Promise<string> {
  return sealVersioned(env.TOKEN_ENCRYPTION_KEY, currentKeyVersion(env), JSON.stringify(bundle));
}

/**
 * トークン Cookie を開封する。復号失敗（改ざん・鍵ローテーション・形式不正）はすべて null を返し、
 * 呼び出し側では「未認証」として扱う（＝再ログイン導線）。失敗理由でレスポンスを分けない
 * （攻撃者に鍵の状態を伝えないため）。
 */
export async function openTokenBundle(env: Env, sealed: string): Promise<TokenBundle | null> {
  try {
    const json: unknown = JSON.parse(await openVersioned(env.TOKEN_ENCRYPTION_KEY, currentKeyVersion(env), sealed));
    return isTokenBundle(json) ? json : null;
  } catch {
    return null;
  }
}

/** リクエストの Cookie からトークン一式を取り出す（無い・開けない場合は null）。 */
export function readTokenBundle(c: Context<{ Bindings: Env }>): Promise<TokenBundle | null> {
  const sealed = getCookie(c, TOKEN_COOKIE);
  if (!sealed) return Promise.resolve(null);
  return openTokenBundle(c.env, sealed);
}

/**
 * トークン一式を Cookie へ書き戻す。ログイン直後とリフレッシュ成功時に呼ぶ。
 * Max-Age は refresh token の有効期限に合わせる（access token より長い＝再訪時に自動更新できる）。
 */
export async function setTokenCookies(
  c: Context<{ Bindings: Env }>,
  bundle: TokenBundle,
  nowSeconds: number,
): Promise<void> {
  const expiresAt = bundle.re ?? nowSeconds + DEFAULT_REFRESH_TOKEN_TTL;
  // 期限切れ寸前の refresh token でも Cookie 自体は最低 1 分は残し、クライアントが
  // 再ログインへ倒す判断（/auth/refresh の 401）を受け取れるようにする。
  const maxAge = Math.max(60, expiresAt - nowSeconds);
  setCookie(c, TOKEN_COOKIE, await sealTokenBundle(c.env, bundle), {
    ...COOKIE_BASE,
    httpOnly: true,
    maxAge,
  });
  // access token の期限だけをクライアントへ公開する（HttpOnly にしない＝Web Locks で
  // 先回りリフレッシュするかの判断に使う・§5）。値は数値 1 個で個人データではない。
  setCookie(c, TOKEN_EXP_COOKIE, String(bundle.ae), {
    ...COOKIE_BASE,
    httpOnly: false,
    maxAge,
  });
}

/** トークン Cookie を破棄する（ログアウト・アカウント削除・リフレッシュ失敗時）。 */
export function clearTokenCookies(c: Context<{ Bindings: Env }>): void {
  deleteCookie(c, TOKEN_COOKIE, { path: "/", secure: true });
  deleteCookie(c, TOKEN_EXP_COOKIE, { path: "/", secure: true });
}
