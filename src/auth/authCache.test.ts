import { describe, expect, it } from "vitest";
import { parseAuthCache } from "./authCache";

// authCache の localStorage 依存部（load/save/clear）は Workers プールに localStorage が無いため
// reposCache/shortcutsCache と同様 E2E（e2e/repos.spec.ts）で検証する。ここでは JSON 検証の純関数
// parseAuthCache のみをユニットテストで固める（#119・起動時 SWR の破損耐性）。
describe("parseAuthCache", () => {
  const validMe = { login: "octocat", avatarUrl: "https://example.com/a.png", githubUserId: 42 };

  it("returns the cached auth when the payload is valid", () => {
    const raw = JSON.stringify({ me: validMe, installed: true });
    expect(parseAuthCache(raw)).toEqual({ me: validMe, installed: true });
  });

  it("accepts a null avatarUrl", () => {
    const raw = JSON.stringify({ me: { ...validMe, avatarUrl: null }, installed: false });
    expect(parseAuthCache(raw)).toEqual({ me: { ...validMe, avatarUrl: null }, installed: false });
  });

  it("returns null for a null/empty raw value", () => {
    expect(parseAuthCache(null)).toBeNull();
    expect(parseAuthCache("")).toBeNull();
  });

  it("returns null for broken JSON", () => {
    expect(parseAuthCache("{not json")).toBeNull();
  });

  it("returns null when installed is missing or not a boolean", () => {
    expect(parseAuthCache(JSON.stringify({ me: validMe }))).toBeNull();
    expect(parseAuthCache(JSON.stringify({ me: validMe, installed: "yes" }))).toBeNull();
  });

  it("returns null when me is missing required fields", () => {
    expect(parseAuthCache(JSON.stringify({ me: { login: "octocat" }, installed: true }))).toBeNull();
    expect(
      parseAuthCache(JSON.stringify({ me: { ...validMe, githubUserId: "42" }, installed: true })),
    ).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(parseAuthCache(JSON.stringify("string"))).toBeNull();
    expect(parseAuthCache(JSON.stringify(123))).toBeNull();
    expect(parseAuthCache(JSON.stringify(null))).toBeNull();
  });
});
