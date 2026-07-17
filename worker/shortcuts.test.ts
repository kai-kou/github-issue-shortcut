import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { encryptString, hashSessionId, randomToken } from "./crypto";
import { applySchema, createSession, nowSeconds, saveTokens, upsertUser } from "./store";
import type { Env } from "./types";

const testEnv = env as unknown as Env;
const db = testEnv.DB;

const SESSION_COOKIE = "__Host-session";

beforeAll(async () => {
  await applySchema(db);
});

/** ログイン済みユーザーを作り、`/api/shortcuts` に使えるセッション Cookie ヘッダを返す。 */
async function loginSession(): Promise<string> {
  const userId = await upsertUser(db, { id: Math.floor(Math.random() * 1e9), login: "u", avatar_url: "" });
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

describe("GET /api/shortcuts", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await SELF.fetch("https://example.com/api/shortcuts");
    expect(res.status).toBe(401);
  });

  it("returns an empty list for a fresh user", async () => {
    const cookie = await loginSession();
    const res = await SELF.fetch("https://example.com/api/shortcuts", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shortcuts: [] });
  });
});

describe("POST /api/shortcuts", () => {
  it("rejects a cross-origin request (CSRF)", async () => {
    const res = await SELF.fetch("https://example.com/api/shortcuts", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "kai-kou/alpha", labels: [], title: "" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await SELF.fetch("https://example.com/api/shortcuts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "kai-kou/alpha", labels: [], title: "" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a payload where repo, labels, and title are all empty", async () => {
    const cookie = await loginSession();
    const res = await SELF.fetch("https://example.com/api/shortcuts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ repo: "", labels: [], title: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });

  it("rejects a payload exceeding the label count/length limits", async () => {
    const cookie = await loginSession();
    const tooManyLabels = await SELF.fetch("https://example.com/api/shortcuts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ repo: "", labels: Array.from({ length: 21 }, (_, i) => `l${i}`), title: "" }),
    });
    expect(tooManyLabels.status).toBe(400);

    const tooLongLabel = await SELF.fetch("https://example.com/api/shortcuts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ repo: "", labels: ["x".repeat(51)], title: "" }),
    });
    expect(tooLongLabel.status).toBe(400);
  });

  it("creates a preset and returns it in a subsequent list", async () => {
    const cookie = await loginSession();
    const createRes = await SELF.fetch("https://example.com/api/shortcuts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ repo: "kai-kou/alpha", labels: ["bug", "P1"], title: "バグ報告" }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; repo: string; labels: string[]; title: string };
    expect(created.repo).toBe("kai-kou/alpha");
    expect(created.labels).toEqual(["bug", "P1"]);
    expect(created.title).toBe("バグ報告");

    const listRes = await SELF.fetch("https://example.com/api/shortcuts", { headers: { Cookie: cookie } });
    const body = (await listRes.json()) as { shortcuts: unknown[] };
    expect(body.shortcuts).toEqual([created]);
  });
});

describe("PUT /api/shortcuts/:id", () => {
  it("returns 404 for a shortcut owned by another user", async () => {
    const ownerCookie = await loginSession();
    const createRes = await SELF.fetch("https://example.com/api/shortcuts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ repo: "kai-kou/alpha", labels: [], title: "" }),
    });
    const created = (await createRes.json()) as { id: string };

    const otherCookie = await loginSession();
    const res = await SELF.fetch(`https://example.com/api/shortcuts/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: otherCookie },
      body: JSON.stringify({ repo: "kai-kou/beta", labels: [], title: "" }),
    });
    expect(res.status).toBe(404);
  });

  it("updates a preset owned by the caller", async () => {
    const cookie = await loginSession();
    const createRes = await SELF.fetch("https://example.com/api/shortcuts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ repo: "kai-kou/alpha", labels: [], title: "" }),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await SELF.fetch(`https://example.com/api/shortcuts/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ repo: "kai-kou/beta", labels: ["enhancement"], title: "改善案" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: created.id, repo: "kai-kou/beta", labels: ["enhancement"], title: "改善案" });
  });
});

describe("DELETE /api/shortcuts/:id", () => {
  it("rejects a cross-origin request (CSRF)", async () => {
    const res = await SELF.fetch("https://example.com/api/shortcuts/whatever", {
      method: "DELETE",
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for a shortcut owned by another user, and 204 for the owner", async () => {
    const ownerCookie = await loginSession();
    const createRes = await SELF.fetch("https://example.com/api/shortcuts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ repo: "kai-kou/alpha", labels: [], title: "" }),
    });
    const created = (await createRes.json()) as { id: string };

    const otherCookie = await loginSession();
    const forbidden = await SELF.fetch(`https://example.com/api/shortcuts/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: otherCookie },
    });
    expect(forbidden.status).toBe(404);

    const ok = await SELF.fetch(`https://example.com/api/shortcuts/${created.id}`, {
      method: "DELETE",
      headers: { Cookie: ownerCookie },
    });
    expect(ok.status).toBe(204);
  });
});
