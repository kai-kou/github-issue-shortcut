import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const MOCK_GITHUB_URL = "http://localhost:8788";
const RESULT_PATH = "test-results/kpi-metrics.json";

// KPI 外形計測 PoC（Issue #35）。
// モバイルエミュレーション（Pixel 7・playwright.config.ts）+ モック GitHub 上で、起票フローの
// 「アプリ内処理時間」と Navigation Timing / FCP / LCP を外形計測する。
//
// 位置づけ（重要・提案での切り分けと一致）:
//   ✅ ここで測れるのは「アプリが理論上出せる下限値」= 機能ゲート + クライアント処理 + API 往復。
//   ❌ WebAPK/standalone のコールドスタート・実機ソフトキーボード遅延・CPU/thermal throttling
//      といった実機体感は含まない（それらは実機計測で別途担保する）。
// したがって本 spec の合否は「回帰でアプリ処理が遅くなっていないか」の監視であり、
// NFR-2 の実機 10 秒基準そのものの代替ではない（参考閾値としてのみ 10s を assert）。

type NavMetrics = {
  ttfbMs: number | null;
  domContentLoadedMs: number | null;
  loadEventEndMs: number | null;
  firstContentfulPaintMs: number | null;
  lcpMs: number | null;
};

type Metrics = {
  scenario: string;
  startToReadyMs: number; // 起動（goto）→ タイトル入力可能まで
  inputMs: number; // タイトル入力（自動タイピング・人間の打鍵は含まない）
  submitToCreatedMs: number; // 送信 →（モック）GitHub 作成完了表示まで（= クライアント処理 + API 往復）
  totalMs: number; // 起動 → 起票完了表示までの合計
  nav: NavMetrics;
};

const collected: Metrics[] = [];

async function login(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
  await expect(page.getByText(/e2e-user/)).toBeVisible();
}

async function readNav(page: Page): Promise<NavMetrics> {
  return await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByType("paint").find((e) => e.name === "first-contentful-paint");
    const lcp = (window as unknown as { __lcp?: number }).__lcp ?? 0;
    return {
      ttfbMs: nav ? Math.round(nav.responseStart) : null,
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadEventEndMs: nav ? Math.round(nav.loadEventEnd) : null,
      firstContentfulPaintMs: paint ? Math.round(paint.startTime) : null,
      lcpMs: lcp ? Math.round(lcp) : null,
    };
  });
}

test.describe("KPI 外形計測 PoC（モック GitHub・Pixel 7 エミュレーション）", () => {
  test.beforeEach(async ({ page, request }) => {
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
    // LCP は PerformanceObserver（buffered）でのみ取得できるため、各ページ生成前に仕込む。
    await page.addInitScript(() => {
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            (window as unknown as { __lcp: number }).__lcp = e.startTime;
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });
      } catch {
        /* LCP 非対応環境では無視（下位互換） */
      }
    });
  });

  test.afterEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [] } });
  });

  test.afterAll(() => {
    mkdirSync("test-results", { recursive: true });
    writeFileSync(RESULT_PATH, JSON.stringify(collected, null, 2));
    // reporter=list の末尾でまとめて確認できるよう表形式でも出す。
    // eslint-disable-next-line no-console
    console.log("\n[KPI-SUMMARY]\n" + JSON.stringify(collected, null, 2));
  });

  test("ショートカット起動 → タイトルのみ起票の外形計測（KPI #2 相当・リポ初期選択済み）", async ({ page }) => {
    await login(page); // ログインは初回セットアップ側。起票速度計測の対象外なので計測前に済ませる。

    const t0 = Date.now();
    // WebAPK ショートカット起動（リポジトリ初期選択）を URL 起動で模擬する。
    await page.goto("/new?repo=kai-kou%2Falpha");
    const title = page.getByRole("textbox", { name: /タイトル|^Title$/ });
    await expect(title).toBeVisible();
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toHaveAttribute("aria-pressed", "true");
    const tReady = Date.now();

    await title.fill("KPI 計測: ショートカット起動");
    const submit = page.getByRole("button", { name: /Issue を作成|Create issue/ });
    await expect(submit).toBeEnabled();
    const tInputDone = Date.now();

    await submit.click();
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();
    const t1 = Date.now();

    const nav = await readNav(page);
    const m: Metrics = {
      scenario: "shortcut-launch",
      startToReadyMs: tReady - t0,
      inputMs: tInputDone - tReady,
      submitToCreatedMs: t1 - tInputDone,
      totalMs: t1 - t0,
      nav,
    };
    collected.push(m);
    // eslint-disable-next-line no-console
    console.log("[KPI]", JSON.stringify(m));
    expect(m.totalMs, "起動→起票完了の外形時間（参考閾値 10s・NFR-2 の下限値監視）").toBeLessThan(10_000);
  });

  test("通常起動（リポ選択タップ込み） → タイトルのみ起票の外形計測", async ({ page }) => {
    await login(page);

    const t0 = Date.now();
    await page.goto("/");
    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    const title = page.getByRole("textbox", { name: /タイトル|^Title$/ });
    await expect(title).toBeVisible();
    const tReady = Date.now();

    await title.fill("KPI 計測: 通常起動");
    const submit = page.getByRole("button", { name: /Issue を作成|Create issue/ });
    await expect(submit).toBeEnabled();
    const tInputDone = Date.now();

    await submit.click();
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();
    const t1 = Date.now();

    const nav = await readNav(page);
    const m: Metrics = {
      scenario: "normal-launch",
      startToReadyMs: tReady - t0,
      inputMs: tInputDone - tReady,
      submitToCreatedMs: t1 - tInputDone,
      totalMs: t1 - t0,
      nav,
    };
    collected.push(m);
    // eslint-disable-next-line no-console
    console.log("[KPI]", JSON.stringify(m));
    expect(m.totalMs, "起動→起票完了の外形時間（参考閾値 10s・NFR-2 の下限値監視）").toBeLessThan(10_000);
  });
});
