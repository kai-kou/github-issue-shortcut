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

    // モック GitHub は単回使用ローテーションを再現しており、2 回目以降のリフレッシュは
    // bad_refresh_token になる。ここが 1 回であることは「ブラウザ配線（navigator.locks 経由の
    // ensureFreshAccessToken）が実際に通り、重複リフレッシュを起こしていない」ことを示す。
    //
    // 複数タブ同時起動そのものは E2E にしない: Service Worker 経由のリクエストが page.route を
    // 素通りするため「失効した Cookie を持つ状態」を安定して作れず、ロックの正否ではなく
    // セットアップ起因でフレークする。タブ・SW をまたぐ直列化の判定ロジックは
    // src/auth/tokenRefresh.test.ts の並行呼び出しテスト（同一コードパス・ロックを注入）で担保する。
    const refreshes = await request.get(`${MOCK_GITHUB_URL}/mock/refresh-count`);
    expect((await refreshes.json()).count).toBe(1);
  });

  // Service Worker を止めて `page.route` が確実に効くようにする（SW 経由のリクエストは
  // page.route を素通りするため、「リフレッシュを止めて失効状態を保つ」セットアップが安定しない）。
  test.describe("期限 Cookie の改ざん・時計ずれ耐性", () => {
    test.use({ serviceWorkers: "block" });

    test("期限 Cookie が未来を指していても、401 を受けたら強制リフレッシュして回復する", async ({ page, request }) => {
      // `__Host-gh-exp` は JS から書き換え可能（＝端末の時計ずれや悪性拡張でも起こる）。この値を
      // 信じて先回りリフレッシュを飛ばすと、サーバーの 401 から自己回復できなくなる（#164 C-2/S-4）。
      await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
        data: {
          accessTokenTtl: 1,
          installations: [{ id: 2003, repos: [{ id: 1, full_name: "kai-kou/alpha", private: false }] }],
        },
      });

      // 自動リフレッシュを止めたままログインし、「失効した Cookie を持つ状態」を作る。
      await page.route("**/auth/refresh", (route) => route.abort());
      await page.goto("/");
      await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
      await page.waitForURL((url) => url.pathname === "/");
      // リフレッシュを止めているので、復帰後は未ログイン表示に落ち着く。ここまで待ってから
      // 解除することで、後続の Set-Cookie が期限の書き換えと競合しないようにする。
      await expect(page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ })).toBeVisible();
      await page.unroute("**/auth/refresh");

      // 期限だけ「まだ十分先」に書き換える（トークン本体は失効したまま）。
      await page.evaluate(() => {
        const future = Math.floor(Date.now() / 1000) + 86400;
        document.cookie = `__Host-gh-exp=${future}; Secure; Path=/`;
      });

      await page.goto("/");
      // 先回り判定は「まだ有効」と誤認するが、401 を根拠に強制リフレッシュして回復する。
      await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toBeVisible({ timeout: 15_000 });
      const refreshes = await request.get(`${MOCK_GITHUB_URL}/mock/refresh-count`);
      expect((await refreshes.json()).count).toBe(1);
    });
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
