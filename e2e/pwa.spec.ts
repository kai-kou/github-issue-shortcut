import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

    // アイコン長押しメニューの定番プリセット（C2-1・FR-17・#11）。
    // Android Chrome の上限（最大 3 個）と、各エントリが起票画面（/new）を指すことを検証する。
    expect(manifest.shortcuts.length).toBeLessThanOrEqual(3);
    for (const shortcut of manifest.shortcuts) {
      expect(shortcut.name).toBeTruthy();
      expect(shortcut.url).toMatch(/^\/new(\?.*)?$/);
      expect(shortcut.icons?.length).toBeGreaterThanOrEqual(1);
    }

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
    // page.request（APIRequestContext）は SW を経由しないため、ページ内 fetch で SW 非干渉まで検証する。
    const me = await page.evaluate(() =>
      fetch("/api/me", { credentials: "same-origin" }).then((r) => r.json()),
    );
    expect(me.login).toBe("e2e-user");
  });
});

// manifest（アイコン長押しメニューのショートカット）の回帰防止。
// P1（stateless-architecture.md §7）でユーザーごとの動的差し替えをやめ、静的な汎用プリセット 3 件へ戻した。
// SW の precache が manifest を横取りしない仕組み（stripManifestFromSwPrecache）は、manifest 更新が
// 即座に反映されるようにするため引き続き維持する。
test.describe("manifest（アイコン長押しメニュー）", () => {
  test("ビルド成果物: SW の precache に manifest を含めず、manifest link に Cookie 送信を要求しない", () => {
    // 生成 SW の precache から manifest.webmanifest が除外されている（stripManifestFromSwPrecache）。
    const sw = readFileSync(resolve(process.cwd(), "dist/client/sw.js"), "utf8");
    const precache = sw.match(/precacheAndRoute\((\[[\s\S]*?\])/);
    expect(precache, "sw.js に precacheAndRoute が見つからない").not.toBeNull();
    expect(precache![1]).not.toContain("manifest.webmanifest");
    // 他のエントリ（index.html 等）は precache されたままであること（除外が過剰でない）。
    expect(precache![1]).toContain("index.html");

    // manifest はユーザーを識別しない静的アセットになったため、取得時に Cookie を送る必要がない。
    const html = readFileSync(resolve(process.cwd(), "dist/client/index.html"), "utf8");
    const link = html.match(/<link[^>]*rel="manifest"[^>]*>/);
    expect(link, "index.html に manifest link が見つからない").not.toBeNull();
    expect(link![0]).not.toContain("use-credentials");
  });

  test("SW 制御下でも /manifest.webmanifest が静的な汎用プリセットを返す", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    // SW がページを制御する状態を確立する（この状態で manifest 取得が SW を経由する）。
    await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    const shortcutNames = await page.evaluate(async () => {
      const res = await fetch("/manifest.webmanifest", { credentials: "same-origin" });
      const manifest = (await res.json()) as { shortcuts?: { name: string }[] };
      return (manifest.shortcuts ?? []).map((s) => s.name);
    });
    // ログイン済みでも内容は変わらない（サーバーはユーザーの設定を持たない）。
    expect(shortcutNames).toContain("改善案を起票");
  });
});
