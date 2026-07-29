import { createExecutionContext, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { nowSeconds } from "./time";
import { loginCookie, testTokenBundle, tokenCookieHeader } from "./test-support";
import { CONTENT_SECURITY_POLICY } from "./securityHeaders";
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

describe("GET /auth/login のレート制限（#207）", () => {
  /**
   * Rate Limiting binding のスタブ。実バインディング（miniflare）は他テストとカウンタを共有し
   * 「上限に達した状態」を決定論的に作れないため、成否を固定したスタブを env 差し替えで渡す。
   * 渡されたキーを記録し、生 IP が Cloudflare 側へ出ていないことの検証にも使う。
   */
  function stubLimiter(success: boolean, keys: string[] = []): RateLimit {
    return {
      limit: async ({ key }: { key?: string }) => {
        keys.push(key ?? "");
        return { success };
      },
    } as unknown as RateLimit;
  }

  function loginRequest(ip = "203.0.113.9"): Request {
    return new Request("https://example.com/auth/login", { headers: { "CF-Connecting-IP": ip } });
  }

  it("上限内なら従来どおり GitHub の認可画面へリダイレクトする", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      loginRequest(),
      { ...testEnv, AUTH_LOGIN_RATE_LIMIT: stubLimiter(true) } as unknown as Env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/login/oauth/authorize");
    expect(res.headers.get("Set-Cookie")).toContain("__Host-preauth=");
  });

  it("上限を超えたら 429 を返し、暗号処理も pre-auth Cookie の発行も行わない", async () => {
    // 本エンドポイントは認証不要で叩けるうえ GitHub API を消費しないため、上流のレート制限に
    // 当たらないまま Worker のリクエスト数と CPU 時間だけを消耗させられる（無料枠が尽きると
    // 正規利用者を含む全員が起票できなくなる）。制限は暗号処理より前に効く必要がある。
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      loginRequest(),
      { ...testEnv, AUTH_LOGIN_RATE_LIMIT: stubLimiter(false) } as unknown as Env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Location")).toBeNull();
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("カウンタのキーに生の IP アドレスを使わない（同一 IP は同一キー・別 IP は別キー）", async () => {
    // プライバシーポリシー §2 の「サーバーは個人データを保存しない」を守るため、Cloudflare 側へ
    // 渡すのは HMAC 済みの逆引き不能な鍵だけにする（rateLimitKey と同じ仮名化方針）。
    const keys: string[] = [];
    const limitEnv = { ...testEnv, AUTH_LOGIN_RATE_LIMIT: stubLimiter(true, keys) } as unknown as Env;
    for (const ip of ["203.0.113.9", "203.0.113.9", "198.51.100.4"]) {
      const ctx = createExecutionContext();
      await worker.fetch(loginRequest(ip), limitEnv, ctx);
      await waitOnExecutionContext(ctx);
    }
    expect(keys).toHaveLength(3);
    for (const key of keys) {
      expect(key).not.toContain("203.0.113.9");
      expect(key).not.toContain("198.51.100.4");
    }
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).not.toBe(keys[2]);
  });

  it("バインディングの設定漏れを readiness で検知する（無制限に叩ける状態を可視化する）", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://example.com/api/ready"),
      { ...testEnv, AUTH_LOGIN_RATE_LIMIT: undefined } as unknown as Env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ready: boolean; checks: Record<string, boolean> };
    expect(body.ready).toBe(false);
    expect(body.checks.authLoginRateLimiter).toBe(false);
  });
});

describe("セキュリティヘッダー（#209）", () => {
  it("Worker が返す JSON レスポンスに CSP と nosniff が付く", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.headers.get("Content-Security-Policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("same-origin");
  });

  it("リダイレクト・エラー応答にも付く（成功パスだけ守られる状態にしない）", async () => {
    const redirect = await SELF.fetch("https://example.com/setup", { redirect: "manual" });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("Content-Security-Policy")).toBe(CONTENT_SECURITY_POLICY);

    const unauthorized = await SELF.fetch("https://example.com/api/me");
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("Content-Security-Policy")).toBe(CONTENT_SECURITY_POLICY);
  });
});

describe("レート制限の集計単位（#217 セルフレビュー: IPv6 ローテーション回避）", () => {
  function keyCapturingLimiter(keys: string[]): RateLimit {
    return {
      limit: async ({ key }: { key?: string }) => {
        keys.push(key ?? "");
        return { success: true };
      },
    } as unknown as RateLimit;
  }

  async function keysFor(ips: string[]): Promise<string[]> {
    const keys: string[] = [];
    const limitEnv = { ...testEnv, AUTH_LOGIN_RATE_LIMIT: keyCapturingLimiter(keys) } as unknown as Env;
    for (const ip of ips) {
      const ctx = createExecutionContext();
      await worker.fetch(
        new Request("https://example.com/auth/login", { headers: { "CF-Connecting-IP": ip } }),
        limitEnv,
        ctx,
      );
      await waitOnExecutionContext(ctx);
    }
    return keys;
  }

  it("同一 /64 の IPv6 は同じバケットに集計される（アドレスを振り直しても上限を回避できない）", async () => {
    // IPv6 は 1 契約者に /64〜/56 が割り当てられる。アドレスごとに別バケットだと、送信元を
    // 1 リクエストずつ変えるだけで「20 件/分」が実質無制限になり、この防御の目的が消える。
    const [a, b, c] = await keysFor([
      "2001:db8:1:2::1",
      "2001:db8:1:2:dead:beef:1:9",
      "2001:0db8:0001:0002:0000:0000:0000:00ff", // 省略なし表記でも同じ /64
    ]);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("別の /64 は別バケットになる（丸めすぎて無関係の利用者を巻き込まない）", async () => {
    const [a, b] = await keysFor(["2001:db8:1:2::1", "2001:db8:1:3::1"]);
    expect(b).not.toBe(a);
  });

  it("IPv4 はアドレス単位のまま集計される", async () => {
    const [a, b, c] = await keysFor(["203.0.113.9", "203.0.113.9", "203.0.113.10"]);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it("IPv4 射影表記の IPv6 は丸めない（上位 64 ビットが定数のため全 IPv4 が 1 バケットに潰れる）", async () => {
    const [a, b] = await keysFor(["::ffff:203.0.113.9", "::ffff:203.0.113.10"]);
    expect(b).not.toBe(a);
  });
});
