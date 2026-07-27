import { test, expect } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// 二重送信防止 E2E（FR-24・P3 でサーバーの issue_log から端末内 localStorage へ移設）。
// カバー範囲: 同一内容を短時間に送り直しても GitHub には 1 件しか作られないこと、
// 内容が違えば連続起票は妨げられないこと。判定の境界条件は submitGuard.test.ts（純関数）が担う。
test.describe("二重送信防止（モック GitHub・モバイルエミュレーション）", () => {
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

  async function login(page: import("@playwright/test").Page) {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();
  }

  /** 起票シートを開いて（既に開いていれば `openSheet: false`）タイトルだけの起票を送る。 */
  async function submitIssue(
    page: import("@playwright/test").Page,
    title: string,
    { openSheet = true }: { openSheet?: boolean } = {},
  ) {
    if (openSheet) await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill(title);
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
  }

  test("同一内容の送り直しは端末内で弾かれ、GitHub には 1 件しか作られない", async ({ page, request }) => {
    await login(page);
    await submitIssue(page, "同じ内容の起票");
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();

    // リロードで画面状態を作り直しても（＝アプリのメモリ上の送信履歴が消えても）、端末内の記録で
    // 直前の送信を検知できること。サーバーには照合用の記録が残らないため、ここが唯一の防波堤になる。
    await page.reload();
    await submitIssue(page, "同じ内容の起票");

    await expect(page.getByText(/直前に送信済み|already submitted/)).toBeVisible();
    const created = await (await request.get(`${MOCK_GITHUB_URL}/mock/issue-count`)).json();
    expect(created, "二重送信は GitHub まで到達しない").toEqual({ count: 1 });
  });

  test("内容が違えば連続して起票できる（過剰にブロックしない）", async ({ page, request }) => {
    await login(page);
    await submitIssue(page, "1 件目");
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();

    // 成功後は起票シートが開いたまま連続起票できる（フォームだけが初期化される）。
    await submitIssue(page, "2 件目", { openSheet: false });
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();

    const created = await (await request.get(`${MOCK_GITHUB_URL}/mock/issue-count`)).json();
    expect(created).toEqual({ count: 2 });
  });
});
