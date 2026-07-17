import { test, expect } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// B5-1 の下書き保全 E2E（モック GitHub・モバイルエミュレーション）。
// カバー範囲: 送信失敗（サーバーエラー・422）時に入力内容が端末（localStorage）へ下書き保存され、
// reload 後もリポジトリ選択・タイトル・本文が復元されること。成功後は reload しても下書きが残って
// いない（起票画面が初期状態＝リポジトリ未選択）に戻ること。ネットワーク到達不能（オフライン）時の
// キュー保存・自動再送は e2e/offline-queue.spec.ts（B4-2）が別途カバーする。
test.describe("起票フォームの下書き保全（モック GitHub・モバイルエミュレーション）", () => {
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

  test("送信失敗時に下書きが残り reload 後も復元され、成功後は下書きがクリアされる", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    // モック GitHub のマジック文字列（422）でサーバーエラーによる送信失敗を再現する。
    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("__mock_422__");
    await page.getByRole("textbox", { name: /本文|^Body/ }).fill("再現手順のメモ");
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/内容を見直してから|review the content/)).toBeVisible();

    // 失敗直後: 入力内容は画面上に残ったまま
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("__mock_422__");

    // reload しても下書き（選択リポジトリ + タイトル + 本文）が端末から復元される
    await page.reload();
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("__mock_422__");
    await expect(page.getByRole("textbox", { name: /本文|^Body/ })).toHaveValue("再現手順のメモ");

    // 内容を修正して再送信すると成功し、下書きがクリアされる
    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("バグ報告");
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveCount(0);
  });
});
