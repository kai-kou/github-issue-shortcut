import { test, expect } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// C1-1/C2-2 ショートカット作成ヘルパーの E2E（モック GitHub・モバイルエミュレーション）。
// カバー範囲: 未ログイン時のログイン誘導、ログイン後のプリセット作成・URL 生成・一覧表示・
// 編集・削除（サーバー保存の CRUD が /shortcuts 画面から一通り動くこと）。
test.describe("ショートカット作成ヘルパー（モック GitHub・モバイルエミュレーション）", () => {
  test.beforeEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [{ id: 1, full_name: "kai-kou/alpha", private: false, permissions: { push: true } }],
          },
        ],
      },
    });
  });

  test.afterEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [] } });
  });

  test("未ログイン時はログイン誘導のみが表示される", async ({ page }) => {
    await page.goto("/shortcuts");
    await expect(page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /保存|Save/ })).toHaveCount(0);
  });

  test("ログイン後にプリセットを作成すると起動 URL 付きで一覧に表示され、編集・削除できる", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.goto("/shortcuts");
    await page.getByLabel(/リポジトリ（任意）|Repository \(optional\)/).selectOption("kai-kou/alpha");
    await page.getByPlaceholder("bug,enhancement").fill("bug,P1");
    await page.getByPlaceholder(/バグ報告|Bug report/).fill("バグ報告: ");
    await page.getByRole("button", { name: /^保存$|^Save$/ }).click();

    const generatedUrl = page.locator('.shortcut-row input[type="text"]');
    await expect(generatedUrl).toHaveValue(/\/new\?repo=kai-kou%2Falpha&labels=bug%2CP1&title=/);

    // 編集: ラベルを変更すると URL に反映される
    await page.getByRole("button", { name: /編集|Edit/ }).click();
    await page.getByPlaceholder("bug,enhancement").fill("enhancement");
    await page.getByRole("button", { name: /^保存$|^Save$/ }).click();
    await expect(generatedUrl).toHaveValue(/labels=enhancement/);

    // 削除: 確認 → 一覧から消える
    await page.getByRole("button", { name: /削除|Delete/ }).click();
    await page.getByRole("button", { name: /削除|Delete/ }).click();
    await expect(page.getByText(/まだショートカットがありません|No shortcuts yet/)).toBeVisible();
  });
});
