import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TokenBundle } from "./tokenCookie";
import { isAccessTokenFresh, ReauthRequiredError, refreshTokenBundle } from "./tokens";
import type { Env } from "./types";

const testEnv = env as unknown as Env;

const NOW = 1_800_000_000;

function bundle(overrides: Partial<TokenBundle> = {}): TokenBundle {
  return { a: "old-access", ae: NOW - 10, r: "old-refresh", re: NOW + 86_400, x: NOW + 86_400, u: 424242, ...overrides };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isAccessTokenFresh", () => {
  it("treats a token expiring within the buffer as stale", () => {
    expect(isAccessTokenFresh(bundle({ ae: NOW + 3600 }), NOW)).toBe(true);
    expect(isAccessTokenFresh(bundle({ ae: NOW + 30 }), NOW)).toBe(false); // 60 秒バッファ内
    expect(isAccessTokenFresh(bundle({ ae: NOW - 1 }), NOW)).toBe(false);
  });
});

describe("refreshTokenBundle（単回使用ローテーション・§5）", () => {
  it("rotates both tokens and recomputes the expiries from the response", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        access_token: "new-access",
        expires_in: 28800,
        refresh_token: "new-refresh",
        refresh_token_expires_in: 15897600,
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const refreshed = await refreshTokenBundle(testEnv, bundle(), NOW);
    expect(refreshed).toEqual({
      a: "new-access",
      ae: NOW + 28800,
      r: "new-refresh",
      re: NOW + 15897600,
      // 絶対期限はリフレッシュで延長しない（盗まれた Cookie の無期限延命を防ぐ）。
      x: NOW + 86_400,
      u: 424242,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing refresh token when GitHub does not rotate it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { access_token: "new-access" })));

    const refreshed = await refreshTokenBundle(testEnv, bundle(), NOW);
    expect(refreshed.r).toBe("old-refresh");
    expect(refreshed.re).toBe(NOW + 86_400);
    // expires_in 不在時は GitHub App の既定 TTL（8 時間）へフォールバックする。
    expect(refreshed.ae).toBe(NOW + 8 * 60 * 60);
  });

  it("raises ReauthRequiredError when there is no refresh token (GitHub は呼ばない)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(refreshTokenBundle(testEnv, bundle({ r: null }), NOW)).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("raises ReauthRequiredError when GitHub rejects the refresh token (自動リトライしない)", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { error: "bad_refresh_token" }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(refreshTokenBundle(testEnv, bundle(), NOW)).rejects.toBeInstanceOf(ReauthRequiredError);
    // 単回使用トークンのため、失敗しても同じトークンで再試行してはならない。
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("carries the GitHub user id through the rotation (重複防止キーが変わらない)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { access_token: "new-access" })));
    const refreshed = await refreshTokenBundle(testEnv, bundle({ u: 777 }), NOW);
    expect(refreshed.u).toBe(777);
  });

  it("does not extend the absolute expiry (盗まれた Cookie を無期限に延命させない)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { access_token: "new-access" })));
    const refreshed = await refreshTokenBundle(testEnv, bundle({ x: NOW + 100 }), NOW);
    expect(refreshed.x).toBe(NOW + 100);
  });

  it("rethrows a transient failure instead of forcing a re-login (GitHub 5xx・ネットワーク断)", async () => {
    // 一過性の障害で Cookie を破棄すると、まだ有効な refresh token を持つ利用者を追い出してしまう。
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(503, {})));
    await expect(refreshTokenBundle(testEnv, bundle(), NOW)).rejects.not.toBeInstanceOf(ReauthRequiredError);

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network error");
    }));
    await expect(refreshTokenBundle(testEnv, bundle(), NOW)).rejects.not.toBeInstanceOf(ReauthRequiredError);
  });
});
