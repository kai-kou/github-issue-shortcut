import { describe, expect, it, vi } from "vitest";
import {
  parseAccessTokenExpiry,
  refreshIfStale,
  REFRESH_SKEW_SECONDS,
  type RefreshDeps,
} from "./tokenRefresh";

// `document.cookie` / `navigator.locks` は Workers プールに存在しないため、ブラウザ配線
// （browserDeps）は E2E（e2e/login.spec.ts）で検証し、ここでは判定ロジックを純粋な形で固める。

describe("parseAccessTokenExpiry", () => {
  it("reads the expiry from a document.cookie style string", () => {
    expect(parseAccessTokenExpiry("__Host-gh-exp=1800000000")).toBe(1800000000);
    expect(parseAccessTokenExpiry("a=1; __Host-gh-exp=1800000000; b=2")).toBe(1800000000);
  });

  it("returns null when the cookie is missing (未ログイン) or unusable", () => {
    expect(parseAccessTokenExpiry("")).toBeNull();
    expect(parseAccessTokenExpiry("other=1")).toBeNull();
    expect(parseAccessTokenExpiry("__Host-gh-exp=abc")).toBeNull();
    // トークン本体（HttpOnly）は document.cookie に現れない前提。名前の部分一致で拾わない。
    expect(parseAccessTokenExpiry("__Host-gh=sealed-value")).toBeNull();
  });
});

const NOW = 1_800_000_000;

/**
 * リフレッシュが「実際に期限を延ばす」世界をシミュレートする deps。
 * withLock は本物の Web Locks と同じく相互排他（＝直列化）する。
 */
function makeDeps(initialExpiry: number | null) {
  let expiry = initialExpiry;
  let chain: Promise<unknown> = Promise.resolve();
  const postRefresh = vi.fn(async () => {
    expiry = NOW + 28800;
    return true;
  });
  const deps: RefreshDeps = {
    now: () => NOW,
    readExpiry: () => expiry,
    withLock: (fn) => {
      const run = chain.then(fn, fn);
      chain = run.catch(() => undefined);
      return run;
    },
    postRefresh,
  };
  return { deps, postRefresh, getExpiry: () => expiry };
}

describe("refreshIfStale（Web Locks による 1 本化・stateless-architecture.md §5）", () => {
  it("does nothing when the access token is still comfortably valid", async () => {
    const { deps, postRefresh } = makeDeps(NOW + 3600);
    expect(await refreshIfStale(deps, REFRESH_SKEW_SECONDS)).toBe(true);
    expect(postRefresh).not.toHaveBeenCalled();
  });

  it("refreshes when the expiry is within the skew window", async () => {
    const { deps, postRefresh, getExpiry } = makeDeps(NOW + 30);
    expect(await refreshIfStale(deps, REFRESH_SKEW_SECONDS)).toBe(true);
    expect(postRefresh).toHaveBeenCalledTimes(1);
    expect(getExpiry()).toBe(NOW + 28800);
  });

  it("runs the GitHub refresh only once for many concurrent callers (多タブ・SW の同時起動)", async () => {
    const { deps, postRefresh } = makeDeps(NOW - 10);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => refreshIfStale(deps, REFRESH_SKEW_SECONDS)),
    );

    expect(results).toEqual([true, true, true, true, true]);
    // 単回使用ローテーションのため、同時多発でも 1 回だけ走ること（ここが本移行の最大の技術リスク）。
    expect(postRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not touch the network when unauthenticated (期限 Cookie が無い)", async () => {
    const { deps, postRefresh } = makeDeps(null);
    expect(await refreshIfStale(deps, REFRESH_SKEW_SECONDS)).toBe(false);
    expect(postRefresh).not.toHaveBeenCalled();
  });

  it("reports failure without retrying when the refresh is rejected (bad_refresh_token → 再ログイン)", async () => {
    const postRefresh = vi.fn(async () => false);
    const deps: RefreshDeps = {
      now: () => NOW,
      readExpiry: () => NOW - 10,
      withLock: (fn) => fn(),
      postRefresh,
    };
    expect(await refreshIfStale(deps, 0)).toBe(false);
    expect(postRefresh).toHaveBeenCalledTimes(1);
  });

  it("skips the refresh inside the lock when another tab already renewed it", async () => {
    let expiry = NOW - 10;
    const postRefresh = vi.fn(async () => true);
    const deps: RefreshDeps = {
      now: () => NOW,
      readExpiry: () => expiry,
      withLock: async (fn) => {
        // ロック待ちの間に他タブがリフレッシュを完了させた状況を再現する。
        expiry = NOW + 28800;
        return fn();
      },
      postRefresh,
    };
    expect(await refreshIfStale(deps, REFRESH_SKEW_SECONDS)).toBe(true);
    expect(postRefresh).not.toHaveBeenCalled();
  });
});
