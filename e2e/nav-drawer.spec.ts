import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Locator, type Page } from "@playwright/test";

// サイドパネル（NavDrawer・左ナビゲーションドロワー）固有の挙動を担保する E2E（PR #113 レビュー由来）。
// セレクタは strict-mode 衝突（ユーザー名・ログインリンクがトップバー/ドロワーに二重出現）を避けるため、
// ドロワー内要素は必ず getByRole("dialog") スコープ経由で探す。

const MOCK_GITHUB_URL = "http://localhost:8788";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];

async function configureMockRepo(request: import("@playwright/test").APIRequestContext) {
  await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
    data: { installations: [{ id: 1001, repos: [{ id: 1, full_name: "kai-kou/alpha", private: false }] }] },
  });
}
async function resetMockRepo(request: import("@playwright/test").APIRequestContext) {
  await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [] } });
}

/** トップバー左のハンバーガー（ドロワーを開く主トリガー）。アカウントチップも同名 aria-label のため .first() ではなく用途で使い分ける。 */
const hamburger = (page: Page): Locator => page.getByRole("button", { name: /メニューを開く|Open menu/ }).first();
/** ドロワー本体（aria-label=メニュー/Menu）。RepoPicker の起票シート dialog と名前で区別する。 */
const drawer = (page: Page): Locator => page.getByRole("dialog", { name: /メニュー|Menu/ });

async function login(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
  await expect(page.getByText(/e2e-user/)).toBeVisible();
}

test.describe("サイドパネル: 開閉トリガー", () => {
  test("ハンバーガーでドロワーが開く", async ({ page }) => {
    await page.goto("/");
    await hamburger(page).click();
    await expect(drawer(page)).toBeVisible();
  });

  test("アカウントチップでもドロワーが開く（ログイン中）", async ({ page }) => {
    await login(page);
    await page.locator(".account-chip").click();
    await expect(drawer(page)).toBeVisible();
    // ドロワー内スコープでログアウトが見える（トップバー側にログアウトは存在しない）
    await expect(drawer(page).getByRole("button", { name: /ログアウト|Sign out/ })).toBeVisible();
  });
});

test.describe("サイドパネル: 3 経路の閉じ + フォーカス復帰（a11y#1 / correctness#3 の回帰ガード）", () => {
  test("Escape で閉じ、フォーカスがハンバーガーへ戻る", async ({ page }) => {
    await page.goto("/");
    await hamburger(page).click();
    await expect(drawer(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();
    await expect(hamburger(page)).toBeFocused();
  });

  test("×ボタンで閉じ、フォーカスがハンバーガーへ戻る", async ({ page }) => {
    await page.goto("/");
    await hamburger(page).click();
    await drawer(page).getByRole("button", { name: /メニューを閉じる|Close menu/ }).click();
    await expect(drawer(page)).toBeHidden();
    await expect(hamburger(page)).toBeFocused();
  });

  test("backdrop クリックで閉じ、フォーカスがハンバーガーへ戻る", async ({ page }) => {
    await page.goto("/");
    await hamburger(page).click();
    await expect(drawer(page)).toBeVisible();
    // ドロワー(幅 min(84vw,320px))の右側の暗転領域を viewport 座標でクリックする（内側 {2,2} は backdrop ではない）。
    const vp = page.viewportSize();
    await page.mouse.click((vp?.width ?? 412) - 15, Math.floor((vp?.height ?? 900) / 2));
    await expect(drawer(page)).toBeHidden();
    await expect(hamburger(page)).toBeFocused();
  });
});

test.describe("サイドパネル: ナビゲーション導線", () => {
  test("ショートカット作成ヘルパーへ遷移する", async ({ page }) => {
    await page.goto("/");
    await hamburger(page).click();
    await drawer(page).getByRole("link", { name: /ショートカットを作成・管理|Create & manage shortcuts/ }).click();
    await expect(page).toHaveURL(/\/shortcuts$/);
  });

  test("利用規約・プライバシーへ遷移する", async ({ page }) => {
    await page.goto("/");
    await hamburger(page).click();
    await drawer(page).getByRole("link", { name: /利用規約|Terms of Service/ }).click();
    await expect(page).toHaveURL(/\/terms$/);

    await page.goto("/");
    await hamburger(page).click();
    await drawer(page).getByRole("link", { name: /プライバシーポリシー|Privacy Policy/ }).click();
    await expect(page).toHaveURL(/\/privacy$/);
  });

  test("未ログイン時、ドロワー内にもログイン導線がある", async ({ page }) => {
    await page.goto("/");
    await hamburger(page).click();
    await expect(drawer(page).getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ })).toBeVisible();
  });
});

test.describe("サイドパネル: メイン保持 + a11y", () => {
  test.beforeEach(async ({ request }) => {
    await configureMockRepo(request);
  });
  test.afterEach(async ({ request }) => {
    await resetMockRepo(request);
  });

  test("ドロワー開閉後もメインの起票フローが保持される", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toBeVisible();
    await hamburger(page).click();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toBeVisible();
  });

  test("ドロワーを開いた状態で WCAG 違反がない", async ({ page }) => {
    await login(page);
    await page.locator(".account-chip").click();
    await expect(drawer(page)).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test("ドロワーを開いた状態の全インタラクティブ要素が 24x24px 以上", async ({ page }) => {
    await login(page);
    await page.locator(".account-chip").click();
    await expect(drawer(page)).toBeVisible();
    const els = await page.locator('button, a, input, select, textarea, summary, [role="button"]').all();
    const undersized: string[] = [];
    for (const el of els) {
      if (!(await el.isVisible())) continue;
      const box = await el.boundingBox();
      if (!box) continue;
      if (box.width < 24 || box.height < 24) {
        undersized.push(`${await el.evaluate((n) => n.outerHTML.slice(0, 100))} -> ${box.width}x${box.height}`);
      }
    }
    expect(undersized, `24x24px 未満:\n${undersized.join("\n")}`).toEqual([]);
  });
});
