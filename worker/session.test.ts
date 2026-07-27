import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  currentKeyVersion,
  openTokenBundle,
  sealTokenBundle,
  type TokenBundle,
} from "./session";
import type { Env } from "./types";

const testEnv = env as unknown as Env;

/** 実物大のトークン一式（GitHub の `ghu_` / `ghr_` はいずれも 40 文字前後）。 */
function realisticBundle(): TokenBundle {
  return {
    a: `ghu_${"a".repeat(36)}`,
    ae: 1_800_000_000,
    r: `ghr_${"r".repeat(36)}`,
    re: 1_815_000_000,
    u: 424242,
  };
}

describe("トークン Cookie の封入・開封（stateless-architecture.md §4）", () => {
  it("round-trips the bundle without exposing the tokens in the cookie value", async () => {
    const bundle = realisticBundle();
    const sealed = await sealTokenBundle(testEnv, bundle);
    expect(sealed).not.toContain(bundle.a);
    expect(sealed).not.toContain(bundle.r);
    expect(await openTokenBundle(testEnv, sealed)).toEqual(bundle);
  });

  it("stays well under the 4KB cookie limit (設計 §4 のサイズ試算の実測)", async () => {
    const sealed = await sealTokenBundle(testEnv, realisticBundle());
    // 設計の試算は約 250 バイト。上限 4096 に対する余裕を機械で担保する。
    expect(sealed.length).toBeLessThan(400);
  });

  it("returns null for a bundle sealed with a different key version (鍵ローテーション → 再ログイン)", async () => {
    const rotatedEnv = { ...testEnv, TOKEN_KEY_VERSION: "2" };
    const sealed = await sealTokenBundle(rotatedEnv, realisticBundle());
    // 現行バージョン（1）では開けない = 未認証扱い。
    expect(await openTokenBundle(testEnv, sealed)).toBeNull();
    // 鍵バージョンを上げた側では開ける（ローテーション後に発行された Cookie は有効）。
    expect(await openTokenBundle(rotatedEnv, sealed)).toEqual(realisticBundle());
  });

  it("returns null for tampered or malformed cookie values instead of throwing", async () => {
    const sealed = await sealTokenBundle(testEnv, realisticBundle());
    const tampered = sealed.slice(0, -4) + (sealed.endsWith("A") ? "BBBB" : "AAAA");
    expect(await openTokenBundle(testEnv, tampered)).toBeNull();
    expect(await openTokenBundle(testEnv, "not-a-sealed-value")).toBeNull();
    expect(await openTokenBundle(testEnv, "")).toBeNull();
  });

  it("returns null when the decrypted payload is not a well-formed bundle", async () => {
    // 正しい鍵で封入されていても中身が壊れていれば未認証に倒す（形式検証）。
    const { sealVersioned } = await import("./crypto");
    const sealed = await sealVersioned(testEnv.TOKEN_ENCRYPTION_KEY, currentKeyVersion(testEnv), JSON.stringify({ a: 1 }));
    expect(await openTokenBundle(testEnv, sealed)).toBeNull();
  });
});

describe("currentKeyVersion", () => {
  it("defaults to 1 and honours a valid TOKEN_KEY_VERSION", () => {
    expect(currentKeyVersion(testEnv)).toBe(1);
    expect(currentKeyVersion({ ...testEnv, TOKEN_KEY_VERSION: "7" })).toBe(7);
  });

  it("falls back to 1 for unusable values instead of failing the request", () => {
    expect(currentKeyVersion({ ...testEnv, TOKEN_KEY_VERSION: "0" })).toBe(1);
    expect(currentKeyVersion({ ...testEnv, TOKEN_KEY_VERSION: "abc" })).toBe(1);
    expect(currentKeyVersion({ ...testEnv, TOKEN_KEY_VERSION: "999" })).toBe(1);
  });
});
