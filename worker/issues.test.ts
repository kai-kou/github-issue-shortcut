import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowSeconds } from "./time";
import { loginCookie, testTokenBundle, tokenCookieHeader } from "./test-support";
import type { Env } from "./types";

const testEnv = env as unknown as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * ログイン済み（＝有効なトークン Cookie を持つ）リクエスト用のヘッダを返す。
 * access token は期限内にしておき、テストで stub する fetch が GitHub Issue 作成の 1 回だけに絞られるようにする
 * （API プロキシは暗黙のリフレッシュをしないため、期限内なら追加の fetch は発生しない）。
 */
function loginSession(): Promise<string> {
  return loginCookie(testEnv);
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function postIssue(cookie: string, input: { repo?: string; title?: string; body?: string } = {}) {
  return SELF.fetch("https://example.com/api/issues", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ repo: "kai-kou/alpha", title: "x", body: "", ...input }),
  });
}

describe("POST /api/issues error mapping (B5-2/FR-9)", () => {
  it("maps a 401 from GitHub to reauth_required", async () => {
    const cookie = await loginSession();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { message: "Bad credentials" })));

    const res = await postIssue(cookie);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("reauth_required");
  });

  it("maps a 403 with Retry-After to rate_limited and forwards the header", async () => {
    const cookie = await loginSession();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(403, { message: "You have exceeded a secondary rate limit" }, { "Retry-After": "30" }),
      ),
    );

    const res = await postIssue(cookie);
    expect(res.status).toBe(403);
    expect(res.headers.get("Retry-After")).toBe("30");
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  });

  it("maps a plain 403 (no rate-limit headers) to forbidden", async () => {
    const cookie = await loginSession();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(403, { message: "Resource not accessible by integration" })),
    );

    const res = await postIssue(cookie);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
  });

  it("maps a 404 to not_found", async () => {
    const cookie = await loginSession();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(404, { message: "Not Found" })));

    const res = await postIssue(cookie);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("maps a 410 to issues_disabled", async () => {
    const cookie = await loginSession();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(410, { message: "Issues are disabled" })));

    const res = await postIssue(cookie);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("issues_disabled");
  });

  it("maps a 422 to validation_failed", async () => {
    const cookie = await loginSession();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(422, { message: "Validation failed" })));

    const res = await postIssue(cookie);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_failed");
  });

  it("maps a 5xx to the generic upstream_failed (502)", async () => {
    const cookie = await loginSession();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, { message: "boom" })));

    const res = await postIssue(cookie);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_failed");
  });
});

describe("POST /api/issues の認証順序 (token_expired でレート制限カウンタを消費しない)", () => {
  it("does not consume the rate-limit budget when the access token has expired", async () => {
    const expiredBundle = testTokenBundle({ ae: nowSeconds() - 10, r: "refresh-token" });
    const expiredCookie = await tokenCookieHeader(testEnv, expiredBundle);
    const fetchSpy = vi.fn(async () => jsonResponse(201, { number: 61, html_url: "https://github.com/kai-kou/alpha/issues/61" }));
    vi.stubGlobal("fetch", fetchSpy);

    for (let i = 0; i < 12; i++) {
      expect((await postIssue(expiredCookie, { title: `t${i}` })).status).toBe(401);
    }
    // 失効リクエストで予算を使い切っていれば、リフレッシュ後の 1 通目が 429 になってしまう。
    const refreshed = await tokenCookieHeader(testEnv, { ...expiredBundle, ae: nowSeconds() + 3600 });
    expect((await postIssue(refreshed, { title: "after refresh" })).status).toBe(201);
  });
});

describe("POST /api/issues のアプリ側レート制限 (不正利用対策・PR-4/OQ-6)", () => {
  it("allows up to the per-minute limit (10) and blocks the 11th with 429 + Retry-After", async () => {
    const cookie = await loginSession();
    let call = 0;
    const fetchSpy = vi.fn(async () =>
      jsonResponse(201, { number: 100 + call++, html_url: "https://github.com/kai-kou/alpha/issues/x" }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    for (let i = 0; i < 10; i++) {
      const res = await postIssue(cookie, { title: `t${i}` });
      expect(res.status).toBe(201);
    }

    const blocked = await postIssue(cookie, { title: "t10" });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body = (await blocked.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
    // 上限超過分は GitHub 側を呼び出す前にアプリ側で止める。
    expect(fetchSpy).toHaveBeenCalledTimes(10);
  });

  it("keeps the limit scoped per user, not shared globally", async () => {
    const cookieA = await loginSession();
    const cookieB = await loginSession();
    const fetchSpy = vi.fn(async () => jsonResponse(201, { number: 1, html_url: "https://github.com/kai-kou/alpha/issues/1" }));
    vi.stubGlobal("fetch", fetchSpy);

    for (let i = 0; i < 10; i++) {
      expect((await postIssue(cookieA, { title: `a${i}` })).status).toBe(201);
    }
    expect((await postIssue(cookieA, { title: "a10" })).status).toBe(429);
    // 別ユーザーは影響を受けない。
    expect((await postIssue(cookieB, { title: "b0" })).status).toBe(201);
  });
});
