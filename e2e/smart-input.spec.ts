import { test, expect } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// B3-3 のスマート入力 E2E（モック GitHub・モバイルエミュレーション）。
// カバー範囲: タイトル欄の `@label` トークンのインライン認識・送信時のラベル反映とタイトルからの除去、
// タップによる解除、検索欄の `#repo` トークンによる絞り込み・選択時の残りテキストのタイトル引き継ぎ。
test.describe("スマート入力（モック GitHub・モバイルエミュレーション）", () => {
  test.afterEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [], labels: [] } });
  });

  test("タイトル欄の @label トークンは送信時にラベルへ反映され、タイトルからは除去される", async ({ page, request }) => {
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

    const title = page.getByRole("textbox", { name: /タイトル|^Title$/ });
    await title.fill("ログイン画面のバグを直す @bug 至急");

    // インライン認識されたトークンはタップ解除用チップとして表示される。
    const chip = page.getByRole("button", { name: /@bug/ });
    await expect(chip).toBeVisible();

    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();

    const lastIssue = await (await request.get(`${MOCK_GITHUB_URL}/mock/last-issue`)).json();
    expect(lastIssue.title).toBe("ログイン画面のバグを直す 至急");
    expect(lastIssue.labels).toEqual(["bug"]);
  });

  test("チップをタップするとトークンとラベル指定の両方が解除される", async ({ page, request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [{ id: 1, full_name: "kai-kou/alpha", private: false, permissions: { push: true } }],
          },
        ],
        labels: [{ name: "bug", color: "d73a4a" }],
      },
    });

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();
    await page.getByRole("button", { name: "kai-kou/alpha" }).click();

    const title = page.getByRole("textbox", { name: /タイトル|^Title$/ });
    await title.fill("@bug 修正");

    const chip = page.getByRole("button", { name: /@bug/ });
    await expect(chip).toBeVisible();
    await chip.click();

    await expect(chip).toHaveCount(0);
    await expect(title).toHaveValue("修正");

    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();

    // 空配列の labels は GitHub への送信時に省略される（既存仕様・worker/github.ts createIssue）。
    const lastIssue = await (await request.get(`${MOCK_GITHUB_URL}/mock/last-issue`)).json();
    expect(lastIssue.labels).toBeUndefined();
  });

  test("同じラベルを指す複数トークン（大文字小文字違い）でも、ラベルは重複せず1回だけ反映される", async ({
    page,
    request,
  }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [{ id: 1, full_name: "kai-kou/alpha", private: false, permissions: { push: true } }],
          },
        ],
        labels: [{ name: "bug", color: "d73a4a" }],
      },
    });

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();
    await page.getByRole("button", { name: "kai-kou/alpha" }).click();

    const title = page.getByRole("textbox", { name: /タイトル|^Title$/ });
    await title.fill("@Bug 直す @bug 至急");

    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();

    const lastIssue = await (await request.get(`${MOCK_GITHUB_URL}/mock/last-issue`)).json();
    expect(lastIssue.labels).toEqual(["bug"]);
  });

  test("LabelPicker でチェックを外すと、対応する @label トークンもタイトルから取り除かれ再送信でも復活しない", async ({
    page,
    request,
  }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [{ id: 1, full_name: "kai-kou/alpha", private: false, permissions: { push: true } }],
          },
        ],
        labels: [{ name: "bug", color: "d73a4a" }],
      },
    });

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();
    await page.getByRole("button", { name: "kai-kou/alpha" }).click();

    const title = page.getByRole("textbox", { name: /タイトル|^Title$/ });
    await title.fill("@bug 至急");

    const bugCheckbox = page.getByRole("checkbox", { name: "bug" });
    await page.getByText(/ラベルを追加|Add labels/).click();
    await expect(bugCheckbox).toBeChecked();
    await bugCheckbox.uncheck();

    // チェック解除と同時にタイトル側のトークンも消え、チップも消える。
    await expect(title).toHaveValue("至急");
    await expect(page.getByRole("button", { name: /@bug/ })).toHaveCount(0);

    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();

    const lastIssue = await (await request.get(`${MOCK_GITHUB_URL}/mock/last-issue`)).json();
    expect(lastIssue.labels).toBeUndefined();
  });

  test("検索欄の #repo トークンは一覧を絞り込み、選択時に残りの自由文をタイトルへ引き継ぐ", async ({
    page,
    request,
  }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [
              { id: 1, full_name: "kai-kou/alpha", private: false },
              { id: 2, full_name: "kai-kou/beta", private: false },
            ],
          },
        ],
      },
    });

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    const search = page.getByRole("textbox", { name: /リポジトリを検索|Search repositories/ });
    await search.fill("バグ修正 #alpha");

    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toBeVisible();
    await expect(page.getByRole("button", { name: "kai-kou/beta" })).toHaveCount(0);

    const chip = page.getByRole("button", { name: /#alpha/ });
    await expect(chip).toBeVisible();

    await page.getByRole("button", { name: "kai-kou/alpha" }).click();

    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("バグ修正");
  });

  test("検索欄のチップをタップするとトークンが解除され一覧が元に戻る", async ({ page, request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [
              { id: 1, full_name: "kai-kou/alpha", private: false },
              { id: 2, full_name: "kai-kou/beta", private: false },
            ],
          },
        ],
      },
    });

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    const search = page.getByRole("textbox", { name: /リポジトリを検索|Search repositories/ });
    await search.fill("#alpha");

    const chip = page.getByRole("button", { name: /#alpha/ });
    await expect(chip).toBeVisible();
    await chip.click();

    await expect(chip).toHaveCount(0);
    await expect(search).toHaveValue("");
    await expect(page.getByRole("button", { name: "kai-kou/beta" })).toBeVisible();
  });
});
