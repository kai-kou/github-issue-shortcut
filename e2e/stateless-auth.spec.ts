import { test, expect } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// P2（Epic #162 / Issue #164）: 認証のステートレス化（暗号化トークン Cookie・自動リフレッシュ）の E2E。
// カバー範囲: ① GitHub トークンが JS から読めないこと ② access token 失効相当からの自動リフレッシュで
// 起票が継続でき、単回使用の refresh token が 1 回しか使われないこと（Web Locks による 1 本化・設計 §5）。
// 鍵ローテーション（TOKEN_KEY_VERSION 変更 → 再ログイン要求）は Worker の再起動が要るためユニットで担保する。
test.describe("ステートレス認証（暗号化トークン Cookie・モック GitHub）", () => {
  test.afterEach(async ({ request }) => {
    // 既定シナリオ（installations 0 件・通常 TTL）へ戻し、他の spec に影響させない。
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [] } });
  });

  test("GitHub トークンが document.cookie から読めない（HttpOnly・NFR-7）", async ({ page, request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [] } });

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    const cookies = await page.evaluate(() => document.cookie);
    // 暗号化トークン Cookie（__Host-gh）は HttpOnly のため JS からは名前ごと見えない。
    const names = cookies
      .split(";")
      .map((part) => part.split("=")[0].trim())
      .filter(Boolean);
    expect(names).not.toContain("__Host-gh");
    // 期限だけを載せた Cookie（個人データではない）は読める。
    expect(names).toContain("__Host-gh-exp");
    // モックの生トークンがどこにも露出していない。
    expect(cookies).not.toContain("mock_access_token");
    expect(cookies).not.toContain("mock_refresh_token");

    // 一方でサーバー側は Cookie だけで認証できている（＝セッションを保存していない）。
    const me = await page.request.get("/api/me");
    expect(me.status()).toBe(200);
    expect((await me.json()).login).toBe("e2e-user");
  });

  test("access token 失効 → 自動リフレッシュ（1 回だけ）→ 起票が継続できる", async ({ page, request }) => {
    // ログイン直後から失効している access token を発行させる（再訪時に期限切れで戻ってきた状況）。
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        accessTokenTtl: 1,
        installations: [{ id: 2001, repos: [{ id: 1, full_name: "kai-kou/alpha", private: false }] }],
      },
    });

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    // 失効を検知したクライアントが /auth/refresh を呼び、リポジトリ一覧まで到達できる。
    await page.getByRole("button", { name: "kai-kou/alpha" }).click();

    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("ステートレス認証の起票");
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByRole("link", { name: /GitHub で開く|Open on GitHub/ })).toBeVisible();

    // 単回使用ローテーションのため、多タブ・多重呼び出しでも GitHub のリフレッシュは 1 回だけ
    // （2 回以上走ると 2 回目以降は bad_refresh_token になり、上の起票が失敗する）。
    const refreshes = await request.get(`${MOCK_GITHUB_URL}/mock/refresh-count`);
    expect((await refreshes.json()).count).toBe(1);
  });

  test("複数タブが同時に起動しても Web Locks でリフレッシュが 1 回に収まる", async ({ context, page, request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        accessTokenTtl: 1,
        installations: [{ id: 2002, repos: [{ id: 1, full_name: "kai-kou/alpha", private: false }] }],
      },
    });

    // ログイン直後の自動リフレッシュを止めたまま「失効した Cookie を持つ状態」を作る
    // （リフレッシュを止めているのでログイン表示にはならない。Cookie の存在で確認する）。
    await page.route("**/auth/refresh", (route) => route.abort());
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await page.waitForURL((url) => url.pathname === "/");
    expect((await context.cookies()).map((c) => c.name)).toContain("__Host-gh");
    await page.unroute("**/auth/refresh");
    await page.close();

    // 同一プロファイルの 2 タブを同時に起動する（Cookie を共有し、どちらも失効を検知する）。
    const [tabA, tabB] = [await context.newPage(), await context.newPage()];
    await Promise.all([tabA.goto("/"), tabB.goto("/")]);
    await Promise.all([
      expect(tabA.getByRole("button", { name: "kai-kou/alpha" })).toBeVisible(),
      expect(tabB.getByRole("button", { name: "kai-kou/alpha" })).toBeVisible(),
    ]);

    // Web Locks はタブ間で共有されるため、2 タブ同時でも GitHub のリフレッシュは 1 回だけ。
    // 直列化が壊れると 2 本目が bad_refresh_token になり、上のリポジトリ表示自体が失敗する。
    const refreshes = await request.get(`${MOCK_GITHUB_URL}/mock/refresh-count`);
    expect((await refreshes.json()).count).toBe(1);
  });

  test("期限 Cookie が未来を指していても、401 を受けたら強制リフレッシュして回復する", async ({ page, request }) => {
    // `__Host-gh-exp` は JS から書き換え可能（＝端末の時計ずれや拡張機能でも起こる）。
    // この値を信じて先回りリフレッシュを飛ばすと、サーバーの 401 から自己回復できなくなる。
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        accessTokenTtl: 1,
        installations: [{ id: 2003, repos: [{ id: 1, full_name: "kai-kou/alpha", private: false }] }],
      },
    });

    await page.route("**/auth/refresh", (route) => route.abort());
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await page.waitForURL((url) => url.pathname === "/");
    await page.unroute("**/auth/refresh");

    // 期限だけ「まだ十分先」に書き換える（トークン本体は失効したまま）。
    await page.evaluate(() => {
      const future = Math.floor(Date.now() / 1000) + 86400;
      document.cookie = `__Host-gh-exp=${future}; Secure; Path=/`;
    });

    await page.goto("/");
    // 先回り判定は「まだ有効」と誤認するが、401 を根拠に強制リフレッシュして回復する。
    // 回復には /api/me 401 → /auth/refresh → 再送 → /api/installations → /api/repos の往復が要るため、
    // 既定の 5 秒だと遅いマシンで足りないことがある。
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toBeVisible({ timeout: 15_000 });
    const refreshes = await request.get(`${MOCK_GITHUB_URL}/mock/refresh-count`);
    expect((await refreshes.json()).count).toBeGreaterThanOrEqual(1);
  });

  test("ログアウトすると GitHub 側でもトークンが失効する（Cookie のコピーを無効化する）", async ({ page, request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [] } });

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.getByRole("button", { name: /メニューを開く|Open menu/ }).first().click();
    await page.getByRole("button", { name: /ログアウト|Sign out/ }).click();
    await expect(page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ })).toBeVisible();

    // Cookie を消すだけでは、値をコピーされていた相手を止められない（自己完結型クレデンシャル）。
    const revoked = await request.get(`${MOCK_GITHUB_URL}/mock/revoked-count`);
    expect((await revoked.json()).count).toBe(1);
  });
});
