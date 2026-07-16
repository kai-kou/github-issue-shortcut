import { test, expect } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// B3-2 のラベル選択 E2E（モック GitHub・モバイルエミュレーション）。
// カバー範囲: ラベル UI が既定で畳まれていること、push 権限のあるリポジトリでは開くとラベル一覧が
// 取得され複数選択でき、選択したラベルが起票リクエストに含まれること（B3-2）。push 権限のない
// リポジトリでは選択 UI の代わりに警告が表示されること（B5-3・FR-14・silently dropped の事前周知）。
test.describe("ラベル選択（モック GitHub・モバイルエミュレーション）", () => {
  test.afterEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [], labels: [] } });
  });

  test("push 権限のあるリポジトリではラベルを複数選択でき、起票リクエストに反映される", async ({ page, request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [{ id: 1, full_name: "kai-kou/alpha", private: false, permissions: { push: true } }],
          },
        ],
        labels: [
          { name: "bug", color: "d73a4a" },
          { name: "enhancement", color: "a2eeef" },
        ],
      },
    });

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();
    await page.getByRole("button", { name: "kai-kou/alpha" }).click();

    // 既定で畳まれている（開く前はチェックボックスが見えない）。
    const bugCheckbox = page.getByRole("checkbox", { name: "bug" });
    await expect(bugCheckbox).toHaveCount(0);

    await page.getByText(/ラベルを追加|Add labels/).click();
    await expect(bugCheckbox).toBeVisible();
    await bugCheckbox.check();

    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("バグ報告");
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();

    const lastIssue = await (await request.get(`${MOCK_GITHUB_URL}/mock/last-issue`)).json();
    expect(lastIssue.labels).toEqual(["bug"]);
  });

  test("push 権限のないリポジトリではラベル選択の代わりに警告が表示される", async ({ page, request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [{ id: 2, full_name: "kai-kou/readonly", private: true, permissions: { push: false } }],
          },
        ],
        labels: [{ name: "bug", color: "d73a4a" }],
      },
    });

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();
    await page.getByRole("button", { name: "kai-kou/readonly" }).click();

    await page.getByText(/ラベルを追加|Add labels/).click();
    await expect(page.getByText(/push 権限がないため|don't have push access/)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "bug" })).toHaveCount(0);
  });
});
