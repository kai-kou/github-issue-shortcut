/**
 * トークン Cookie（ステートレス認証の中核・stateless-architecture.md §4）。
 *
 * GitHub のトークンはサーバー（D1）に保存せず、Worker の鍵で暗号化して利用者の端末の
 * HttpOnly Cookie に置く。サーバーは「復号 → 使用 → 必要なら Set-Cookie で書き戻し」だけを行い、
 * 永続化しない（個人データ保持ゼロ・Epic #162）。「セッション」という語はファイル名にも使わない:
 * サーバー側にセッションレコードは存在せず、この Cookie 自体がその役割を兼ねる。
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
/**
 * access token の有効期限だけを載せる Cookie（JS から読める）。
 * クライアント側の同名定数は `src/auth/tokenRefresh.ts`（worker と src はビルド単位が別で共有できない）。
 * 名前を変えるときは必ず両方を直すこと。
 */
export const TOKEN_EXP_COOKIE = "__Host-gh-exp";

/**
 * ログインから強制再認証までの上限（30 日）。refresh token の有効期限（約 6 か月）より短くする。
 *
 * トークン Cookie は自己完結型のクレデンシャル（復号できれば GitHub のトークンそのもの）で、
 * サーバー側に失効レコードを持たない。盗まれた Cookie がリフレッシュを繰り返して半年生き延びる
 * ことを防ぐ最後の砦がこの絶対期限で、リフレッシュしても延長しない。
 */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

/** Cookie の共通属性（`__Host-` プレフィックスの要件: Secure + Path=/ + Domain 指定なし）。 */
const COOKIE_BASE = { secure: true, path: "/", sameSite: "Lax" } as const;

/**
 * Cookie に封入するトークン一式。キーを 1 文字にしているのは Cookie サイズ（4KB 上限）を
 * 節約するため（実測は `tokenCookie.test.ts` の封入サイズ検証を参照）。
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
  /** ログイン状態そのものの絶対期限（UNIX 秒）。リフレッシュでは延長しない。 */
  x: number;
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

/**
 * `TOKEN_KEY_VERSION` が「未設定」か「妥当な値」かを返す（設定ミスの自己診断用）。
 * `"v2"` のような不正値はサイレントに 1 へフォールバックし、鍵を交換したのにバージョンが
 * 上がらない（＝旧鍵の Cookie を安価に弾けない）状態になるため、`/api/ready` で可視化する。
 */
export function hasValidKeyVersionSetting(env: Env): boolean {
  return env.TOKEN_KEY_VERSION === undefined || isValidKeyVersion(Number(env.TOKEN_KEY_VERSION));
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
    typeof v.x === "number" &&
    typeof v.u === "number"
  );
}

/** トークン一式を現行の鍵バージョンで封入する。 */
export function sealTokenBundle(env: Env, bundle: TokenBundle): Promise<string> {
  return sealVersioned(env.TOKEN_ENCRYPTION_KEY, currentKeyVersion(env), JSON.stringify(bundle));
}

/**
 * トークン Cookie を開封する。復号失敗（改ざん・鍵ローテーション・形式不正）と絶対期限切れは
 * すべて null を返し、呼び出し側では「未認証」として扱う（＝再ログイン導線）。失敗理由で
 * レスポンスを分けない（攻撃者に鍵の状態を伝えないため）。
 */
export async function openTokenBundle(env: Env, sealed: string, now: number): Promise<TokenBundle | null> {
  try {
    const json: unknown = JSON.parse(await openVersioned(env.TOKEN_ENCRYPTION_KEY, currentKeyVersion(env), sealed));
    if (!isTokenBundle(json)) return null;
    // 絶対期限を過ぎたログインは refresh token が残っていても受け付けない。
    return json.x > now ? json : null;
  } catch {
    return null;
  }
}

/** リクエストの Cookie からトークン一式を取り出す（無い・開けない・絶対期限切れは null）。 */
export function readTokenBundle(c: Context<{ Bindings: Env }>, now: number): Promise<TokenBundle | null> {
  const sealed = getCookie(c, TOKEN_COOKIE);
  if (!sealed) return Promise.resolve(null);
  return openTokenBundle(c.env, sealed, now);
}

/**
 * トークン一式を Cookie へ書き戻す。ログイン直後とリフレッシュ成功時に呼ぶ。
 * Max-Age は絶対期限（`x`）までで、リフレッシュしても延びない。
 */
export async function setTokenCookies(
  c: Context<{ Bindings: Env }>,
  bundle: TokenBundle,
  now: number,
): Promise<void> {
  // 期限切れ寸前でも Cookie 自体は最低 1 分残し、クライアントが再ログインへ倒す判断
  // （/auth/refresh の 401）を受け取れるようにする。
  const maxAge = Math.max(60, bundle.x - now);
  setCookie(c, TOKEN_COOKIE, await sealTokenBundle(c.env, bundle), {
    ...COOKIE_BASE,
    httpOnly: true,
    maxAge,
  });
  // access token の期限だけをクライアントへ公開する（HttpOnly にしない＝先回りリフレッシュの
  // 判断に使う・§5）。値は数値 1 個で個人データではない。JS から書き換え可能な値のため、
  // これはあくまで最適化のヒントであり、認可の判断には使わない（最終判断はサーバーの 401）。
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
