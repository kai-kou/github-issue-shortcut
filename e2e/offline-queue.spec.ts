import { test, expect } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// オフラインキュー E2E（B4-2・FR-22・FR-23）。
// カバー範囲: ネットワーク到達不能時に起票がキューへ積まれてキュー件数が表示され、
// オンライン復帰後に自動でクライアント主導の再送が行われ GitHub へ反映されること。
// 4xx（サーバーエラー）はキュー自動再送の対象外として扱われる（failed のまま残り、成功表示にならない）。
// Service Worker 側の Workbox Background Sync（ページを閉じていても再送）自体は物理デバイス相当の
// 検証が必要なためここでは対象外とし、フォアグラウンドでのクライアント主導再送経路を検証する。
test.describe("オフラインキュー（モック GitHub・モバイルエミュレーション）", () => {
  test.beforeEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [{ id: 1, full_name: "kai-kou/alpha", private: false }],
          },
        ],
      },
    });
  });

  test.afterEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [] } });
  });

  test("オフライン時にキュー表示され、オンライン復帰後に自動送信されて GitHub に反映される", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("オフラインで起票");

    // ネットワーク到達不能を再現する（fetch がネットワークエラーとして失敗する）。
    await page.route("**/api/issues", (route) => route.abort());
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();

    await expect(page.getByText(/オフラインです|You're offline/)).toBeVisible();
    // キュー件数（1 件）が起票先選択画面に表示される。
    await expect(page.getByText(/送信待ちのオフラインキュー|Pending offline queue/)).toBeVisible();

    // reload してもキューが端末（localStorage）から復元され、件数表示が残る。
    await page.reload();
    await expect(page.getByText(/送信待ちのオフラインキュー|Pending offline queue/)).toBeVisible();

    // オンライン復帰: ルートを解除し、online イベントを発火してクライアント主導の再送を促す。
    await page.unroute("**/api/issues");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    // 再送が成功し GitHub へ反映されると、キュー表示が消える。
    await expect(page.getByText(/送信待ちのオフラインキュー|Pending offline queue/)).toHaveCount(0, { timeout: 10_000 });
  });

  test("4xx はキュー自動再送の対象外として扱われる", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    // モック GitHub のマジック文字列（422）を使い、再送時にサーバーエラーになるケースを再現する。
    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("__mock_422__");

    await page.route("**/api/issues", (route) => route.abort());
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/オフラインです|You're offline/)).toBeVisible();

    // オンライン復帰。再送は行われるが 422 が返るため、自動再送は行われず失敗のままキューに残る
    // （手動での再送・破棄は D2-1・#22 のスコープ）。少なくとも成功表示にはならないことを確認する。
    await page.unroute("**/api/issues");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(3_000);
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toHaveCount(0);
  });
});
