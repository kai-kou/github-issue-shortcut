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
    const created = (await createRes.json()) as { id: string; repo: string; labels: string[]; title: string; name: string };
    expect(created.repo).toBe("kai-kou/alpha");
    expect(created.labels).toEqual(["bug", "P1"]);
    expect(created.title).toBe("バグ報告");
    // name を送らなかった場合は空文字がデフォルト（#98・任意フィールド）。
    expect(created.name).toBe("");

    const listRes = await SELF.fetch("https://example.com/api/shortcuts", { headers: { Cookie: cookie } });
    const body = (await listRes.json()) as { shortcuts: unknown[] };
    expect(body.shortcuts).toEqual([created]);
  });

  it("accepts an optional display name up to the length limit and persists it", async () => {
    const cookie = await loginSession();
    const nameAtLimit = "あ".repeat(12);
    const createRes = await SELF.fetch("https://example.com/api/shortcuts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ repo: "kai-kou/alpha", labels: [], title: "", name: nameAtLimit }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { name: string };
    expect(created.name).toBe(nameAtLimit);
  });

  it("rejects a name exceeding the 12-character limit", async () => {
    const cookie = await loginSession();
    const res = await SELF.fetch("https://example.com/api/shortcuts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ repo: "kai-kou/alpha", labels: [], title: "", name: "x".repeat(13) }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
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
    expect(await res.json()).toEqual({
      id: created.id,
      repo: "kai-kou/beta",
      labels: ["enhancement"],
      title: "改善案",
      name: "",
    });
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

// PWA manifest の動的化（#98）: ログインユーザーのショートカットプリセットで manifest.shortcuts を
// 差し替える。schema 適用済みの本ファイル（beforeAll）に置く（worker/index.test.ts は
// GET /api/ready の「schema 未適用」テストのため applySchema を呼べない。未ログイン時に静的
// manifest が返ることの検証は worker/index.test.ts の GET /manifest.webmanifest 側が担う）。
describe("GET /manifest.webmanifest", () => {
  it("returns the static manifest for a logged-in user with no saved shortcuts", async () => {
    const cookie = await loginSession();
    const res = await SELF.fetch("https://example.com/manifest.webmanifest", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shortcuts: Array<{ name: string }> };
    expect(body.shortcuts).toHaveLength(3);
    // 静的プリセット（vite.config.ts の VitePWA manifest）のまま。
    expect(body.shortcuts[0].name).toBe("新しい Issue を作成");
  });

  it("replaces manifest.shortcuts with the caller's saved presets (oldest-first, capped at 3)", async () => {
    const cookie = await loginSession();
    async function save(preset: { repo: string; labels: string[]; title: string; name: string }) {
      const res = await SELF.fetch("https://example.com/api/shortcuts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(preset),
      });
      expect(res.status).toBe(201);
    }
    // name あり → name をそのまま使う。name なし → title へフォールバック。name も title もなし → repo へフォールバック。
    await save({ repo: "kai-kou/alpha", labels: ["bug"], title: "", name: "バグ" });
    await save({ repo: "kai-kou/beta", labels: [], title: "改善案", name: "" });
    await save({ repo: "kai-kou/gamma", labels: [], title: "", name: "" });
    // 4件目は上限（3件）を超えるため manifest には反映されない。
    await save({ repo: "kai-kou/delta", labels: [], title: "", name: "" });

    const res = await SELF.fetch("https://example.com/manifest.webmanifest", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      shortcuts: Array<{ name: string; short_name: string; url: string; icons?: unknown }>;
    };
    expect(body.shortcuts).toHaveLength(3);
    expect(body.shortcuts.map((s) => s.name)).toEqual(["バグ", "改善案", "kai-kou/gamma"]);
    // short_name は表示名の上限（12文字）で切り詰める。"kai-kou/gamma" は 13 文字なので切り詰められる。
    expect(body.shortcuts.map((s) => s.short_name)).toEqual(["バグ", "改善案", "kai-kou/gamm"]);
    expect(body.shortcuts[0].url).toBe("/new?repo=kai-kou%2Falpha&labels=bug");
    expect(body.shortcuts[1].url).toBe("/new?repo=kai-kou%2Fbeta&title=%E6%94%B9%E5%96%84%E6%A1%88");
    expect(body.shortcuts.some((s) => s.name === "kai-kou/delta")).toBe(false);
    // アイコンは静的 manifest の shortcuts 定義を流用する（空配列で欠落させない）。
    expect(body.shortcuts[0].icons).toBeTruthy();
  });
});
