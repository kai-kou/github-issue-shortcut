/**
 * ユニットテスト用のヘルパー（本番バンドルからは参照されない）。
 * ステートレス認証（stateless-architecture.md §4）では「ログイン済み」= トークン Cookie を持つことなので、
 * D1 にユーザー行を作る代わりに、封入済みの Cookie ヘッダを組み立てる。
 */
import { sealTokenBundle, SESSION_MAX_AGE, TOKEN_COOKIE, type TokenBundle } from "./tokenCookie";
import { nowSeconds } from "./store";
import type { Env } from "./types";

let nextUserId = 1_000_000;

/** テスト用のトークン一式（既定は 1 時間有効・refresh token なし・ユーザーごとに一意な ID）。 */
export function testTokenBundle(overrides: Partial<TokenBundle> = {}): TokenBundle {
  return {
    a: "test-access-token",
    ae: nowSeconds() + 3600,
    r: null,
    re: null,
    x: nowSeconds() + SESSION_MAX_AGE,
    u: nextUserId++,
    ...overrides,
  };
}

/** `Cookie:` ヘッダに載せられる形式のトークン Cookie を作る。 */
export async function tokenCookieHeader(env: Env, bundle: TokenBundle): Promise<string> {
  return `${TOKEN_COOKIE}=${await sealTokenBundle(env, bundle)}`;
}

/** ログイン済みリクエスト用の Cookie ヘッダを 1 行で作る（多くのテストはこれで足りる）。 */
export async function loginCookie(env: Env, overrides: Partial<TokenBundle> = {}): Promise<string> {
  return tokenCookieHeader(env, testTokenBundle(overrides));
}
