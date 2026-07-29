import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// GitHub Pages で公開する LP（site/）の回帰テスト。
// LP はビルド不要の静的ファイルなので、サーバーを立てずに file:// で直接開く
// （localStorage は file:// で例外になり得るが、main.js が try/catch で吸収する）。
const LP_URL = pathToFileURL(resolve(process.cwd(), "site/index.html")).href;

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const APP_URL = "https://github-issue-shortcut.kinamocchi-tech.workers.dev";

test.describe("ランディングページ（site/）", () => {
  test("WCAG（wcag2a / wcag2aa / wcag22aa）違反がない", async ({ page }) => {
    await page.goto(LP_URL);
    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      // 文中のインラインリンクは WCAG 2.2 SC 2.5.8 の inline 例外に当たる（行の高さに拘束される）。
      // 誤検出を避けるため target-size は本文リンクを含む段落系ルールごと除外せず、
      // 個別に必要性が出た時点で見直す。現状は違反ゼロを維持する。
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("モバイル幅で横スクロールが発生しない", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(LP_URL);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("画像がすべて読み込める（リンク切れがない）", async ({ page }) => {
    await page.goto(LP_URL);
    // loading="lazy" の画像は視界に入るまで読み込まれないため、末尾までスクロールしてから判定する
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await Promise.all(
        Array.from(document.images).map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((done) => {
                img.addEventListener("load", done, { once: true });
                img.addEventListener("error", done, { once: true });
              })
        )
      );
    });
    const broken = await page.evaluate(() =>
      Array.from(document.images)
        .filter((img) => img.naturalWidth === 0)
        .map((img) => img.getAttribute("src"))
    );
    expect(broken).toEqual([]);
  });

  test("言語切替で日本語 / English が入れ替わる", async ({ page }) => {
    await page.goto(LP_URL);

    // 非アクティブ言語は CSS で display:none にするだけなので、textContent ではなく
    // 実際に見えているテキスト（innerText）で判定する。
    const heading = page.getByRole("heading", { level: 1 });

    await page.getByRole("button", { name: "日本語で表示" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(heading).toContainText("思いついた瞬間", { useInnerText: true });
    await expect(heading).not.toContainText("Capture the idea", { useInnerText: true });

    await page.getByRole("button", { name: "Show in English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(heading).toContainText("Capture the idea", { useInnerText: true });
    await expect(heading).not.toContainText("思いついた瞬間", { useInnerText: true });
  });

  test("主要 CTA がアプリとリポジトリに向いている", async ({ page }) => {
    await page.goto(LP_URL);
    // アプリへの導線（ヘッダー・ヒーロー・最終 CTA・フッター）
    await expect(page.locator(`a[href="${APP_URL}"]`)).toHaveCount(4);
    await expect(
      page.locator('a[href="https://github.com/kai-kou/github-issue-shortcut"]')
    ).not.toHaveCount(0);
  });

  test("JS 無効でも本文が表示される（プログレッシブエンハンスメント）", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(LP_URL);
    // 既定言語（日本語）が読め、スクロール表示待ちのブロックも可視になっている
    await expect(page.getByRole("heading", { level: 1 })).toContainText("思いついた瞬間", {
      useInnerText: true,
    });
    await expect(page.locator(".problems")).toBeVisible();
    await expect(page.locator(".faq")).toBeVisible();
    await context.close();
  });
});
