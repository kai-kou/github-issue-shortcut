import { describe, expect, it } from "vitest";
import {
  codeChallengeS256,
  createCodeVerifier,
  hmacSha256Base64url,
  KeyVersionMismatchError,
  openVersioned,
  randomToken,
  sealVersioned,
} from "./crypto";

// テスト用の 32 バイト鍵。全ゼロの base64（明らかにテスト用・秘密ではない・低エントロピー）。
const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("randomToken", () => {
  it("returns url-safe base64 of expected length and is unique", () => {
    const a = randomToken(32);
    const b = randomToken(32);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 バイト -> 43 base64url 文字（パディングなし）
    expect(a.length).toBe(43);
  });
});


describe("hmacSha256Base64url（レート制限キーの仮名化・S2）", () => {
  const OTHER_KEY = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  it("is deterministic for the same key and message", async () => {
    expect(await hmacSha256Base64url(KEY, "issue-rate-limit:424242")).toBe(
      await hmacSha256Base64url(KEY, "issue-rate-limit:424242"),
    );
  });

  it("differs per message and per key", async () => {
    const base = await hmacSha256Base64url(KEY, "issue-rate-limit:1");
    expect(base).not.toBe(await hmacSha256Base64url(KEY, "issue-rate-limit:2"));
    // 鍵を知らなければ総当たりで元の ID を逆引きできない（無塩 SHA-256 との差）。
    expect(base).not.toBe(await hmacSha256Base64url(OTHER_KEY, "issue-rate-limit:1"));
  });

  it("does not leak the source value", async () => {
    const key = await hmacSha256Base64url(KEY, "issue-rate-limit:424242");
    expect(key).not.toContain("424242");
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("PKCE code challenge (S256)", () => {
  it("is deterministic and differs from the verifier", async () => {
    const verifier = createCodeVerifier();
    const c1 = await codeChallengeS256(verifier);
    const c2 = await codeChallengeS256(verifier);
    expect(c1).toBe(c2);
    expect(c1).not.toBe(verifier);
    expect(c1).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("AES-256-GCM の封入・開封", () => {
  it("uses a random IV so ciphertext differs each time", async () => {
    const a = await sealVersioned(KEY, 1, "same-plaintext");
    const b = await sealVersioned(KEY, 1, "same-plaintext");
    expect(a).not.toBe(b);
  });

  it("rejects tampered ciphertext", async () => {
    const blob = await sealVersioned(KEY, 1, "secret");
    // 2 文字目（IV の一部）を反転する。末尾文字は base64url のパディングビットしか
    // 変えずデコード結果が同一になりうるため、必ずバイトが変わる前方を改ざんする。
    const tampered = blob[0] + (blob[1] === "A" ? "B" : "A") + blob.slice(2);
    await expect(openVersioned(KEY, 1, tampered)).rejects.toThrow();
  });

  it("rejects a key that is not 32 bytes", async () => {
    await expect(sealVersioned("c2hvcnQ=", 1, "x")).rejects.toThrow();
  });
});

// 別の 32 バイト鍵（鍵ローテーションの検証用・全 1 バイトの base64）。
const OTHER_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

describe("鍵バージョン付きの封入・開封（トークン Cookie・stateless-architecture.md §4）", () => {
  it("round-trips plaintext with the current key version", async () => {
    const plaintext = JSON.stringify({ a: "ghu_token", ae: 1234, r: "ghr_token", re: 5678, u: 42 });
    const sealed = await sealVersioned(KEY, 1, plaintext);
    expect(sealed).not.toContain("ghu_token");
    expect(await openVersioned(KEY, 1, sealed)).toBe(plaintext);
  });

  it("refuses to open a value sealed with a different key version (＝鍵ローテーション後は再ログイン)", async () => {
    const sealed = await sealVersioned(KEY, 1, "secret");
    await expect(openVersioned(KEY, 2, sealed)).rejects.toBeInstanceOf(KeyVersionMismatchError);
  });

  it("opens a rotated value only with the matching version and key", async () => {
    const sealed = await sealVersioned(OTHER_KEY, 2, "secret");
    expect(await openVersioned(OTHER_KEY, 2, sealed)).toBe("secret");
    // バージョンが合っていても鍵が違えば復号できない（GCM の認証タグで検出）。
    await expect(openVersioned(KEY, 2, sealed)).rejects.toThrow();
  });

  it("detects a forged version byte (version is authenticated as AAD)", async () => {
    const sealed = await sealVersioned(KEY, 1, "secret");
    // 先頭バイト（バージョン）を 2 に差し替えた blob を組み立てる。
    const bytes = Uint8Array.from(atob(sealed.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
    bytes[0] = 2;
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const forged = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    // バージョンは一致するが AAD 不一致（＝改ざん）として復号が失敗する。
    await expect(openVersioned(KEY, 2, forged)).rejects.toThrow();
  });

  it("rejects an out-of-range key version", async () => {
    await expect(sealVersioned(KEY, 0, "x")).rejects.toThrow();
    await expect(sealVersioned(KEY, 256, "x")).rejects.toThrow();
  });
});
