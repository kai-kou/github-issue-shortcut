import { test, expect } from "@playwright/test";

// PWA インストール可能要件（#21・FR-10・NFR-1）の E2E。
// カバー範囲: manifest / Service Worker が配信されること、SW がページを制御した状態でも
// /auth/* へのナビゲーションが SW のフォールバック（キャッシュ済み index.html）に横取りされず
// 実際に Worker（→ モック GitHub の認可エンドポイント）まで届くこと（MUST 要件の回帰防止）。
test.describe("PWA インストール可能要件", () => {
  test("manifest / Service Worker が配信され、SW 制御下でも /auth/* が Worker まで届く", async ({ page }) => {
    const manifestRes = await page.request.get("/manifest.webmanifest");
    expect(manifestRes.status()).toBe(200);
    const manifest = await manifestRes.json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    const swRes = await page.request.get("/sw.js");
    expect(swRes.status()).toBe(200);
    expect(swRes.headers()["content-type"]).toMatch(/javascript/);

    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");

    // SW の登録・制御確立を待つ（skipWaiting + clientsClaim のため初回ロードで active になる）
    await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    expect(controlled).toBe(true);

    // SW 制御下でも /auth/login はキャッシュ済み index.html を即返さず、実際に
    // Worker → モック GitHub 認可 → /auth/callback を経由して "/" へ戻ってくる
    // （SW がフォールバックを横取りしていれば URL は "/auth/login" のまま止まる）。
    await page.goto("/auth/login");
    await expect(page).toHaveURL(/\/$/);
    const me = await page.request.get("/api/me");
    expect(me.status()).toBe(200);
    expect((await me.json()).login).toBe("e2e-user");
  });
});
