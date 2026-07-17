import { test, expect } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// B1-2 の URL パラメータ起動 E2E（モック GitHub・モバイルエミュレーション）。
// カバー範囲: `/new?repo=&labels=&title=` で開くとリポジトリ/ラベル/タイトルが初期選択済みで
// 表示され、自動送信されないこと（FR-19）。および未ログイン時にログイン → コールバック復帰後も
// 同じプレフィルが復元されること（FR-15「未ログイン時はログイン後に復元」）。
test.describe("URL パラメータ起動（モック GitHub・モバイルエミュレーション）", () => {
  test.beforeEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [
              { id: 1, full_name: "kai-kou/alpha", private: false, permissions: { push: true } },
              { id: 2, full_name: "kai-kou/beta", private: false, permissions: { push: true } },
            ],
          },
        ],
        labels: [
          { name: "bug", color: "d73a4a" },
          { name: "enhancement", color: "a2eeef" },
        ],
      },
    });
  });

  test.afterEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [], labels: [] } });
  });

  test("ログイン済みで開くと各項目が初期選択済みで表示され、送信操作をするまで自動送信されない", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.goto(
      "/new?repo=kai-kou%2Falpha&labels=bug&title=%E3%83%97%E3%83%AC%E3%83%95%E3%82%A3%E3%83%AB%E8%B5%B7%E7%A5%A8",
    );

    // リポジトリが初期選択済み → フォームが表示される
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("プレフィル起票");

    // ラベルは事前指定があると展開済みで表示され、チェック済みになっている
    const bugCheckbox = page.getByRole("checkbox", { name: "bug" });
    await expect(bugCheckbox).toBeVisible();
    await expect(bugCheckbox).toBeChecked();

    // 自動送信はされない（ユーザーの送信操作が必須・FR-19）
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toHaveCount(0);

    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();

    const lastIssue = await (await page.request.get(`${MOCK_GITHUB_URL}/mock/last-issue`)).json();
    expect(lastIssue.title).toBe("プレフィル起票");
    expect(lastIssue.labels).toEqual(["bug"]);
  });

  test("未ログインで開いてログインすると、コールバック復帰後も同じプレフィルが復元される", async ({ page }) => {
    await page.goto(
      "/new?repo=kai-kou%2Falpha&title=%E6%9C%AA%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3%E3%83%97%E3%83%AC%E3%83%95%E3%82%A3%E3%83%AB",
    );
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();

    await expect(page.getByText(/e2e-user/)).toBeVisible();
    await expect(page).toHaveURL(/\/new\?/);
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("未ログインプレフィル");
  });

  test("プレフィル後に別リポジトリへ手動で切り替えると、プレフィルは引き継がれない", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.goto(
      "/new?repo=kai-kou%2Falpha&labels=bug&title=%E3%83%97%E3%83%AC%E3%83%95%E3%82%A3%E3%83%AB%E8%B5%B7%E7%A5%A8",
    );
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("プレフィル起票");

    // プレフィル対象外の別リポジトリへ手動で切り替える
    await page.getByRole("button", { name: "kai-kou/beta" }).click();

    // 切り替え後のフォームはプレフィルを引き継がず空のまま
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("");
    await page.getByText(/ラベルを追加|Add labels/).click();
    await expect(page.getByRole("checkbox", { name: "bug" })).not.toBeChecked();
  });

  test("URL のラベルがリポジトリに実在しない場合、送信内容から自動的に除外される", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.goto(
      "/new?repo=kai-kou%2Falpha&labels=not-a-real-label&title=%E5%AD%98%E5%9C%A8%E3%81%97%E3%81%AA%E3%81%84%E3%83%A9%E3%83%99%E3%83%AB",
    );
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("存在しないラベル");

    // 実在しないラベル名はラベル一覧取得後に自動的に選択解除され、送信リクエストに含まれない
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();

    // labels が空になったリクエストは labels フィールド自体を省略する（worker/github.ts createIssue）。
    const lastIssue = await (await page.request.get(`${MOCK_GITHUB_URL}/mock/last-issue`)).json();
    expect(lastIssue.labels).toBeUndefined();
  });
});
