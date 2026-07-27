import { createExecutionContext, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { nowSeconds } from "./time";
import { loginCookie, testTokenBundle, tokenCookieHeader } from "./test-support";
import { currentKeyVersion } from "./tokenCookie";
import type { Env } from "./types";

const testEnv = env as unknown as Env;

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
  it("reports ready when the configured bindings and secrets are usable", async () => {
    const res = await SELF.fetch("https://example.com/api/ready");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ready: boolean; checks: Record<string, boolean> };
    expect(body.ready).toBe(true);
    expect(body.checks.encryptionKey).toBe(true); // miniflare のテスト鍵は有効
    expect(body.checks.clientId).toBe(true); // miniflare のテスト client_id
    expect(body.checks.rateLimiter).toBe(true); // wrangler.jsonc の ratelimits バインディング
  });

  it("detects a missing rate limit binding instead of letting every submission through (PR-4)", async () => {
    // レート制限バインディングの設定漏れは 500 にならず「制限が効かないまま起票が通る」形で
    // 表面化する（本番で気づけない）。readiness チェックで先に落とす。
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://example.com/api/ready"),
      { ...testEnv, ISSUE_RATE_LIMIT: undefined } as unknown as Env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ready: boolean; checks: Record<string, boolean> };
    expect(body.ready).toBe(false);
    expect(body.checks.rateLimiter).toBe(false);
  });

  it("reports not-ready when the E2E relaxed rate limit is enabled (本番へ紛れ込む事故の検知)", async () => {
    // E2E の wrangler dev が使う緩和フラグ（上限 1000 件/分）が本番 vars にコピーされると、
    // 不正利用対策が実質無効のまま 200 を返してしまう。それを readiness で落とす。
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://example.com/api/ready"),
      { ...testEnv, ISSUE_RATE_LIMIT_RELAXED_ENABLED: "1" } as unknown as Env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ready: boolean; checks: Record<string, boolean> };
    expect(body.ready).toBe(false);
    expect(body.checks.rateLimiterStrict).toBe(false);
    expect(body.checks.rateLimiter).toBe(true); // バインディング自体は存在する
  });

  it("reports an unusable TOKEN_KEY_VERSION instead of silently falling back to v1", async () => {
    // env を差し替えるため SELF ではなくハンドラを直接呼ぶ（SELF.fetch は env を受け取らない）。
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://example.com/api/ready"),
      { ...testEnv, TOKEN_KEY_VERSION: "v2" },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { checks: Record<string, boolean> };
    expect(body.checks.keyVersion).toBe(false);
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
    // 現行バージョン + 1 で封入する（定数直書きだと本番でローテーションした瞬間にテストが壊れる）。
    const rotated = await loginCookie({
      ...testEnv,
      TOKEN_KEY_VERSION: String(currentKeyVersion(testEnv) + 1),
    });
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

  it("keeps the cookies when the refresh fails transiently (GitHub 5xx で強制ログアウトしない)", async () => {
    const cookie = await loginCookie(testEnv, { ae: nowSeconds() - 10, r: "refresh-token" });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(503, {})));

    const res = await SELF.fetch("https://example.com/auth/refresh", {
      method: "POST",
      headers: { Origin: "https://example.com", Cookie: cookie },
    });
    expect(res.status).toBe(502);
    // まだ有効な refresh token を持つ利用者を、一過性障害で追い出さない。
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("documents that the server alone cannot serialize two concurrent refreshes (§5 の受容したトレードオフ)", async () => {
    // 直列化はクライアントの Web Locks が担う。サーバー側は同じ古い Cookie を持つ 2 本が同時に
    // 届くと片方が失効する（旧実装の D1 行ロックが担っていた保護は構造的に無い）。
    const cookie = await loginCookie(testEnv, { ae: nowSeconds() - 10, r: "single-use" });
    let consumed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const params = new URLSearchParams(String(init.body));
        if (params.get("refresh_token") !== "single-use" || consumed) {
          return jsonResponse(200, { error: "bad_refresh_token" });
        }
        consumed = true;
        return jsonResponse(200, { access_token: "new-access", expires_in: 28800, refresh_token: "rotated" });
      }),
    );

    const refresh = () =>
      SELF.fetch("https://example.com/auth/refresh", {
        method: "POST",
        headers: { Origin: "https://example.com", Cookie: cookie },
      });
    const [a, b] = await Promise.all([refresh(), refresh()]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
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

  it("clears both token cookies and revokes the token at GitHub (漏れた Cookie を無効化する)", async () => {
    const cookie = await loginCookie(testEnv);
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await SELF.fetch("https://example.com/auth/logout", {
      method: "POST",
      headers: { Origin: "https://example.com", Cookie: cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(204);
    // Cookie を消すだけでは、値をコピーされていた相手を止められない。
    const revoke = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(revoke[0]).toContain("/applications/");
    expect(revoke[1].method).toBe("DELETE");
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

  it("destroys the token cookies and revokes the GitHub token (FR-12)", async () => {
    const bundle = testTokenBundle();
    // GitHub 側のトークン失効呼び出し（ベストエフォート）は stub で受ける。
    const revoke = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", revoke);

    const res = await SELF.fetch("https://example.com/api/account", {
      method: "DELETE",
      headers: { Origin: "https://example.com", Cookie: await tokenCookieHeader(testEnv, bundle) },
    });
    expect(res.status).toBe(204);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("__Host-gh=");
    expect(setCookie).toContain("Max-Age=0");

    // Cookie を消すだけでは、値をコピーされていた相手を止められない（自己完結型のクレデンシャル）。
    // GitHub 側の失効 API が呼ばれることまで確認する（P3 以降、サーバーに消すべき記録は無い）。
    expect(revoke).toHaveBeenCalled();
  });
});
