import { test, expect } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// B2-1/B2-2 のリポジトリ検索/選択 E2E（モック GitHub・モバイルエミュレーション）。
// カバー範囲: ログイン後、GET /api/repos で取得したリポジトリの検索(インクリメンタル絞り込み)・選択、
// および選択したリポジトリが最近使用として次回起動時（reload）に先頭表示されること（FR-13）。
// GitHub への実起票（#24/#25 未実装）は対象外。
test.describe("リポジトリ検索/選択（モック GitHub・モバイルエミュレーション）", () => {
  test.beforeEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [
              { id: 1, full_name: "kai-kou/alpha", private: false },
              { id: 2, full_name: "kai-kou/beta", private: true },
              { id: 3, full_name: "acme/gamma", private: false },
            ],
          },
        ],
      },
    });
  });

  test.afterEach(async ({ request }) => {
    // A2-1 の既定シナリオ（installations 0 件）に戻し、他の spec への影響を防ぐ。
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [] } });
  });

  test("ログイン後にリポジトリを検索・選択でき、最近使用が次回起動時に先頭表示される", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    // installed のため InstallGuidance ではなく RepoPicker が表示される
    const search = page.getByRole("textbox");
    await expect(search).toBeVisible();
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toBeVisible();
    await expect(page.getByRole("button", { name: "kai-kou/beta" })).toBeVisible();
    await expect(page.getByRole("button", { name: "acme/gamma" })).toBeVisible();

    // インクリメンタル検索で絞り込まれる
    await search.fill("beta");
    await expect(page.getByRole("button", { name: "kai-kou/beta" })).toBeVisible();
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toHaveCount(0);

    await search.fill("");
    await page.getByRole("button", { name: "kai-kou/beta" }).click();

    // 次回起動（reload）でも最近使用（kai-kou/beta）が先頭に表示される
    await page.reload();
    const firstRepoButton = page.getByRole("listitem").first().getByRole("button");
    await expect(firstRepoButton).toHaveText("kai-kou/beta");
  });
});
