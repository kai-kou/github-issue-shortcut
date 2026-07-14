import { describe, expect, it } from "vitest";
import {
  codeChallengeS256,
  createCodeVerifier,
  decryptString,
  encryptString,
  hashSessionId,
  randomToken,
} from "./crypto";

// テスト用の 32 バイト鍵。可読 ASCII のプレースホルダを base64 化する
// （秘密に見える高エントロピー文字列をソースに直書きしないため）。
const KEY = btoa("0123456789abcdef0123456789abcdef");

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

describe("hashSessionId", () => {
  it("is deterministic and hides the raw id", async () => {
    const id = randomToken(32);
    const h1 = await hashSessionId(id);
    const h2 = await hashSessionId(id);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(id);
    expect(h1).toMatch(/^[A-Za-z0-9_-]+$/);
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

describe("AES-256-GCM encrypt/decrypt", () => {
  it("round-trips plaintext without leaking it", async () => {
    const plaintext = "gho_exampletoken_1234567890";
    const blob = await encryptString(KEY, plaintext);
    expect(blob).not.toContain(plaintext);
    expect(await decryptString(KEY, blob)).toBe(plaintext);
  });

  it("uses a random IV so ciphertext differs each time", async () => {
    const a = await encryptString(KEY, "same-plaintext");
    const b = await encryptString(KEY, "same-plaintext");
    expect(a).not.toBe(b);
  });

  it("rejects tampered ciphertext", async () => {
    const blob = await encryptString(KEY, "secret");
    // 先頭文字（IV の一部）を反転する。末尾文字は base64url のパディングビットしか
    // 変えずデコード結果が同一になりうるため、必ずバイトが変わる先頭を改ざんする。
    const tampered = (blob[0] === "A" ? "B" : "A") + blob.slice(1);
    await expect(decryptString(KEY, tampered)).rejects.toThrow();
  });

  it("rejects a key that is not 32 bytes", async () => {
    await expect(encryptString("c2hvcnQ=", "x")).rejects.toThrow();
  });
});
