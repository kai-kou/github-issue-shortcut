import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptString, hashSessionId, randomToken } from "./crypto";
import { applySchema, createSession, nowSeconds, saveTokens, upsertUser } from "./store";
import type { Env } from "./types";

const testEnv = env as unknown as Env;
const db = testEnv.DB;

const SESSION_COOKIE = "__Host-session";

beforeAll(async () => {
  await applySchema(db);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** ログイン済みユーザーを作り、`/api/issues` に使えるセッション Cookie ヘッダを返す。 */
async function loginSession(): Promise<string> {
  const userId = await upsertUser(db, { id: Math.floor(Math.random() * 1e9), login: "u", avatar_url: "" });
  // access token は期限内にしておき、getValidAccessToken がリフレッシュ用の fetch を呼ばないようにする
  // （テストで stub する fetch は GitHub Issue 作成の 1 回だけに絞りたいため）。復号は実際に走るため、
  // 正しく暗号化した値を保存する。
  await saveTokens(db, userId, {
    accessEnc: await encryptString(testEnv.TOKEN_ENCRYPTION_KEY, "test-access-token"),
    accessExpiresAt: nowSeconds() + 3600,
    refreshEnc: null,
    refreshExpiresAt: null,
  });
  const sessionId = randomToken(32);
  await createSession(db, await hashSessionId(sessionId), userId, 3600);
  return `${SESSION_COOKIE}=${sessionId}`;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function postIssue(cookie: string) {
  return SELF.fetch("https://example.com/api/issues", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ repo: "kai-kou/alpha", title: "x", body: "" }),
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
