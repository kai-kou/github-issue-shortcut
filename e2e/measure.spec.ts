import { test, expect } from "@playwright/test";
import {
  applyMobileThrottling,
  createTapCounter,
  timed,
  record,
  flushReport,
} from "./helpers/measure";

const MOCK_GITHUB_URL = "http://localhost:8788";

// #124: 起票フロー速度・タップ数の CLI 自動計測ハーネス（#35 の CLI 代替可能分）。
// - CDP で CPU 4x + Slow 4G のスロットリングを掛け、実機ミドルレンジ Android の下限を近似する。
// - 所要時間は「回帰検出の基準値」としてレポート出力し、ハードアサートしない
//   （スロットリング下の絶対時間は CI マシン速度差で変動し flaky 化するため・#124 の仮定）。
//   厳格な KPI（10 秒 / 5 秒以内）の合否判定は実機（#35）に委ねる。
// - タップ数は決定論的なのでハードアサートする（KPI: ショートカット起動時 3 タップ以内）。
// - 通常スイート（npm run e2e）からは playwright.config の testIgnore で除外し、
//   npm run e2e:measure（E2E_MEASURE=1）でのみ実行する。
test.describe("起票フロー計測（CDP スロットリング・モック GitHub）", () => {
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

  test.afterAll(() => {
    flushReport();
  });

  test("標準フロー（リポジトリ選択 → タイトル入力 → 送信 → 反映）の所要時間", async ({ page }) => {
    test.setTimeout(60_000); // スロットリング下は通常 spec より遅いため延長する
    await applyMobileThrottling(page);

    // ログインは計測対象外（オンボーディング所要は #95 の別計測）。
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    const { ms } = await timed(async () => {
      await page.getByRole("button", { name: "kai-kou/alpha" }).click();
      await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("計測: 標準フロー");
      await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
      await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();
    });

    record({
      scenario: "標準フロー（起動即入力なし）",
      durationMs: ms,
      targetMs: 10_000,
      throttled: true,
    });

    // 回帰検出用の緩いガード（極端な劣化のみ検知）。厳格 KPI 判定は実機（#35）。
    expect(ms, "スロットリング下でも極端に遅くない").toBeLessThan(30_000);
  });

  test("プリフィル（ショートカット）フローの所要時間とタップ数", async ({ page }) => {
    test.setTimeout(60_000);
    await applyMobileThrottling(page);

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    const counter = createTapCounter();
    // ショートカット起動 ＝ ホーム画面アイコンのタップ（CLI 外の 1 タップ）を加味する。
    const LAUNCH_TAP = 1;

    const { ms } = await timed(async () => {
      // プリフィル起動: repo と title は URL パラメータで選択済み（B1-2・FR-19）。
      const params = new URLSearchParams({ repo: "kai-kou/alpha", title: "計測ショートカット" });
      await page.goto(`/new?${params.toString()}`);
      await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue(
        "計測ショートカット",
      );
      // ページ内操作は「送信」の 1 タップのみ（タイトルはプリフィル済み）。
      await counter.tap(page.getByRole("button", { name: /Issue を作成|Create issue/ }));
      await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();
    });

    const totalTaps = LAUNCH_TAP + counter.count;
    record({
      scenario: "プリフィル（ショートカット）フロー",
      durationMs: ms,
      taps: totalTaps,
      tapBudget: 3,
      targetMs: 5_000,
      throttled: true,
    });

    // KPI: ショートカット起動時 3 タップ以内（起動 → 入力 → 送信）。決定論的なのでハードアサートする。
    expect(totalTaps, "ショートカット起動から送信まで 3 タップ以内（KPI）").toBeLessThanOrEqual(3);
    expect(ms, "スロットリング下でも極端に遅くない").toBeLessThan(20_000);
  });
});
