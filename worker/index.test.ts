import { createExecutionContext, createScheduledController, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker, { buildDynamicManifest } from "./index";
import { applySchema, nowSeconds, reserveIssueLog, upsertUser } from "./store";
import type { Env } from "./types";

const db = (env as unknown as Env).DB;

describe("/api/health", () => {
  it("responds with status ok", async () => {
    const response = await SELF.fetch("https://example.com/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

describe("GET /api/ready", () => {
  it("reports not-ready (503) when the database is not provisioned", async () => {
    // このテストファイルはスキーマを適用しないため、D1 のテーブルが存在しない。
    // 本番で「remote D1 未マイグレーション」により /auth/callback が 500 になった事象
    // （E2E が見逃したクラス）を、readiness チェックが検知できることを示す。
    const res = await SELF.fetch("https://example.com/api/ready");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ready: boolean; checks: Record<string, boolean> };
    expect(body.ready).toBe(false);
    expect(body.checks.encryptionKey).toBe(true); // miniflare のテスト鍵は有効
    expect(body.checks.clientId).toBe(true); // miniflare のテスト client_id
    expect(body.checks.database).toBe(false); // スキーマ未適用 → 検知される
  });
});

describe("GET /auth/login", () => {
  it("redirects to GitHub authorize with state + PKCE and sets a pre-auth cookie", async () => {
    const res = await SELF.fetch("https://example.com/auth/login", { redirect: "manual" });
    expect(res.status).toBe(302);

    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("https://github.com/login/oauth/authorize");
    const authUrl = new URL(location);
    expect(authUrl.searchParams.get("client_id")).toBe("test-client-id");
    expect(authUrl.searchParams.get("state")).toBeTruthy();
    expect(authUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("redirect_uri")).toBe("https://example.com/auth/callback");

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("__Host-preauth=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
  });
});

describe("GET /auth/callback", () => {
  it("rejects a request missing code/state/pre-auth cookie", async () => {
    const res = await SELF.fetch("https://example.com/auth/callback", { redirect: "manual" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });

  it("redirects to top instead of 400 on GitHub App install-completion return (no pre-auth cookie)", async () => {
    const res = await SELF.fetch(
      "https://example.com/auth/callback?installation_id=123&setup_action=install",
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://example.com/?setup=complete");
  });

  it("still 400s a bare direct access with neither pre-auth cookie nor setup params", async () => {
    const res = await SELF.fetch("https://example.com/auth/callback?code=x&state=y", {
      redirect: "manual",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });
});

describe("GET /api/me", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await SELF.fetch("https://example.com/api/me");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthenticated");
  });
});

describe("GET /api/installations", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await SELF.fetch("https://example.com/api/installations");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthenticated");
  });
});

describe("GET /api/repos", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await SELF.fetch("https://example.com/api/repos");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthenticated");
  });
});

describe("GET /api/labels", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await SELF.fetch("https://example.com/api/labels?repo=kai-kou/alpha");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthenticated");
  });
});

describe("POST /api/issues", () => {
  it("rejects a cross-origin request (CSRF)", async () => {
    const res = await SELF.fetch("https://example.com/api/issues", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "kai-kou/alpha", title: "x" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await SELF.fetch("https://example.com/api/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "kai-kou/alpha", title: "x" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthenticated");
  });
});

describe("POST /auth/logout", () => {
  it("rejects a cross-origin request (CSRF)", async () => {
    const res = await SELF.fetch("https://example.com/auth/logout", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      redirect: "manual",
    });
    expect(res.status).toBe(403);
  });

  it("is idempotent for a same-origin request without a session", async () => {
    const res = await SELF.fetch("https://example.com/auth/logout", {
      method: "POST",
      headers: { Origin: "https://example.com" },
      redirect: "manual",
    });
    expect(res.status).toBe(204);
  });
});

describe("DELETE /api/account", () => {
  it("rejects a cross-origin request (CSRF)", async () => {
    const res = await SELF.fetch("https://example.com/api/account", {
      method: "DELETE",
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await SELF.fetch("https://example.com/api/account", { method: "DELETE" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthenticated");
  });
});

describe("scheduled handler (issue_log 保持期間クリーンアップ・#71)", () => {
  it("deletes issue_log rows older than the retention window via the Cron Trigger wiring", async () => {
    await applySchema(db);
    const userId = await upsertUser(db, { id: 3001, login: "cronuser", avatar_url: "" });
    await reserveIssueLog(db, userId, "kai-kou/alpha", "hash-cron", 30);
    await db
      .prepare("UPDATE issue_log SET created_at = ? WHERE user_id = ? AND repo = ? AND content_hash = ?")
      .bind(nowSeconds() - 8 * 24 * 60 * 60, userId, "kai-kou/alpha", "hash-cron")
      .run();

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, ctx);
    await waitOnExecutionContext(ctx);

    const remaining = await db.prepare("SELECT COUNT(*) as count FROM issue_log").first<{ count: number }>();
    expect(remaining?.count).toBe(0);
  });
});

describe("buildDynamicManifest (#98)", () => {
  const base = { name: "GitHub Issue Shortcut", shortcuts: [{ name: "static", short_name: "s", url: "/new", icons: [{ src: "/icons/icon-192.png" }] }] };

  it("returns base unchanged when there are no shortcuts", () => {
    expect(buildDynamicManifest(base, [])).toBe(base);
  });

  it("caps at 3 entries, keeping the given order, and falls back name -> title -> repo", () => {
    const result = buildDynamicManifest(base, [
      { repo: "kai-kou/alpha", labels: ["bug"], title: "", name: "バグ" },
      { repo: "kai-kou/beta", labels: [], title: "改善案", name: "" },
      { repo: "kai-kou/gamma", labels: [], title: "", name: "" },
      { repo: "kai-kou/delta", labels: [], title: "", name: "" },
    ]);
    const shortcuts = result.shortcuts as Array<{ name: string; short_name: string; url: string; icons: unknown }>;
    expect(shortcuts).toHaveLength(3);
    expect(shortcuts.map((s) => s.name)).toEqual(["バグ", "改善案", "kai-kou/gamma"]);
    expect(shortcuts[0].url).toBe("/new?repo=kai-kou%2Falpha&labels=bug");
    // 静的 manifest 側の shortcuts アイコンを流用する。
    expect(shortcuts[0].icons).toEqual(base.shortcuts[0].icons);
  });

  it("truncates short_name to the display-name limit (12 chars) but keeps name untruncated", () => {
    const longRepo = "kai-kou/a-very-long-repository-name";
    const result = buildDynamicManifest(base, [{ repo: longRepo, labels: [], title: "", name: "" }]);
    const [shortcut] = result.shortcuts as Array<{ name: string; short_name: string }>;
    expect(shortcut.name).toBe(longRepo);
    expect(shortcut.short_name).toBe(longRepo.slice(0, 12));
  });

  it("falls back to a generic label when repo, title, and name are all empty", () => {
    const result = buildDynamicManifest(base, [{ repo: "", labels: [], title: "", name: "" }]);
    const [shortcut] = result.shortcuts as Array<{ name: string }>;
    expect(shortcut.name).toBe("ショートカット");
  });
});

// 注: `GET /manifest.webmanifest` エンドポイント自体の統合テストは、ASSETS バインディング経由で
// ビルド成果物（dist/client/manifest.webmanifest）を要求する。Workers Builds は build より前に
// test を実行するため dist/client が未生成で 404 になる（#98）。エンドポイントの実動作は E2E
// （e2e/pwa.spec.ts）が、shortcuts 差し替えロジックは上記 buildDynamicManifest 純関数テストが担う。
