import { env } from "cloudflare:test";
import { Hono, type Context } from "hono";
import { describe, expect, it } from "vitest";
import {
  clearTokenCookies,
  currentKeyVersion,
  openTokenBundle,
  sealTokenBundle,
  SESSION_MAX_AGE,
  setTokenCookies,
  TOKEN_COOKIE,
  TOKEN_EXP_COOKIE,
  type TokenBundle,
} from "./tokenCookie";
import type { Env } from "./types";

const testEnv = env as unknown as Env;

const NOW = 1_800_000_000;

/** 実物大のトークン一式（GitHub の `ghu_` / `ghr_` はいずれも 40 文字前後）。 */
function realisticBundle(overrides: Partial<TokenBundle> = {}): TokenBundle {
  return {
    a: `ghu_${"a".repeat(36)}`,
    ae: NOW + 28800,
    r: `ghr_${"r".repeat(36)}`,
    re: NOW + 15897600,
    x: NOW + SESSION_MAX_AGE,
    u: 424242,
    ...overrides,
  };
}

/** 現行バージョン + 1（鍵ローテーション後を表す）。定数直書きだと実際のローテーションでテストが壊れる。 */
const ROTATED_ENV: Env = { ...testEnv, TOKEN_KEY_VERSION: String(currentKeyVersion(testEnv) + 1) };

describe("トークン Cookie の封入・開封（stateless-architecture.md §4）", () => {
  it("round-trips the bundle without exposing the tokens in the cookie value", async () => {
    const bundle = realisticBundle();
    const sealed = await sealTokenBundle(testEnv, bundle);
    expect(sealed).not.toContain(bundle.a);
    expect(sealed).not.toContain(bundle.r);
    expect(await openTokenBundle(testEnv, sealed, NOW)).toEqual(bundle);
  });

  it("stays well under the 4KB cookie limit (設計 §4 のサイズ試算の実測)", async () => {
    const sealed = await sealTokenBundle(testEnv, realisticBundle());
    // 設計の試算は約 250 バイト。上限 4096 に対する余裕を機械で担保する。
    expect(sealed.length).toBeLessThan(400);
  });

  it("returns null for a bundle sealed with a different key version (鍵ローテーション → 再ログイン)", async () => {
    const sealed = await sealTokenBundle(ROTATED_ENV, realisticBundle());
    // 現行バージョンでは開けない = 未認証扱い。
    expect(await openTokenBundle(testEnv, sealed, NOW)).toBeNull();
    // 鍵バージョンを上げた側では開ける（ローテーション後に発行された Cookie は有効）。
    expect(await openTokenBundle(ROTATED_ENV, sealed, NOW)).toEqual(realisticBundle());
  });

  it("rejects a bundle past its absolute expiry even when the refresh token is still valid", async () => {
    // 盗まれた Cookie がリフレッシュを繰り返して半年生き延びないための最後の砦。
    const sealed = await sealTokenBundle(testEnv, realisticBundle({ x: NOW - 1, re: NOW + 15897600 }));
    expect(await openTokenBundle(testEnv, sealed, NOW)).toBeNull();
  });

  it("returns null for tampered or malformed cookie values instead of throwing", async () => {
    const sealed = await sealTokenBundle(testEnv, realisticBundle());
    const tampered = sealed.slice(0, -4) + (sealed.endsWith("A") ? "BBBB" : "AAAA");
    expect(await openTokenBundle(testEnv, tampered, NOW)).toBeNull();
    expect(await openTokenBundle(testEnv, "not-a-sealed-value", NOW)).toBeNull();
    expect(await openTokenBundle(testEnv, "", NOW)).toBeNull();
  });

  it("returns null when the decrypted payload is not a well-formed bundle", async () => {
    // 正しい鍵で封入されていても中身が壊れていれば未認証に倒す（形式検証）。
    const { sealVersioned } = await import("./crypto");
    const sealed = await sealVersioned(
      testEnv.TOKEN_ENCRYPTION_KEY,
      currentKeyVersion(testEnv),
      JSON.stringify({ a: 1 }),
    );
    expect(await openTokenBundle(testEnv, sealed, NOW)).toBeNull();
  });
});

