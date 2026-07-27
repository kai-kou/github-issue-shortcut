import { createExecutionContext, createScheduledController, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { applySchema, nowSeconds, reserveIssueLog } from "./store";
import { loginCookie } from "./test-support";
import type { Env } from "./types";

const testEnv = env as unknown as Env;
const db = testEnv.DB;

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

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

  it("fetches the user from GitHub instead of a server-side store (保持ゼロ・P2)", async () => {
    const cookie = await loginCookie(testEnv);
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { id: 424242, login: "octocat", avatar_url: "https://example.com/a.png" }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await SELF.fetch("https://example.com/api/me", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      login: "octocat",
      avatarUrl: "https://example.com/a.png",
      githubUserId: 424242,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns token_expired (401) when the access token has expired, without refreshing implicitly (§5-2)", async () => {
    const cookie = await loginCookie(testEnv, { ae: nowSeconds() - 10, r: "refresh-token" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await SELF.fetch("https://example.com/api/me", { headers: { Cookie: cookie } });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("token_expired");
    // API プロキシは暗黙にリフレッシュしない（クライアントが /auth/refresh を 1 本化して呼ぶ）。
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats a cookie sealed with another key version as unauthenticated (鍵ローテーション → 再ログイン)", async () => {
    const rotated = await loginCookie({ ...testEnv, TOKEN_KEY_VERSION: "2" });
    const res = await SELF.fetch("https://example.com/api/me", { headers: { Cookie: rotated } });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthenticated");
  });
});

describe("POST /auth/refresh (§5)", () => {
  it("rejects a cross-origin request (CSRF)", async () => {
    const res = await SELF.fetch("https://example.com/auth/refresh", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 when there is no token cookie", async () => {
    const res = await SELF.fetch("https://example.com/auth/refresh", {
      method: "POST",
      headers: { Origin: "https://example.com" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthenticated");
  });

  it("rotates the tokens and writes them back via Set-Cookie", async () => {
    const cookie = await loginCookie(testEnv, { ae: nowSeconds() - 10, r: "old-refresh" });
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { access_token: "new-access", expires_in: 28800, refresh_token: "new-refresh" }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await SELF.fetch("https://example.com/auth/refresh", {
      method: "POST",
      headers: { Origin: "https://example.com", Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { expiresAt: number };
    expect(body.expiresAt).toBeGreaterThan(nowSeconds());
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    // 暗号化されたトークン Cookie（HttpOnly）と、期限だけを載せる読み取り可能な Cookie の両方を書き戻す。
    expect(setCookie).toContain("__Host-gh=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("__Host-gh-exp=");
    // 生のトークンが Cookie に露出していないこと。
    expect(setCookie).not.toContain("new-access");
    expect(setCookie).not.toContain("new-refresh");
  });

  it("skips the GitHub round trip when another tab already refreshed (Web Locks 内の再確認)", async () => {
    const cookie = await loginCookie(testEnv, { ae: nowSeconds() + 3600, r: "refresh-token" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await SELF.fetch("https://example.com/auth/refresh", {
      method: "POST",
      headers: { Origin: "https://example.com", Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears the cookies and asks for re-login when GitHub rejects the refresh token", async () => {
    const cookie = await loginCookie(testEnv, { ae: nowSeconds() - 10, r: "stale-refresh" });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { error: "bad_refresh_token" })));

    const res = await SELF.fetch("https://example.com/auth/refresh", {
      method: "POST",
      headers: { Origin: "https://example.com", Cookie: cookie },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("reauth_required");
    expect(res.headers.get("Set-Cookie") ?? "").toContain("Max-Age=0");
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

  it("clears both token cookies", async () => {
    const cookie = await loginCookie(testEnv);
    const res = await SELF.fetch("https://example.com/auth/logout", {
      method: "POST",
      headers: { Origin: "https://example.com", Cookie: cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(204);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("__Host-gh=");
    expect(setCookie).toContain("__Host-gh-exp=");
    expect(setCookie).toContain("Max-Age=0");
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

  it("only destroys the token cookies (サーバーには消すべき個人データが無い・P2)", async () => {
    const cookie = await loginCookie(testEnv);
    const res = await SELF.fetch("https://example.com/api/account", {
      method: "DELETE",
      headers: { Origin: "https://example.com", Cookie: cookie },
    });
    expect(res.status).toBe(204);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("__Host-gh=");
    expect(setCookie).toContain("Max-Age=0");
  });
});

describe("scheduled handler (issue_log 保持期間クリーンアップ・#71)", () => {
  it("deletes issue_log rows older than the retention window via the Cron Trigger wiring", async () => {
    await applySchema(db);
    const userKey = "3001";
    await reserveIssueLog(db, userKey, "kai-kou/alpha", "hash-cron", 30);
    await db
      .prepare("UPDATE issue_log SET created_at = ? WHERE user_key = ? AND repo = ? AND content_hash = ?")
      .bind(nowSeconds() - 8 * 24 * 60 * 60, userKey, "kai-kou/alpha", "hash-cron")
      .run();

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), env as unknown as Env, ctx);
    await waitOnExecutionContext(ctx);

    const remaining = await db.prepare("SELECT COUNT(*) as count FROM issue_log").first<{ count: number }>();
    expect(remaining?.count).toBe(0);
  });
});
