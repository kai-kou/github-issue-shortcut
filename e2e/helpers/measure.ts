import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Page, CDPSession, Locator } from "@playwright/test";

// #124: 起票フロー速度・タップ数を CLI で自動計測するための補助ユーティリティ。
// CDP スロットリングで実機ミドルレンジ Android の下限を近似し、所要時間を回帰検出の基準値として記録する。

// Chrome DevTools "Slow 4G" 相当のネットワーク条件（実機の 4G 近似）。
// download 1.6 Mbps / upload 750 kbps / RTT 150ms を CDP の B/s・ms 単位に換算する。
export const SLOW_4G = {
  offline: false,
  downloadThroughput: Math.floor((1.6 * 1024 * 1024) / 8),
  uploadThroughput: Math.floor((750 * 1024) / 8),
  latency: 150,
} as const;

// ミドルレンジ Android ≒ CI/デスクトップ CPU の約 1/4（DevTools の "4x slowdown" 相当）。
export const CPU_THROTTLE_RATE = 4;

// CDP 経由で CPU + ネットワークのスロットリングを適用し、実機下限を近似する。
// Chromium 専用（playwright.config は Pixel 7 = Chromium のため常に利用可能）。
export async function applyMobileThrottling(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", SLOW_4G);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE_RATE });
  return cdp;
}

// タップ（クリック）操作を数えながら実行するカウンタ。KPI「3 タップ以内」を機械的に検証する。
export function createTapCounter() {
  let taps = 0;
  return {
    async tap(locator: Locator) {
      taps += 1;
      await locator.click();
    },
    get count() {
      return taps;
    },
  };
}

// 区間の wall-clock 所要時間（ms）を測る。ネットワーク往復を含む体感時間の近似。
export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - start) };
}

export interface Measurement {
  scenario: string;
  durationMs: number;
  throttled: boolean;
  targetMs?: number;
  taps?: number;
  tapBudget?: number;
}

const measurements: Measurement[] = [];

export function record(m: Measurement): void {
  measurements.push(m);
}

// 計測結果を JSON レポートに書き出し、CLI にも表形式で出力する。
// 所要時間は回帰検出の基準値であり、厳格な KPI 判定は実機（#35）に委ねる。
export function flushReport(path = "test-results/measure-report.json"): void {
  if (measurements.length === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  const report = { generatedAt: new Date().toISOString(), measurements };
  writeFileSync(path, JSON.stringify(report, null, 2));

  console.log("\n=== 起票フロー計測レポート（CDP スロットリング下・実機下限の近似）===");
  for (const m of measurements) {
    const target = m.targetMs != null ? ` [参考目標 ${m.targetMs}ms]` : "";
    const tap = m.taps != null ? ` / ${m.taps} タップ（上限 ${m.tapBudget}）` : "";
    console.log(`- ${m.scenario}: ${m.durationMs}ms${target}${tap}`);
  }
  console.log(`レポート出力: ${path}\n`);
}
