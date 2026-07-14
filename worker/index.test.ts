import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

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
});

describe("GET /api/me", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await SELF.fetch("https://example.com/api/me");
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
