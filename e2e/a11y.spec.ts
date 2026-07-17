import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// axe-core による WCAG 準拠の自動検査（design-guidelines.md §5「後続導入」の消化）。
// `target-size`（WCAG 2.2 SC 2.5.8・axe-core 4.5 で追加）は既定無効のため wcag22aa タグを明示する
// （content/research/design-uiux-20260717_deep_research.md §7 の確定事項）。
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];

async function configureMockRepo(request: import("@playwright/test").APIRequestContext) {
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
}

async function resetMockRepo(request: import("@playwright/test").APIRequestContext) {
  await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [] } });
}

async function gotoIssueFormScreen(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
  await expect(page.getByText(/e2e-user/)).toBeVisible();

  await page.getByRole("button", { name: "kai-kou/alpha" }).click();
  await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toBeVisible();
}

test.describe("a11y: axe-core（wcag2a/wcag2aa/wcag22aa・モバイルエミュレーション）", () => {
  test.beforeEach(async ({ request }) => {
    await configureMockRepo(request);
  });

  test.afterEach(async ({ request }) => {
    await resetMockRepo(request);
  });

  test("ログイン前画面に WCAG 違反がない", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test("起票フォーム画面に WCAG 違反がない", async ({ page }) => {
    await gotoIssueFormScreen(page);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test("ショートカット作成ヘルパー画面に WCAG 違反がない（一覧表示された ShortcutRow を含む）", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();
    await page.goto("/shortcuts");
    await expect(page.getByRole("button", { name: /^保存$|^Save$/ })).toBeVisible();

    // 空の一覧だけでなく、レビュー指摘のとおり ShortcutRow（生成 URL の input・コピー/編集/削除
    // ボタン群）も検査対象に含める。過去にこの行の欠落で aria-label の欠如を見逃した経緯がある。
    await page.getByPlaceholder("bug,enhancement").fill("bug");
    await page.getByRole("button", { name: /^保存$|^Save$/ }).click();
    await expect(page.locator('.shortcut-row input[type="text"]')).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);

    // 後続テストへ D1 状態を残さない。
    await page.getByRole("button", { name: /削除|Delete/ }).click();
    await page.getByRole("button", { name: /削除|Delete/ }).click();
  });
});
