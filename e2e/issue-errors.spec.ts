import { test, expect } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// B5-2/FR-9 のエラー表示 E2E（モック GitHub がタイトルのマジック文字列に応じて 401/403/422 を返す）。
// カバー範囲: GitHub API のエラー種別ごとに識別可能な文言が表示されること。422 は自動リトライしないこと
// （このアプリはそもそも自動リトライを行わないため、手動再試行を促す文言になっていることを確認する）。
test.describe("起票エラー表示（モック GitHub・B5-2/FR-9）", () => {
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

  test("401 はログイン誘導リンク付きの再ログイン案内を表示する", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("__mock_401__");
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();

    await expect(page.getByText(/ログインの有効期限が切れました|login has expired/)).toBeVisible();
    await expect(page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ })).toBeVisible();
  });

  test("403 レート制限は時間を置いて再試行する案内を表示する", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("__mock_403_rate_limit__");
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();

    await expect(page.getByText(/リクエストが多すぎます|Too many requests/)).toBeVisible();
  });

  test("アプリ側レート制限の 429（Retry-After 付き）も時間を置いて再試行する案内になる（PR-4）", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    // 429 は Workers Rate Limiting binding が上限超過時に返す（P3）。E2E の wrangler dev は
    // 緩い上限のバインディングを使う（全 spec が同一モックユーザーを共有するため）ので、
    // ここでは応答だけを再現して UI の分岐（FR-9）を確認する。サーバー側の上限判定そのものは
    // worker/issues.test.ts が実バインディングに対して検証している。
    await page.route("**/api/issues", (route) =>
      route.fulfill({
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "60" },
        body: JSON.stringify({ error: { code: "rate_limited", message: "too many issues submitted" } }),
      }),
    );

    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("レート制限の表示");
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();

    await expect(page.getByText(/リクエストが多すぎます|Too many requests/)).toBeVisible();
  });

  test("422 は内容の見直しを促す表示になる（盲目リトライ禁止）", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("__mock_422__");
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();

    await expect(page.getByText(/内容を見直してから|review the content/)).toBeVisible();
  });
});
