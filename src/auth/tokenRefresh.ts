/**
 * access token の先回りリフレッシュ（ステートレス認証・docs/design/stateless-architecture.md §5）。
 *
 * GitHub の refresh token は **単回使用ローテーション** のため、多タブ・Service Worker から同時に
 * `/auth/refresh` を叩くと片方が失効し再ログインになる。Web Locks API（`navigator.locks`）は同一
 * オリジンのタブ・SW をまたいで共有されるため、リフレッシュをクライアント側で 1 本化できる。
 *
 * サーバーは access token の有効期限だけを `__Host-gh-exp`（JS から読める Cookie）に載せる。
 * ロック内で改めて期限を読み直し、他タブが更新済みならネットワークに出ない。
 */

/** access token の有効期限（UNIX 秒）を載せた Cookie の名前。トークン本体は HttpOnly で読めない。 */
export const TOKEN_EXP_COOKIE = "__Host-gh-exp";
/** 期限がこの秒数以内に迫っていたら先回りでリフレッシュする（往復ぶんの余裕を見る）。 */
export const REFRESH_SKEW_SECONDS = 120;

const LOCK_NAME = "github-issue-shortcut:token-refresh";

/**
 * `document.cookie` 形式の文字列から access token の有効期限（UNIX 秒）を取り出す純関数。
 * 未ログイン・欠落・非数値はすべて null（＝リフレッシュ判断の対象外）。
 */
export function parseAccessTokenExpiry(cookieString: string): number | null {
  for (const part of cookieString.split(";")) {
    const [rawName, ...rest] = part.split("=");
    if (rawName.trim() !== TOKEN_EXP_COOKIE) continue;
    const value = Number(rest.join("=").trim());
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

/** リフレッシュ判定が依存する外部要素（テストから差し替えられるように分離する）。 */
export interface RefreshDeps {
  /** 現在時刻（UNIX 秒）。 */
  now: () => number;
  /** access token の有効期限（UNIX 秒）。未ログインなら null。 */
  readExpiry: () => number | null;
  /** 排他区間の実行（本番は Web Locks API）。 */
  withLock: <T>(fn: () => Promise<T>) => Promise<T>;
  /** `/auth/refresh` を呼ぶ。成功（＝以降 API を呼んでよい）なら true。 */
  postRefresh: () => Promise<boolean>;
}

/**
 * access token の期限が `skewSeconds` 以内に迫っていればリフレッシュする。
 * 戻り値は「この後 API 呼び出しを進めてよいか」。未ログイン（期限 Cookie なし）と
 * リフレッシュ失敗は false を返し、呼び出し側は再試行せず 401 の導線に委ねる（§5-3）。
 */
export async function refreshIfStale(deps: RefreshDeps, skewSeconds: number): Promise<boolean> {
  const expiry = deps.readExpiry();
  if (expiry === null) return false;
  if (expiry - deps.now() > skewSeconds) return true;

  return deps.withLock(async () => {
    // ロック待ちの間に他タブが更新済みなら、単回使用トークンを二重に消費しない。
    const current = deps.readExpiry();
    if (current === null) return false;
    if (current - deps.now() > skewSeconds) return true;
    return deps.postRefresh();
  });
}

/** 同一ドキュメント内だけの直列化フォールバック（Web Locks 非対応ブラウザ用）。 */
let fallbackChain: Promise<unknown> = Promise.resolve();

function withBrowserLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) return locks.request(LOCK_NAME, fn);
  // タブ間の直列化はできないが、少なくとも同一タブ内の同時多発リフレッシュは防ぐ。
  const run = fallbackChain.then(fn, fn);
  fallbackChain = run.catch(() => undefined);
  return run;
}

const browserDeps: RefreshDeps = {
  now: () => Math.floor(Date.now() / 1000),
  readExpiry: () => parseAccessTokenExpiry(typeof document !== "undefined" ? document.cookie : ""),
  withLock: withBrowserLock,
  postRefresh: async () => {
    try {
      const res = await fetch("/auth/refresh", { method: "POST", credentials: "same-origin" });
      return res.ok;
    } catch {
      // ネットワーク到達不能。オフライン時は API 呼び出し側のエラー処理に委ねる。
      return false;
    }
  },
};

/** API 呼び出し前の先回りリフレッシュ（期限が近いときだけネットワークに出る）。 */
export function ensureFreshAccessToken(): Promise<boolean> {
  return refreshIfStale(browserDeps, REFRESH_SKEW_SECONDS);
}

/** 401（token_expired）を受け取った後のリフレッシュ。成功したら呼び出し側が 1 度だけ再送する。 */
export function refreshAfterUnauthorized(): Promise<boolean> {
  return refreshIfStale(browserDeps, 0);
}
