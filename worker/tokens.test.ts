import { env } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptString } from "./crypto";
import { applySchema, getTokens, nowSeconds, saveTokens, upsertUser } from "./store";
import { getValidAccessToken } from "./tokens";
import type { Env } from "./types";

const testEnv = env as unknown as Env;
const db = testEnv.DB;
const KEY = testEnv.TOKEN_ENCRYPTION_KEY;

beforeAll(async () => {
  await applySchema(db);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function makeUserWithTokens(opts: { accessExpiresAt: number; withRefreshToken?: boolean }): Promise<string> {
  const userId = await upsertUser(db, { id: Math.floor(Math.random() * 1e9), login: "u", avatar_url: "" });
  await saveTokens(db, userId, {
    accessEnc: await encryptString(KEY, "old_access_token"),
    accessExpiresAt: opts.accessExpiresAt,
    refreshEnc: opts.withRefreshToken === false ? null : await encryptString(KEY, "old_refresh_token"),
    refreshExpiresAt: nowSeconds() + 1_000_000,
  });
  return userId;
}

describe("getValidAccessToken", () => {
  it("returns the stored access token without refreshing when still valid", async () => {
    const userId = await makeUserWithTokens({ accessExpiresAt: nowSeconds() + 3600 });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(getValidAccessToken(testEnv, userId)).resolves.toBe("old_access_token");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("transparently refreshes an expired access token and persists the rotation", async () => {
    const userId = await makeUserWithTokens({ accessExpiresAt: nowSeconds() - 10 });
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        access_token: "new_access_token",
        expires_in: 28800,
        refresh_token: "new_refresh_token",
        refresh_token_expires_in: 15897600,
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(getValidAccessToken(testEnv, userId)).resolves.toBe("new_access_token");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 次の呼び出しは DB に保存済みの新トークンをそのまま使い、再リフレッシュしない。
    await expect(getValidAccessToken(testEnv, userId)).resolves.toBe("new_access_token");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent refreshes so the single-use refresh token is consumed only once", async () => {
    const userId = await makeUserWithTokens({ accessExpiresAt: nowSeconds() - 10 });
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls++;
      // GitHub 呼び出しに時間がかかることをシミュレートし、その間に
      // 競合リクエストのポーリングが実際に発生する状況を再現する。
      await new Promise((resolve) => setTimeout(resolve, 250));
      return jsonResponse({
        access_token: "new_access_token",
        expires_in: 28800,
        refresh_token: "new_refresh_token",
        refresh_token_expires_in: 15897600,
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const [a, b] = await Promise.all([
      getValidAccessToken(testEnv, userId),
      getValidAccessToken(testEnv, userId),
    ]);

    expect(a).toBe("new_access_token");
    expect(b).toBe("new_access_token");
    expect(calls).toBe(1);
  });

  it("throws when the access token is expired and no refresh token is available", async () => {
    const userId = await makeUserWithTokens({ accessExpiresAt: nowSeconds() - 10, withRefreshToken: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("fetch should not be called");
      }),
    );

    await expect(getValidAccessToken(testEnv, userId)).rejects.toThrow();
  });

  it("releases the lock on refresh failure so a later call can retry", async () => {
    const userId = await makeUserWithTokens({ accessExpiresAt: nowSeconds() - 10 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );
    await expect(getValidAccessToken(testEnv, userId)).rejects.toThrow("network error");

    // ロックが解放されているはずなので、次の呼び出しは今度こそ成功する。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ access_token: "recovered_access_token", expires_in: 28800 })),
    );
    await expect(getValidAccessToken(testEnv, userId)).resolves.toBe("recovered_access_token");
  });

  it("keeps the existing refresh token when GitHub omits a new one in the response", async () => {
    const userId = await makeUserWithTokens({ accessExpiresAt: nowSeconds() - 10 });
    const before = await getTokens(db, userId);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ access_token: "new_access_token", expires_in: 28800 })));

    await getValidAccessToken(testEnv, userId);

    const after = await getTokens(db, userId);
    expect(after?.refreshEnc).toBe(before?.refreshEnc);
  });

  it("does not make a waiting caller wait out the full poll budget when the refresh fails", async () => {
    const userId = await makeUserWithTokens({ accessExpiresAt: nowSeconds() - 10 });
    const fetchSpy = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      throw new Error("invalid_grant");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const start = Date.now();
    const results = await Promise.allSettled([
      getValidAccessToken(testEnv, userId),
      getValidAccessToken(testEnv, userId),
    ]);
    const elapsedMs = Date.now() - start;

    expect(results.every((r) => r.status === "rejected")).toBe(true);
    // ポーリング予算（30 秒）を待ちきらず、ロック解放を検知して自ら再試行しているはず。
    expect(elapsedMs).toBeLessThan(5000);
  });
});
