import { test, expect } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// B3-1/B4-1 の起票フォーム E2E（モック GitHub・モバイルエミュレーション）。
// カバー範囲: リポジトリ選択後にフォームが表示され、タイトルのみで送信可能・タイトル空では送信不可であること、
// および送信すると GitHub（モック）に Issue が作成され、作成結果（番号・リンク）が表示されること。
test.describe("起票フォーム（モック GitHub・モバイルエミュレーション）", () => {
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

  test("タイトルのみで送信可能・タイトル空では送信不可", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.getByRole("button", { name: "kai-kou/alpha" }).click();

    const submit = page.getByRole("button", { name: /Issue を作成|Create issue/ });
    const title = page.getByRole("textbox", { name: /タイトル|^Title$/ });

    await expect(submit).toBeDisabled();

    await title.fill("バグ報告");
    await expect(submit).toBeEnabled();

    await title.fill("");
    await expect(submit).toBeDisabled();
  });

  test("タイトルのみで送信すると GitHub 上に Issue が作成され結果が表示される", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("バグ報告");
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();

    const issueLink = page.getByRole("link", { name: /GitHub で開く|Open on GitHub/ });
    await expect(issueLink).toBeVisible();
    await expect(issueLink).toHaveAttribute("href", /^https:\/\/github\.com\/kai-kou\/alpha\/issues\/\d+$/);
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();
  });
});
