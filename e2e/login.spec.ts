import { test, expect } from "@playwright/test";

// OAuth ログインフローの E2E（モック GitHub・Pixel モバイルエミュレーション）。
// 実コード（ブラウザ ↔ Worker ↔ D1）を通し、実 GitHub には触れない。
// カバー範囲: /auth/login（state+PKCE）→ 認可（モック）→ /auth/callback（トークン交換・
// セッション発行）→ /api/me でログイン表示 → /api/installations（A2-1・App 未インストール誘導）→ /auth/logout。
// 実機 Android 固有（WebAPK・standalone PWA の Chrome Custom Tab 経由 OAuth）は対象外。
test.describe("OAuth ログインフロー（モック GitHub・モバイルエミュレーション）", () => {
  test("ログイン → セッション確立 → ログイン表示 → ログアウト", async ({ page }) => {
    // readiness: ローカル D1 マイグレーション済み・鍵・client_id が揃っていること
    const ready = await page.request.get("/api/ready");
    expect(ready.status()).toBe(200);
    expect((await ready.json()).ready).toBe(true);

    await page.goto("/");

    const loginLink = page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ });
    await expect(loginLink).toBeVisible();

    // フルページリダイレクト: /auth/login → モック authorize → /auth/callback → /
    await loginLink.click();

    // 復帰後、モックユーザー（e2e-user）でログイン中表示になる（トップバーのアカウントチップ）
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    // ログイン状態・ログアウトはサイドパネルに集約された。パネルを開いてから操作する。
    await page.getByRole("button", { name: /メニューを開く|Open menu/ }).first().click();
    const logoutButton = page.getByRole("button", { name: /ログアウト|Sign out/ });
    await expect(logoutButton).toBeVisible();

    // /api/me が認証済みを返す（セッション Cookie が確立している）
    const me = await page.request.get("/api/me");
    expect(me.status()).toBe(200);
    expect((await me.json()).login).toBe("e2e-user");

    // A2-1: モック GitHub は installations 0 件を返すため、App インストール誘導が表示される
    const installations = await page.request.get("/api/installations");
    expect(installations.status()).toBe(200);
    expect((await installations.json()).installed).toBe(false);
    await expect(page.getByRole("link", { name: /GitHub App をインストール|Install GitHub App/ })).toBeVisible();

    // ログアウト → 未ログイン状態（ログインリンク）に戻る
    await logoutButton.click();
    await expect(
      page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }),
    ).toBeVisible();
  });

  // A4-3: アカウント削除（FR-12・PR-3）。本アプリ側データの削除 + GitHub 側連携解除の案内を検証する。
  test("アカウント削除 → 本アプリ側データ削除 + 連携解除の案内表示", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    // 削除がローカルの SWR キャッシュ（repos/shortcuts）も消すことを検証するためキャッシュを仕込む
    // （#101・PR #113 レビューで検出した回帰の防止）。
    await page.evaluate(() => {
      localStorage.setItem("issue-shortcut:repos-cache", "{}");
      localStorage.setItem("issue-shortcut:shortcuts-cache", "{}");
    });

    // アカウント削除はサイドパネルのアカウントセクションに集約された。
    await page.getByRole("button", { name: /メニューを開く|Open menu/ }).first().click();
    await page.getByRole("button", { name: /アカウント削除|Delete account/ }).click();
    await page.getByRole("button", { name: /削除する|^Delete$/ }).click();

    // 削除後: GitHub 側連携解除の案内リンクが表示される（Done Criteria）
    await expect(
      page.getByRole("link", { name: /GitHub App の連携管理を開く|Manage GitHub App connection/ }),
    ).toBeVisible();

    // サーバー側でセッションが破棄されている（同一 Cookie での API 呼び出しが 401）
    const me = await page.request.get("/api/me");
    expect(me.status()).toBe(401);

    // 削除でローカル SWR キャッシュ（repos/shortcuts）も消える（clearAllUserCaches・回帰防止）。
    const caches = await page.evaluate(() => ({
      repos: localStorage.getItem("issue-shortcut:repos-cache"),
      shortcuts: localStorage.getItem("issue-shortcut:shortcuts-cache"),
    }));
    expect(caches.repos).toBeNull();
    expect(caches.shortcuts).toBeNull();

    // 削除後にハンバーガーを再度押しても、stale な認証情報（ログアウト・再削除・ユーザー名）が再表示されず、
    // 匿名扱い（ログイン導線）になる（correctness#2 の回帰防止）。
    await page.getByRole("button", { name: /メニューを開く|Open menu/ }).first().click();
    const drawer = page.getByRole("dialog", { name: /メニュー|Menu/ });
    await expect(drawer.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ })).toBeVisible();
    await expect(drawer.getByRole("button", { name: /ログアウト|Sign out/ })).toHaveCount(0);
  });
});
