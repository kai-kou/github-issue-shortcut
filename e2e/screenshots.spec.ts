import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// README 掲載用スクリーンショットの撮影スクリプト（Issue #188）。
// 実機 Android は使えないため、既存 E2E インフラ（Playwright + Chromium・モック GitHub・
// playwright.config.ts の Pixel 7 デバイス記述子）を流用し、実コード（ブラウザ ↔ Worker）を
// 通してモック認証でログイン後の画面まで到達してから撮る。デバイスフレーム合成は行わない。
//
// 実行: npm run screenshots（= npm run build && playwright test e2e/screenshots.spec.ts）
// 出力: docs/assets/screenshots/*.png（1 枚あたり目安 300KB 以内。超える場合は deviceScaleFactor を
// 下げる・PNG を圧縮するなどで調整する）。
//
// README 側は本 PR の対象外（オーケストレーターが別途書く）。ここでは画像の生成だけを担う。
const MOCK_GITHUB_URL = "http://localhost:8788";
const OUT_DIR = "docs/assets/screenshots";

// README 訪問者向けの見せ方を意識し、モバイル実機に近い解像度で撮る。
// devices["Pixel 7"] は deviceScaleFactor:2.625・viewport 412x915 だが、PNG 容量を抑えるため
// このスペックでは軽量な 390x844 @2x（iPhone 12/13 相当の論理サイズ）に上書きする。
test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "ja-JP",
});

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

async function login(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
  await expect(page.getByText(/e2e-user/)).toBeVisible();
}

test.describe("README 掲載用スクリーンショット（モック GitHub・モバイル解像度）", () => {
  test.afterEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [], labels: [] } });
  });

  test("login: 未ログイン時のトップ画面（アプリの入口）", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ })).toBeVisible();
    // フォント読み込み・初回描画の揺れを避けるため一呼吸置く。
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT_DIR}/login.png` });
  });

  test("issue-form: リポジトリ選択済み・タイトル入力済み・ラベル選択済みの起票フォーム", async ({ page, request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [{ id: 1, full_name: "kai-kou/sample-app", private: false, permissions: { push: true } }],
          },
        ],
        labels: [
          { name: "bug", color: "d73a4a" },
          { name: "P1", color: "0e8a16" },
        ],
      },
    });

    await login(page);
    await page.getByRole("button", { name: "kai-kou/sample-app" }).click();

    const title = page.getByRole("textbox", { name: /タイトル|^Title$/ });
    await expect(title).toBeVisible();
    await title.fill("ログイン画面が真っ白になる");

    await page.getByText(/ラベルを追加|Add labels/).click();
    await page.getByRole("checkbox", { name: "bug" }).check();
    await page.getByRole("checkbox", { name: "P1" }).check();

    await expect(page.getByRole("button", { name: /Issue を作成|Create issue/ })).toBeEnabled();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT_DIR}/issue-form.png` });
  });

  test("smart-input: タイトル欄の @ 入力でラベル候補がインライン表示される（速さが伝わる画面）", async ({
    page,
    request,
  }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [{ id: 1, full_name: "kai-kou/sample-app", private: false, permissions: { push: true } }],
          },
        ],
        labels: [
          { name: "bug", color: "d73a4a" },
          { name: "backlog", color: "0e8a16" },
          { name: "enhancement", color: "a2eeef" },
        ],
      },
    });

    await login(page);
    await page.getByRole("button", { name: "kai-kou/sample-app" }).click();

    const title = page.getByRole("textbox", { name: /タイトル|^Title$/ });
    await title.fill("決済ボタンが反応しない @b");

    const suggestions = page.getByRole("list", { name: /ラベルの候補|Label suggestions/ });
    await expect(suggestions).toBeVisible();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT_DIR}/smart-input.png` });
  });

  test("shortcuts: 保存済みショートカット一覧（設定画面）", async ({ page, request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [{ id: 1, full_name: "kai-kou/sample-app", private: false, permissions: { push: true } }],
          },
        ],
        labels: [
          { name: "bug", color: "d73a4a" },
          { name: "P1", color: "0e8a16" },
          { name: "enhancement", color: "a2eeef" },
        ],
      },
    });

    await login(page);
    await page.goto("/shortcuts");

    // 撮影用にショートカットを2件作る（バグ報告用・機能要望用）。
    await page.getByLabel(/リポジトリ（任意）|Repository \(optional\)/).selectOption("kai-kou/sample-app");
    await page.getByText(/ラベルを追加|Add labels/).click();
    await page.getByRole("checkbox", { name: "bug" }).check();
    await page.getByRole("checkbox", { name: "P1" }).check();
    await page.getByPlaceholder(/バグ報告|Bug report/).fill("バグ報告: ");
    await page.getByRole("button", { name: /^保存$|^Save$/ }).click();
    await expect(page.locator(".shortcut-row")).toHaveCount(1);

    await page.getByLabel(/リポジトリ（任意）|Repository \(optional\)/).selectOption("kai-kou/sample-app");
    await page.getByText(/ラベルを追加|Add labels/).click();
    await page.getByRole("checkbox", { name: "enhancement" }).check();
    await page.getByPlaceholder(/バグ報告|Bug report/).fill("機能要望: ");
    await page.getByRole("button", { name: /^保存$|^Save$/ }).click();
    await expect(page.locator(".shortcut-row")).toHaveCount(2);

    // 作成フォームの下に一覧が続くため、ビューポート撮影では一覧が画面外に隠れる。
    // 「保存済みショートカット一覧（起動 URL 付き）」が主役の画面なので、一覧が見える位置までスクロールする。
    await page.locator(".shortcut-row").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT_DIR}/shortcuts.png` });

    // 後始末: 同一 e2e-user を共有する後続 spec（他ファイル）へ持ち越さない。
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: /削除|Delete/ }).first().click();
      await page.getByRole("button", { name: /削除|Delete/ }).first().click();
    }
    await expect(page.getByText(/まだショートカットがありません|No shortcuts yet/)).toBeVisible();
  });
});
