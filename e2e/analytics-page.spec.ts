import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";

// GitHub Pages で公開する利用状況ダッシュボード（site/analytics/）の回帰テスト。
// 配信は e2e/lp-server.mjs（playwright.config.ts の webServer）。
// フィードの取得先（raw.githubusercontent.com）は route で差し替え、CI をネットワークに
// 依存させない（＝取得先が落ちていてもテストは決定論的に回る）。
const PAGE_URL = "http://localhost:8790/analytics/index.html";
const FEED_PATTERN = "https://raw.githubusercontent.com/**/dashboard.json";

const FEED = {
  schema: 1,
  script: "github-issue-shortcut",
  source: "telemetry/worker-usage:content/analytics/worker_usage",
  free_tier_daily_requests: 100000,
  generated_at: "2099-01-05T10:00:00+09:00",
  coverage: { first: "2099-01-02", last: "2099-01-04", days: 3 },
  series: {
    daily: {
      last_updated: "2099-01-05T10:00:00+09:00",
      points: [
        { label: "2099-01-01", requests: 0, errors: 0, subrequests: 0, days: 0, missing: true },
        { label: "2099-01-02", requests: 10, errors: 0, subrequests: 1, days: 1, missing: false },
        { label: "2099-01-03", requests: 0, errors: 0, subrequests: 0, days: 1, missing: false },
        { label: "2099-01-04", requests: 40, errors: 2, subrequests: 5, days: 1, missing: false },
      ],
    },
    weekly: {
      last_updated: "2099-01-05T10:00:00+09:00",
      points: [
        { label: "2098-12-28", requests: 50, errors: 2, subrequests: 6, days: 3, missing: false },
      ],
    },
    monthly: {
      last_updated: "2099-01-05T10:00:00+09:00",
      points: [
        { label: "2099-01", requests: 50, errors: 2, subrequests: 6, days: 3, missing: false },
      ],
    },
  },
};

test.use({ locale: "ja-JP" });

test.describe("利用状況ダッシュボード", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(FEED_PATTERN, (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(FEED) })
    );
  });

  test("週次パネルが既定で表示され、KPI とグラフが描画される", async ({ page }) => {
    await page.goto(PAGE_URL);
    const weekly = page.locator("#panel-weekly");
    await expect(weekly.locator(".kpi")).toHaveCount(4);
    await expect(weekly.locator("svg.chart")).toBeVisible();
    // 合計 50 requests / エラー 2 件が KPI に出る
    await expect(weekly.locator(".kpi__value").first()).toHaveText("50");
    await expect(weekly.getByText("データ最終更新", { exact: false })).toBeVisible();
  });

  test("期間を切り替えるとパネルが入れ替わる（キーボード操作を含む）", async ({ page }) => {
    await page.goto(PAGE_URL);
    await expect(page.locator("#panel-weekly")).toBeVisible();

    await page.getByText("日次", { exact: true }).click();
    await expect(page.locator("#panel-daily")).toBeVisible();
    await expect(page.locator("#panel-weekly")).toBeHidden();

    // ラジオなので矢印キーでも移動できる（追加実装なしのキーボード対応）
    await page.locator("#period-daily").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#panel-weekly")).toBeVisible();
  });

  test("未計測の期間はゼロ埋めせずハッチングで区別する", async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.getByText("日次", { exact: true }).click();
    const daily = page.locator("#panel-daily");
    // 4 点のうち 1 点が missing
    await expect(daily.locator("svg.chart rect.chart__bar--missing")).toHaveCount(1);
    await expect(daily.getByText("1 日分は未計測", { exact: false })).toBeVisible();
    // 「収集したが 0 件」の日は missing 扱いにしない
    await expect(daily.locator("svg.chart rect.chart__bar")).toHaveCount(5); // 4 バー + エラー帯 1
  });

  test("フィードを取得できないときはその旨を表示する（読み込み中のまま固まらない）", async ({
    page,
  }) => {
    await page.route(FEED_PATTERN, (route) => route.abort());
    await page.goto(PAGE_URL);
    await expect(page.locator("#panel-weekly .panel__status")).toContainText(
      "データを取得できませんでした"
    );
  });

  test("JavaScript が無効でも「読み込み中」で固まらず案内が出る", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, locale: "ja-JP" });
    const page = await context.newPage();
    await page.goto(PAGE_URL);
    // 初期文言が「読み込み中」で終わらず、JS が要ることを明示している
    await expect(page.locator("#panel-weekly .panel__status")).toContainText(
      "JavaScript が必要です"
    );
    // noscript の代替導線（テキスト版サマリー）も用意されている。
    // noscript の中身が DOM として解析されるかはブラウザのスクリプティングフラグ次第なので、
    // 可視性ではなくマークアップの存在で検証する。
    await expect(page.locator("noscript")).toHaveCount(1);
    const fallback = await page.locator("noscript").innerHTML();
    expect(fallback).toContain("JavaScript を有効にするか");
    expect(fallback).toContain("SUMMARY.md");
    await context.close();
  });

  test("アクセシビリティ違反がない（ライト / ダーク）", async ({ page }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(PAGE_URL);
      await expect(page.locator("#panel-weekly .kpi").first()).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      expect(results.violations, `${colorScheme}: ${JSON.stringify(results.violations)}`).toEqual(
        []
      );
    }
  });
});
