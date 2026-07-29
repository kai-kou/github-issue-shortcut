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

// モックユーザーの avatar_url（http://localhost:8788/avatar.png・e2e/mock-github.mjs 冒頭コメント）は
// egress 制限のある CI で接続待ちが起きないよう意図的に 404 を返す設計になっている。E2E の他 spec は
// <img> の読み込み失敗を気にしないため無害だが、撮影用スクリーンショットではヘッダーのアバターが
// 「壊れた画像」アイコンで写り込んでしまう。mock-github.mjs 自体は変更せず（他 spec への影響ゼロ）、
// 本ファイル内だけ page.route() でこのリクエストを小さな SVG アバターに差し替える。
const AVATAR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
  '<rect width="64" height="64" rx="32" fill="#2ea44f"/>' +
  '<text x="32" y="43" font-size="28" text-anchor="middle" fill="#ffffff" ' +
  'font-family="Helvetica, Arial, sans-serif">e</text></svg>';

// README 訪問者向けの見せ方を意識し、モバイル実機に近い解像度で撮る。
// devices["Pixel 7"] は deviceScaleFactor:2.625・viewport 412x915 だが、PNG 容量を抑えるため
// このスペックでは軽量な 390x844 @2x（iPhone 12/13 相当の論理サイズ）に上書きする。
test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "ja-JP",
  // CSP（#209）の img-src は本番のアバター配信元（avatars.githubusercontent.com）だけを許可するため、
  // 上の page.route() が差し込む代替アバターはブラウザ側でブロックされる。撮影のときだけ CSP を
  // 迂回する（本番の CSP は変えない・他の spec には影響しない）。
  bypassCSP: true,
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
  test.beforeEach(async ({ page }) => {
    await page.route("**/avatar.png", (route) =>
      route.fulfill({ contentType: "image/svg+xml", body: AVATAR_SVG }),
    );
  });

  test.afterEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [], labels: [] } });
  });

  test("login: 未ログイン時のトップ画面（アプリの入口）", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ })).toBeVisible();
    // フォント読み込み・初回描画の揺れを避けるため一呼吸置く。
    await page.waitForTimeout(200);
    // このページは可視コンテンツが上部だけで、下は余白（README のファーストスクリーン向けに
    // フルページ撮影すると間延びする）。コンテンツ最下部（API ステータス行）に合わせてクリップする。
    const apiStatus = page.locator(".api-status");
    await expect(apiStatus).toBeVisible();
    const box = await apiStatus.boundingBox();
    const viewport = page.viewportSize();
    const height = box ? Math.ceil(box.y + box.height) + 24 : (viewport?.height ?? 844);
    await page.screenshot({
      path: `${OUT_DIR}/login.png`,
      clip: { x: 0, y: 0, width: viewport?.width ?? 390, height: Math.min(height, viewport?.height ?? 844) },
    });
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
});
