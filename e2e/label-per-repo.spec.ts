import { test, expect } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// ユーザー報告バグの決定的再現 E2E:
// 「ホーム画面でリポジトリを選択→シートが開く」を alpha・beta で繰り返したとき、
// リポジトリごとに異なるラベル一覧が正しく出し分けられるか（別リポジトリを選んでも
// 同じラベルのまま更新されない、という報告の真偽判定）。
// mock-github.mjs の labelsByRepo（本タスクで追加）により、repo ごとに異なるラベルを返せる。
test.describe("リポジトリ別ラベル出し分け（ユーザー報告バグの再現・モック GitHub）", () => {
  test.afterEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: { installations: [], labels: [], labelsByRepo: {} },
    });
  });

  test("alpha→beta の順でリポジトリを選び直すと、開くたびにそのリポジトリ固有のラベルだけが見える", async ({
    page,
    request,
  }) => {
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
        labelsByRepo: {
          "kai-kou/alpha": [
            { name: "alpha-only", color: "d73a4a" },
            { name: "common", color: "a2eeef" },
          ],
          "kai-kou/beta": [
            { name: "beta-only", color: "0e8a16" },
            { name: "common", color: "a2eeef" },
          ],
        },
      },
    });

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    // 1. alpha を選択 → シートが開く → ラベルを開くと alpha-only が見え beta-only は見えない。
    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    await expect(page.getByText(/ラベルを追加|Add labels/)).toBeVisible();
    await page.getByText(/ラベルを追加|Add labels/).click();
    await expect(page.getByRole("checkbox", { name: "alpha-only" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "beta-only" })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "common" })).toBeVisible();

    // 2. シートを閉じてホームへ戻る。
    await page.getByRole("button", { name: /閉じる|Close/ }).click();

    // 3. beta を選び直す → 新しいシート・新しい IssueForm インスタンス（RepoPicker の
    //    key={`${selected}-${formKey}`} により repo 変更時は必ず remount する設計）。
    await page.getByRole("button", { name: "kai-kou/beta" }).click();
    await expect(page.getByText(/ラベルを追加|Add labels/)).toBeVisible();
    await page.getByText(/ラベルを追加|Add labels/).click();
    await expect(page.getByRole("checkbox", { name: "beta-only" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "alpha-only" })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "common" })).toBeVisible();
  });

  test("SWR キャッシュ経路: alpha を再訪しても直前に見たラベルのまま stale 表示され、revalidate 後も alpha のラベルを維持する", async ({
    page,
    request,
  }) => {
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
        labelsByRepo: {
          "kai-kou/alpha": [{ name: "alpha-only", color: "d73a4a" }],
          "kai-kou/beta": [{ name: "beta-only", color: "0e8a16" }],
        },
      },
    });

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    // 1回目: alpha を開き、ラベル一覧を取得させてローカルキャッシュへ保存させる（repoLabelsCache）。
    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    await page.getByText(/ラベルを追加|Add labels/).click();
    await expect(page.getByRole("checkbox", { name: "alpha-only" })).toBeVisible();
    await page.getByRole("button", { name: /閉じる|Close/ }).click();

    // beta を一度経由してから、再度 alpha に戻る（キャッシュ済み repo の再訪）。
    await page.getByRole("button", { name: "kai-kou/beta" }).click();
    await page.getByText(/ラベルを追加|Add labels/).click();
    await expect(page.getByRole("checkbox", { name: "beta-only" })).toBeVisible();
    await page.getByRole("button", { name: /閉じる|Close/ }).click();

    // 2回目の alpha 訪問: キャッシュ由来で即座に alpha-only が見え、beta-only は混入しない。
    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    await page.getByText(/ラベルを追加|Add labels/).click();
    await expect(page.getByRole("checkbox", { name: "alpha-only" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "beta-only" })).toHaveCount(0);
  });
});
