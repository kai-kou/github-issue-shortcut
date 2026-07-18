import { describe, expect, it } from "vitest";
import { hasPrefillParams, parseLaunchTargetUrl, parsePrefillParams } from "./prefillParams";

describe("parsePrefillParams", () => {
  it("reads repo, labels, and title from the query string", () => {
    expect(parsePrefillParams("?repo=owner%2Fname&labels=bug%2Cui&title=%E9%9B%9B%E5%BD%A2")).toEqual({
      repo: "owner/name",
      labels: ["bug", "ui"],
      title: "雛形",
      body: null,
    });
  });

  it("trims whitespace around labels and drops empty entries", () => {
    expect(parsePrefillParams("?labels=bug%2C%20%2C%20ui")).toEqual({
      repo: null,
      labels: ["bug", "ui"],
      title: null,
      body: null,
    });
  });

  it("returns nulls and an empty labels array when no params are present", () => {
    expect(parsePrefillParams("")).toEqual({ repo: null, labels: [], title: null, body: null });
  });

  it("treats a blank param value as absent", () => {
    expect(parsePrefillParams("?repo=&title=")).toEqual({ repo: null, labels: [], title: null, body: null });
  });

  // B3-4: Web Share Target は manifest の params マッピングで text→body / url→url として届く（vite.config.ts）。
  it("reads body from the Web Share Target text param", () => {
    expect(parsePrefillParams("?title=%E8%A8%98%E4%BA%8B&body=%E5%85%B1%E6%9C%89%E3%81%97%E3%81%9F%E3%83%A1%E3%83%A2")).toEqual({
      repo: null,
      labels: [],
      title: "記事",
      body: "共有したメモ",
    });
  });

  it("appends url to body when both are present and body doesn't already contain it", () => {
    expect(parsePrefillParams("?body=%E3%83%A1%E3%83%A2&url=https%3A%2F%2Fexample.com%2Fa")).toEqual({
      repo: null,
      labels: [],
      title: null,
      body: "メモ\n\nhttps://example.com/a",
    });
  });

  it("uses url alone as body when text/body is absent (Android では url が空になりがちな逆パターンの保険)", () => {
    expect(parsePrefillParams("?url=https%3A%2F%2Fexample.com%2Fb")).toEqual({
      repo: null,
      labels: [],
      title: null,
      body: "https://example.com/b",
    });
  });

  it("does not duplicate the url when body already contains it (Android の典型: 共有 URL が text に入り url は空)", () => {
    expect(
      parsePrefillParams("?body=%E8%A6%8B%E3%81%A6%EF%BC%9A+https%3A%2F%2Fexample.com%2Fc&url=https%3A%2F%2Fexample.com%2Fc"),
    ).toEqual({
      repo: null,
      labels: [],
      title: null,
      body: "見て： https://example.com/c",
    });
  });
});

describe("hasPrefillParams", () => {
  it("is false when nothing is set", () => {
    expect(hasPrefillParams({ repo: null, labels: [], title: null, body: null })).toBe(false);
  });

  it("is true when any single field is set", () => {
    expect(hasPrefillParams({ repo: "owner/name", labels: [], title: null, body: null })).toBe(true);
    expect(hasPrefillParams({ repo: null, labels: ["bug"], title: null, body: null })).toBe(true);
    expect(hasPrefillParams({ repo: null, labels: [], title: "雛形", body: null })).toBe(true);
    expect(hasPrefillParams({ repo: null, labels: [], title: null, body: "メモ" })).toBe(true);
  });
});

// #98: WebAPK が既存アプリを start_url で再利用起動する際、Launch Handler API
// （window.launchQueue）から渡される起動 URL からパス・クエリを復元する。
describe("parseLaunchTargetUrl", () => {
  const origin = "https://issue-shortcut.example.com";

  it("splits a same-origin target URL into path and search", () => {
    expect(parseLaunchTargetUrl(`${origin}/new?repo=kai-kou%2Falpha&title=%E9%9B%9B%E5%BD%A2`, origin)).toEqual({
      path: "/new",
      search: "?repo=kai-kou%2Falpha&title=%E9%9B%9B%E5%BD%A2",
    });
  });

  it("resolves a relative target URL against the origin", () => {
    expect(parseLaunchTargetUrl("/new?labels=bug", origin)).toEqual({ path: "/new", search: "?labels=bug" });
  });

  it("returns null for a cross-origin target URL", () => {
    expect(parseLaunchTargetUrl("https://evil.example.com/new?repo=x", origin)).toBeNull();
  });

  it("returns null for an unparsable target URL", () => {
    expect(parseLaunchTargetUrl("http://[::1", origin)).toBeNull();
  });
});
