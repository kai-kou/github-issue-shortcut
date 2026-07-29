import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

// GitHub Pages で公開する LP（site/）の回帰テスト。
// 配信は e2e/lp-server.mjs（playwright.config.ts の webServer）。file:// ではなく http:// で回すのは、
// localStorage による言語設定の永続化を本番と同じ条件で検証するため。
const LP_URL = "http://localhost:8790/index.html";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];
const APP_URL = "https://github-issue-shortcut.kinamocchi-tech.workers.dev";

// 既定言語は日本語。ブラウザのロケール既定（en-US）に引きずられて監査対象言語が
// 変わらないよう、明示的に固定する。
test.use({ locale: "ja-JP" });

/** 監査・計測の前に、遅延読み込み画像とスクロール表示ブロックをすべて確定させる。 */
async function settlePage(page: Page) {
  // .reveal は IntersectionObserver 待ちだと画面外が opacity:0 のままで axe の検査から外れ、
  // フェード中（opacity 0〜1 の途中）だと色が背景と混ざって偽のコントラスト違反になる。
  // トランジションごと無効化して確定状態で測る。
  await page.addStyleTag({
    content: ".reveal { opacity: 1 !important; translate: none !important; transition: none !important; }",
  });
  await page.evaluate(async () => {
    // lazy 画像は一気に最下部へ飛ぶと読み込みが始まらないことがあるため eager へ倒す
    for (const img of Array.from(document.images)) img.loading = "eager";
    // FAQ は閉じた <details> の中身が非表示扱いになり監査対象外になるため開く
    for (const el of Array.from(document.querySelectorAll("details"))) {
      (el as HTMLDetailsElement).open = true;
    }
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
}

test.describe("ランディングページ（site/）", () => {
  // 主言語（ja・ライト・モバイル）と英語版（en・ダーク・デスクトップ）の両方を監査する。
  // 片方だけだと、もう一方にしかない文言・配色のコントラスト違反を取りこぼす。
  for (const variant of [
    { name: "日本語・ライト・モバイル", lang: "ja", scheme: "light" as const, width: 390 },
    { name: "English・ダーク・デスクトップ", lang: "en", scheme: "dark" as const, width: 1280 },
  ]) {
    test(`WCAG 違反がない（${variant.name}）`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: variant.scheme });
      await page.setViewportSize({ width: variant.width, height: 900 });
      await page.goto(LP_URL);
      await page.getByRole("button", { name: variant.lang === "ja" ? "日本語で表示" : "Show in English" }).click();
      await settlePage(page);

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(results.violations).toEqual([]);
    });
  }

  for (const width of [360, 1280]) {
    test(`横スクロールが発生しない（幅 ${width}px）`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(LP_URL);
      await settlePage(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("画像・favicon・OGP 画像がすべて存在する", async ({ page }) => {
    await page.goto(LP_URL);
    await settlePage(page);

    const broken = await page.evaluate(() =>
      Array.from(document.images)
        .filter((img) => img.naturalWidth === 0)
        .map((img) => img.getAttribute("src"))
    );
    expect(broken).toEqual([]);

    // <img> ではないため上の検査に入らない参照（favicon・OGP）も個別に確認する。
    // OGP はシェア時の見た目に直結し、切れていても画面上は気づけない。
    const referenced = await page.evaluate(() =>
      [
        ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]')).map(
          (el) => el.getAttribute("href")
        ),
        document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? null,
      ].filter((value): value is string => Boolean(value))
    );
    expect(referenced.length).toBeGreaterThan(0);
    for (const reference of referenced) {
      // og:image は公開 URL（絶対パス）で書くため、ファイル名だけをローカル配信で確認する
      const path = reference.replace(/^https?:\/\/[^/]+\/[^/]*/, "");
      const response = await page.request.get(new URL(path || reference, LP_URL).href);
      expect(response.status(), `${reference} が取得できない`).toBe(200);
    }
  });

  test("言語切替で本文・属性・タイトルがまとめて入れ替わる", async ({ page }) => {
    await page.goto(LP_URL);
    // 非アクティブ言語は CSS で display:none にするだけなので、textContent ではなく
    // 実際に見えているテキスト（innerText）で判定する。
    const heading = page.getByRole("heading", { level: 1 });
    const heroImage = page.locator(".hero__visual img");

    await page.getByRole("button", { name: "日本語で表示" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(heading).toContainText("思いついた瞬間", { useInnerText: true });
    await expect(heading).not.toContainText("Capture the idea", { useInnerText: true });
    await expect(heroImage).toHaveAttribute("alt", /起票フォーム/);

    await page.getByRole("button", { name: "Show in English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(heading).toContainText("Capture the idea", { useInnerText: true });
    await expect(heading).not.toContainText("思いついた瞬間", { useInnerText: true });
    // lang="en" の文書に日本語の alt / title が残っていると読み上げが崩れる（WCAG 3.1.2）
    await expect(heroImage).toHaveAttribute("alt", /issue form/i);
    await expect(page).toHaveTitle(/capture the idea/i);
  });

  test("選んだ言語が再訪時も維持される", async ({ page }) => {
    await page.goto(LP_URL);
    await page.getByRole("button", { name: "Show in English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("主要 CTA が見える状態でアプリとリポジトリに向いている", async ({ page }) => {
    await page.goto(LP_URL);
    await settlePage(page);

    // 件数ではなく「見えている導線の行き先」を検証する（本数は文言変更で容易に変わるため）
    const appLinks = page.getByRole("link", { name: /アプリを開いて起票する|Open the app/ });
    await expect(appLinks.first()).toBeVisible();
    for (const link of await appLinks.all()) {
      await expect(link).toHaveAttribute("href", APP_URL);
    }

    const repoLink = page.getByRole("link", { name: /GitHub でソースを見る|View on GitHub/ }).first();
    await expect(repoLink).toBeVisible();
    await expect(repoLink).toHaveAttribute("href", "https://github.com/kai-kou/github-issue-shortcut");
  });

  test("スクロールしたブロックが不透明になる（IntersectionObserver）", async ({ page }) => {
    await page.goto(LP_URL);
    // opacity は toBeVisible() の判定に含まれないため明示的に見る
    // （IntersectionObserver が壊れると、スクロールしても本文が透明のまま残る）
    for (const selector of [".problems", ".steps", ".faq"]) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      await expect(page.locator(selector)).toHaveCSS("opacity", "1");
    }
  });

  test("JS 無効でも本文が読める（プログレッシブエンハンスメント）", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, locale: "ja-JP" });
    const page = await context.newPage();
    await page.goto(LP_URL);

    await expect(page.getByRole("heading", { level: 1 })).toContainText("思いついた瞬間", {
      useInnerText: true,
    });
    // html.no-js の可視化が外れると本文が透明のまま残る
    await expect(page.locator(".problems")).toHaveCSS("opacity", "1");
    await expect(page.locator(".faq")).toHaveCSS("opacity", "1");
    await context.close();
  });

  test("main.js の取得に失敗しても本文が透明のまま残らない", async ({ browser }) => {
    const context = await browser.newContext({ locale: "ja-JP" });
    const page = await context.newPage();
    // head のインラインスクリプトは走るが main.js だけ届かない状況（CDN 障害・遮断）を再現する
    await context.route("**/main.js", (route) => route.abort());
    await page.goto(LP_URL);

    await expect(page.locator(".faq")).toHaveCSS("opacity", "1", { timeout: 10_000 });
    await context.close();
  });
});