/** Set-Cookie ヘッダを Cookie 名ごとの `{ value, attrs }` に分解する（属性を個別に検証するため）。 */
function parseSetCookies(res: Response): Record<string, { value: string; attrs: Record<string, string> }> {
  const out: Record<string, { value: string; attrs: Record<string, string> }> = {};
  for (const header of res.headers.getSetCookie()) {
    const [pair, ...rest] = header.split(";");
    const eq = pair.indexOf("=");
    const attrs: Record<string, string> = {};
    for (const part of rest) {
      const [k, v = ""] = part.trim().split("=");
      attrs[k.toLowerCase()] = v;
    }
    out[pair.slice(0, eq)] = { value: pair.slice(eq + 1), attrs };
  }
  return out;
}

function runWithContext(handler: (c: Context<{ Bindings: Env }>) => Promise<Response> | Response) {
  const app = new Hono<{ Bindings: Env }>();
  app.get("/run", (c) => handler(c));
  return app.request("https://example.com/run", {}, testEnv as unknown as Record<string, unknown>);
}

async function setCookiesFor(bundle: TokenBundle) {
  return parseSetCookies(
    await runWithContext(async (c) => {
      await setTokenCookies(c, bundle, NOW);
      return c.body(null, 204);
    }),
  );
}

describe("setTokenCookies / clearTokenCookies の Cookie 属性", () => {
  it("puts the tokens in an HttpOnly cookie and the expiry in a readable one", async () => {
    const bundle = realisticBundle();
    const cookies = await setCookiesFor(bundle);

    expect(cookies[TOKEN_COOKIE].attrs).toHaveProperty("httponly");
    expect(cookies[TOKEN_COOKIE].attrs).toHaveProperty("secure");
    expect(cookies[TOKEN_COOKIE].attrs.path).toBe("/");
    expect(cookies[TOKEN_COOKIE].attrs.samesite).toBe("Lax");
    // 期限 Cookie に HttpOnly が付くとクライアントが期限を読めず、先回りリフレッシュが全く動かなくなる。
    expect(cookies[TOKEN_EXP_COOKIE].attrs).not.toHaveProperty("httponly");
    // 値は access token の期限そのもの（refresh 期限や絶対期限を書くと永久に「まだ新鮮」と誤判定される）。
    expect(cookies[TOKEN_EXP_COOKIE].value).toBe(String(bundle.ae));
  });

  it("sets Max-Age as seconds remaining until the absolute expiry, not an absolute timestamp", async () => {
    const cookies = await setCookiesFor(realisticBundle());
    expect(cookies[TOKEN_COOKIE].attrs["max-age"]).toBe(String(SESSION_MAX_AGE));
    expect(cookies[TOKEN_EXP_COOKIE].attrs["max-age"]).toBe(String(SESSION_MAX_AGE));
  });

  it("keeps the cookie alive for at least a minute when the absolute expiry is nearly reached", async () => {
    // 期限切れ寸前でも Cookie を残し、/auth/refresh の 401 を受け取って再ログインへ倒せるようにする。
    const cookies = await setCookiesFor(realisticBundle({ x: NOW + 1 }));
    expect(cookies[TOKEN_COOKIE].attrs["max-age"]).toBe("60");
  });

  it("expires both cookies on clear", async () => {
    const cookies = parseSetCookies(
      await runWithContext((c) => {
        clearTokenCookies(c);
        return c.body(null, 204);
      }),
    );
    expect(cookies[TOKEN_COOKIE].attrs["max-age"]).toBe("0");
    expect(cookies[TOKEN_EXP_COOKIE].attrs["max-age"]).toBe("0");
  });
});

describe("currentKeyVersion", () => {
  it("defaults to 1 and honours a valid TOKEN_KEY_VERSION", () => {
    expect(currentKeyVersion({ ...testEnv, TOKEN_KEY_VERSION: undefined })).toBe(1);
    expect(currentKeyVersion({ ...testEnv, TOKEN_KEY_VERSION: "7" })).toBe(7);
  });

  it("falls back to 1 for unusable values instead of failing the request", () => {
    expect(currentKeyVersion({ ...testEnv, TOKEN_KEY_VERSION: "0" })).toBe(1);
    expect(currentKeyVersion({ ...testEnv, TOKEN_KEY_VERSION: "abc" })).toBe(1);
    expect(currentKeyVersion({ ...testEnv, TOKEN_KEY_VERSION: "999" })).toBe(1);
  });
});
