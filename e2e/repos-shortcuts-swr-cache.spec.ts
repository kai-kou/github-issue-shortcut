import { test, expect } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// #101 の SWR（stale-while-revalidate）キャッシュ E2E（モック GitHub・モバイルエミュレーション）。
// カバー範囲: 起動時に `/api/repos` の fetch が完了する前でも、直近訪問時に端末（localStorage）へ
// 保存したキャッシュから即座にリポジトリ一覧が表示され、「リポジトリを取得中」表示のまま
// 待たされないこと（FR 根本原因の解消）。ショートカットは P1 で localStorage が正本になったため、
// そもそもサーバーへ問い合わせないことを検証する。
// あわせて、裏側では revalidate（最新 fetch）が進み、差分があれば反映されること、および
// revalidate が失敗（オフライン等）してもキャッシュ表示のまま壊れないことも検証する。
test.describe("起動時の即時表示（SWR キャッシュ・モック GitHub・モバイルエミュレーション）", () => {
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

  test("2回目以降の起動は /api/repos の応答を待たずキャッシュ由来のリポジトリ一覧が即座に表示される", async ({
    page,
  }) => {
    // 1回目の訪問: 通常どおり fetch 完了後に一覧が表示され、この結果が端末にキャッシュされる。
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toBeVisible();

    // 2回目の訪問: /api/repos の応答を大幅に遅延させ、キャッシュ表示が fetch 完了を待たないことを示す。
    await page.route("**/api/repos", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });
    await page.reload();

    // fetch はまだ解決していない短い猶予内でも、キャッシュ由来で即座にボタンが見える。
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toBeVisible({ timeout: 800 });
    // 「リポジトリを取得中」のローディング文言には落ちない（キャッシュにより ready 初期化されるため）。
    await expect(page.getByText(/リポジトリを取得中|Loading repositories/)).toHaveCount(0);

    await page.unroute("**/api/repos");
  });

  test("revalidate の fetch が失敗してもキャッシュ表示のまま壊れない", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toBeVisible();

    // 2回目の訪問で /api/repos をネットワークエラーにする（オフライン相当）。
    await page.route("**/api/repos", (route) => route.abort());
    await page.reload();

    // revalidate 失敗後もキャッシュのリストが表示され続け、エラー表示に置き換わらない。
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toBeVisible();
    await expect(page.getByText(/リポジトリを取得できませんでした|Could not load repositories/)).toHaveCount(0);

    await page.unroute("**/api/repos");
  });

  test("裏側の revalidate が完了すると最新のリポジトリ一覧に差分反映される", async ({ page, request }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toBeVisible();
    await expect(page.getByRole("button", { name: "kai-kou/beta" })).toHaveCount(0);

    // モック GitHub 側のリポジトリを増やし（beta を追加）、revalidate 用の fetch を少し遅延させる。
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
      },
    });
    await page.route("**/api/repos", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });
    await page.reload();

    // 直後はキャッシュ（alpha のみ）がそのまま表示され、beta はまだ現れない。
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toBeVisible({ timeout: 800 });
    await expect(page.getByRole("button", { name: "kai-kou/beta" })).toHaveCount(0);

    // revalidate（遅延 fetch）が完了すると beta が追加表示される（SWR の背後更新）。
    await expect(page.getByRole("button", { name: "kai-kou/beta" })).toBeVisible({ timeout: 3000 });

    await page.unroute("**/api/repos");
  });

  test("ショートカット一覧はサーバーに問い合わせず端末内から即座に表示される（P1）", async ({ page }) => {
    // P1（stateless-architecture.md §3）でショートカットの正本を localStorage へ移した。
    // 起動時に /api/shortcuts を叩かない＝ネットワーク状態に関わらず即座に一覧が出ることを固める。
    const shortcutApiRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/shortcuts")) shortcutApiRequests.push(req.url());
    });

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.goto("/shortcuts");
    await page.getByPlaceholder(/日報|Daily note/).fill("ローカル保存チェック");
    await page.getByLabel(/リポジトリ（任意）|Repository \(optional\)/).selectOption("kai-kou/alpha");
    await page.getByRole("button", { name: /^保存$|^Save$/ }).click();
    await expect(page.getByText("ローカル保存チェック")).toBeVisible();

    // 再訪: fetch を待たずにクイック一覧が見える。
    await page.goto("/");
    await expect(page.getByRole("link", { name: /ローカル保存チェック/ })).toBeVisible({ timeout: 800 });
    await page.reload();
    await expect(page.getByRole("link", { name: /ローカル保存チェック/ })).toBeVisible({ timeout: 800 });

    // ショートカット用のサーバー API は存在しない（呼ばれていないことを機械検証する）。
    expect(shortcutApiRequests).toEqual([]);
  });
});
