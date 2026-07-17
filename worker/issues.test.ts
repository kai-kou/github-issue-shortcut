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

function postIssue(
  cookie: string,
  input: { repo?: string; title?: string; body?: string; clientRequestId?: string } = {},
) {
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

describe("POST /api/issues の二重送信防止 (B4-3/FR-24)", () => {
  it("creates the issue on the first submission and calls GitHub exactly once", async () => {
    const cookie = await loginSession();
    const fetchSpy = vi.fn(async () => jsonResponse(201, { number: 42, html_url: "https://github.com/kai-kou/alpha/issues/42" }));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await postIssue(cookie);
    expect(res.status).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("blocks an identical resubmission (re-tap / timeout retry) without calling GitHub again", async () => {
    const cookie = await loginSession();
    const fetchSpy = vi.fn(async () => jsonResponse(201, { number: 43, html_url: "https://github.com/kai-kou/alpha/issues/43" }));
    vi.stubGlobal("fetch", fetchSpy);

    const first = await postIssue(cookie);
    expect(first.status).toBe(201);

    const second = await postIssue(cookie);
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe("duplicate_submission");

    // GitHub には最初の 1 回しか呼ばれていない（二重作成なし）。
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not block a resubmission with different content from the same user/repo", async () => {
    const cookie = await loginSession();
    const fetchSpy = vi.fn(async () => jsonResponse(201, { number: 44, html_url: "https://github.com/kai-kou/alpha/issues/44" }));
    vi.stubGlobal("fetch", fetchSpy);

    const first = await postIssue(cookie, { title: "first" });
    expect(first.status).toBe(201);

    const second = await postIssue(cookie, { title: "second" });
    expect(second.status).toBe(201);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not log a failed attempt, so a retry after a genuine failure is allowed through", async () => {
    const cookie = await loginSession();
    // Response は生成元リクエストの I/O コンテキストに紐づくため、他リクエスト（2 回目の SELF.fetch）から
    // 読むと Workers ランタイムが例外を投げる。呼び出しごとに新しい Response を作る factory にする。
    let call = 0;
    const fetchSpy = vi.fn(async () =>
      call++ === 0
        ? jsonResponse(502, { message: "boom" })
        : jsonResponse(201, { number: 45, html_url: "https://github.com/kai-kou/alpha/issues/45" }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const first = await postIssue(cookie);
    expect(first.status).toBe(502);

    const second = await postIssue(cookie);
    expect(second.status).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("lets only one of two concurrent identical submissions create a GitHub issue (no check-then-act race)", async () => {
    const cookie = await loginSession();
    let call = 0;
    const fetchSpy = vi.fn(async () => jsonResponse(201, { number: 46 + call++, html_url: "https://github.com/kai-kou/alpha/issues/x" }));
    vi.stubGlobal("fetch", fetchSpy);

    const [a, b] = await Promise.all([postIssue(cookie), postIssue(cookie)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    // 送信枠の予約が原子的なため、ほぼ同時の二重送信でも GitHub には 1 回しか呼ばれない。
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

/** clientRequestId ベースの検証のため userId も返すログインヘルパー（loginSession は cookie のみ返す）。 */
async function loginSessionForUser(): Promise<{ cookie: string; userId: string }> {
  const userId = await upsertUser(db, { id: Math.floor(Math.random() * 1e9), login: "u2", avatar_url: "" });
  await saveTokens(db, userId, {
    accessEnc: await encryptString(testEnv.TOKEN_ENCRYPTION_KEY, "test-access-token"),
    accessExpiresAt: nowSeconds() + 3600,
    refreshEnc: null,
    refreshExpiresAt: null,
  });
  const sessionId = randomToken(32);
  await createSession(db, await hashSessionId(sessionId), userId, 3600);
  return { cookie: `${SESSION_COOKIE}=${sessionId}`, userId };
}

describe("POST /api/issues のオフラインキュー再送の重複防止 (B4-4/OQ-8)", () => {
  it("keeps blocking a resend with the same clientRequestId even after the FR-24 short window (30s) has elapsed", async () => {
    const { cookie, userId } = await loginSessionForUser();
    const fetchSpy = vi.fn(async () => jsonResponse(201, { number: 50, html_url: "https://github.com/kai-kou/alpha/issues/50" }));
    vi.stubGlobal("fetch", fetchSpy);

    const first = await postIssue(cookie, { clientRequestId: "cr-1" });
    expect(first.status).toBe(201);

    // FR-24 の短時間窓（30秒・content_hash）が経過した体にする。client_request_id は別テーブル
    // （長時間窓）なので影響を受けず、B4-4 の重複防止が単独で機能することを確認する。
    await db
      .prepare("UPDATE issue_log SET created_at = created_at - 60 WHERE user_id = ? AND repo = ?")
      .bind(userId, "kai-kou/alpha")
      .run();

    const second = await postIssue(cookie, { clientRequestId: "cr-1" });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe("duplicate_submission");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("releases the client_request_id reservation on GitHub failure, allowing a genuine retry through", async () => {
    const { cookie } = await loginSessionForUser();
    let call = 0;
    const fetchSpy = vi.fn(async () =>
      call++ === 0
        ? jsonResponse(502, { message: "boom" })
        : jsonResponse(201, { number: 51, html_url: "https://github.com/kai-kou/alpha/issues/51" }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const first = await postIssue(cookie, { clientRequestId: "cr-2" });
    expect(first.status).toBe(502);

    const second = await postIssue(cookie, { clientRequestId: "cr-2" });
    expect(second.status).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not affect a genuinely new submission (different clientRequestId, different content)", async () => {
    const { cookie } = await loginSessionForUser();
    const fetchSpy = vi.fn(async () => jsonResponse(201, { number: 52, html_url: "https://github.com/kai-kou/alpha/issues/52" }));
    vi.stubGlobal("fetch", fetchSpy);

    const first = await postIssue(cookie, { title: "first", clientRequestId: "cr-3" });
    expect(first.status).toBe(201);

    const second = await postIssue(cookie, { title: "second", clientRequestId: "cr-4" });
    expect(second.status).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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
