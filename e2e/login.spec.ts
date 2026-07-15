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

    // 復帰後、モックユーザー（e2e-user）でログイン中表示になる
    await expect(page.getByText(/e2e-user/)).toBeVisible();
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
});
