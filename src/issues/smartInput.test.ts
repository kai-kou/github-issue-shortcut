import { describe, expect, it } from "vitest";
import { committedTokens, findTokens, isTokenMatched, stripTokens } from "./smartInput";

describe("findTokens", () => {
  it("finds @label tokens at start-of-string and after whitespace", () => {
    const tokens = findTokens("Fix login bug @bug @P1", "@");
    expect(tokens.map((t) => t.raw)).toEqual(["@bug", "@P1"]);
  });

  it("finds #repo tokens including owner/repo form", () => {
    const tokens = findTokens("#myorg/myrepo fix it", "#");
    expect(tokens).toEqual([{ prefix: "#", raw: "#myorg/myrepo", name: "myorg/myrepo", start: 0, end: 13 }]);
  });

  it("does not treat mid-word @ (e.g. an email) as a token", () => {
    expect(findTokens("contact me@example.com please", "@")).toEqual([]);
  });

  it("ignores tokens of the other prefix", () => {
    expect(findTokens("fix @bug now", "#")).toEqual([]);
  });

  it("returns an empty array when there is no match", () => {
    expect(findTokens("no tokens here", "@")).toEqual([]);
  });
});

describe("committedTokens", () => {
  it("excludes a trailing token still being typed (no following text)", () => {
    const text = "fix login @bu";
    const tokens = findTokens(text, "@");
    expect(committedTokens(tokens, text)).toEqual([]);
  });

  it("includes a token followed by a trailing space", () => {
    const text = "fix login @bug ";
    const tokens = findTokens(text, "@");
    expect(committedTokens(tokens, text).map((t) => t.raw)).toEqual(["@bug"]);
  });

  it("includes a token followed by more text", () => {
    const text = "@bug still typing";
    const tokens = findTokens(text, "@");
    expect(committedTokens(tokens, text).map((t) => t.raw)).toEqual(["@bug"]);
  });
});

describe("isTokenMatched", () => {
  it("matches case-insensitively against a Set", () => {
    const [token] = findTokens("@Bug", "@");
    expect(isTokenMatched(token, new Set(["bug"]))).toBe(true);
  });

  it("returns false when not present", () => {
    const [token] = findTokens("@unknown", "@");
    expect(isTokenMatched(token, new Set(["bug"]))).toBe(false);
  });
});

describe("stripTokens", () => {
  it("removes the given tokens and collapses extra whitespace", () => {
    const text = "Fix login bug @bug @P1 now";
    const tokens = findTokens(text, "@");
    expect(stripTokens(text, tokens)).toBe("Fix login bug now");
  });

  it("returns the original text untouched when no tokens are given", () => {
    expect(stripTokens("plain text", [])).toBe("plain text");
  });

  it("trims leading/trailing whitespace left behind by a stripped token", () => {
    const text = "@bug Fix login";
    const tokens = findTokens(text, "@");
    expect(stripTokens(text, tokens)).toBe("Fix login");
  });
});
