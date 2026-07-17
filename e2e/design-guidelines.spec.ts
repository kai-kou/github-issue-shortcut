import { test, expect, type Locator, type Page } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// デザインガイドライン（一次情報検証済み数値基準）の機械チェック。
// - タップターゲット: WCAG 2.2 SC 2.5.8 AA の最低ライン 24x24 CSS px（全インタラクティブ要素）。
//   主要操作（送信ボタン）は Apple HIG 推奨の 44px を満たすこと。
// - フォームコントロールの computed font-size は 16px 以上（iOS Safari の自動ズーム防止）。
// - ダークモード（prefers-color-scheme: dark）でページが白背景に黒文字のまま崩れないこと
//   （color-scheme: light dark が効いていること）。
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

/** ログイン → リポジトリ選択を経て、起票フォーム画面まで遷移する（既存 spec と同じ流儀）。 */
async function gotoIssueFormScreen(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
  await expect(page.getByText(/e2e-user/)).toBeVisible();

  await page.getByRole("button", { name: "kai-kou/alpha" }).click();
  await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toBeVisible();
}

/** 起票フォーム画面上の可視インタラクティブ要素（button/a/input/select/textarea/role=button）を返す。 */
async function visibleInteractiveElements(page: Page): Promise<Locator[]> {
  const all = await page.locator('button, a, input, select, textarea, [role="button"]').all();
  const visible: Locator[] = [];
  for (const el of all) {
    if (await el.isVisible()) visible.push(el);
  }
  return visible;
}

test.describe("デザインガイドライン: タップターゲット / フォント（モック GitHub・モバイルエミュレーション）", () => {
  test.beforeEach(async ({ request }) => {
    await configureMockRepo(request);
  });

  test.afterEach(async ({ request }) => {
    await resetMockRepo(request);
  });

  // 注: button/input/select/textarea は src/index.css の min-height: 44px により height 軸は恒真。
  // このテストが実質検出するのは全要素の width と、a / [role="button"] の height の退行。
  test("全インタラクティブ要素が24x24px以上（WCAG 2.2 SC 2.5.8 AA最低ライン）", async ({ page }) => {
    await gotoIssueFormScreen(page);

    const elements = await visibleInteractiveElements(page);
    expect(elements.length).toBeGreaterThan(0);

    const undersized: string[] = [];
    for (const el of elements) {
      const box = await el.boundingBox();
      if (!box) continue;
      if (box.width < 24 || box.height < 24) {
        const outerHtml = await el.evaluate((node) => node.outerHTML.slice(0, 120));
        undersized.push(`${outerHtml} -> ${box.width.toFixed(1)}x${box.height.toFixed(1)}`);
      }
    }
    expect(undersized, `24x24px 未満のタップターゲットが見つかった:\n${undersized.join("\n")}`).toEqual([]);
  });

  test("送信ボタンは48px以上（M3 の主要操作サイズ・design-guidelines.md D-4）", async ({ page }) => {
    await gotoIssueFormScreen(page);

    const submit = page.getByRole("button", { name: /Issue を作成|Create issue/ });
    await expect(submit).toBeVisible();
    const box = await submit.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(48);
    expect(box!.height).toBeGreaterThanOrEqual(48);
  });

  test("フォームコントロール（input/textarea）の computed font-size は16px以上（iOS自動ズーム防止）", async ({
    page,
  }) => {
    await gotoIssueFormScreen(page);

    // checkbox/radio はネイティブ描画でフォントサイズ規準の対象外（src/index.css の除外セレクタと揃える）。
    const controls = page.locator('input:not([type="checkbox"]):not([type="radio"]), textarea');
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);

    const undersized: string[] = [];
    for (let i = 0; i < count; i++) {
      const el = controls.nth(i);
      if (!(await el.isVisible())) continue;
      const fontSize = await el.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
      if (fontSize < 16) {
        const outerHtml = await el.evaluate((node) => node.outerHTML.slice(0, 120));
        undersized.push(`${outerHtml} -> ${fontSize}px`);
      }
    }
    expect(undersized, `font-size 16px 未満のフォームコントロールが見つかった:\n${undersized.join("\n")}`).toEqual(
      [],
    );
  });
});

test.describe("デザインガイドライン: ダークモード smoke", () => {
  test.use({ colorScheme: "dark" });

  test.beforeEach(async ({ request }) => {
    await configureMockRepo(request);
  });

  test.afterEach(async ({ request }) => {
    await resetMockRepo(request);
  });

  test("ダークモードでも起票フォームが表示され、白背景に黒文字のまま崩れない", async ({ page }) => {
    await gotoIssueFormScreen(page);

    // color-scheme: light dark が効いていること（ブラウザの既定ダークテーマ描画が有効になる前提）。
    const colorScheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
    expect(colorScheme).toContain("dark");

    // ブラウザが prefers-color-scheme: dark を認識できていること（test.use の colorScheme 反映確認）。
    const prefersDark = await page.evaluate(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
    expect(prefersDark).toBe(true);

    // body に明示的な白背景が指定されていないこと（指定されていれば dark canvas 描画を上書きし、
    // 白背景に黒文字のまま崩れる回帰が起こる）。
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBg).toBe("rgba(0, 0, 0, 0)");

    // フォームが実際に表示され、ダークモードでもレイアウトが崩れず操作可能であること。
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /本文|^Body/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Issue を作成|Create issue/ })).toBeVisible();
  });
});
