import { describe, expect, it } from "vitest";
import {
  activeToken,
  committedTokens,
  findTokens,
  isTokenMatched,
  replaceToken,
  stripTokens,
  suggestNames,
} from "./smartInput";

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

describe("activeToken（#145 入力中トークン）", () => {
  it("末尾の未確定トークンを返す", () => {
    const text = "ホゲ @b";
    expect(activeToken(findTokens(text, "@"), text)?.name).toBe("b");
  });

  it("空白で確定済みのトークンは返さない", () => {
    const text = "ホゲ @bug ";
    expect(activeToken(findTokens(text, "@"), text)).toBeNull();
  });

  it("トークンが無ければ null", () => {
    expect(activeToken(findTokens("ホゲ", "@"), "ホゲ")).toBeNull();
  });

  it("複数トークンがあっても対象は末尾のものだけ", () => {
    const text = "@bug ホゲ @doc";
    expect(activeToken(findTokens(text, "@"), text)?.name).toBe("doc");
  });
});

describe("suggestNames（#145 候補の絞り込み）", () => {
  const labels = ["bug", "backlog", "documentation", "enhancement"];

  it("前方一致（大文字小文字無視）で候補を返す", () => {
    expect(suggestNames(labels, "B", 6)).toEqual(["bug", "backlog"]);
  });

  it("プレフィックスが空なら全件を上限まで返す", () => {
    expect(suggestNames(labels, "", 2)).toEqual(["bug", "backlog"]);
  });

  it("完全一致 1 件だけのときは候補を出さない（既に認識済みのため）", () => {
    expect(suggestNames(labels, "documentation", 6)).toEqual([]);
  });

  it("完全一致でも他の前方一致候補があれば出す", () => {
    expect(suggestNames(["bug", "bugfix"], "bug", 6)).toEqual(["bug", "bugfix"]);
  });

  it("一致なしなら空", () => {
    expect(suggestNames(labels, "zzz", 6)).toEqual([]);
  });
});

describe("replaceToken（#145 候補タップの確定）", () => {
  it("トークンを完全名に置換し、末尾に空白を足して確定させる", () => {
    const text = "ホゲ @b";
    const [token] = findTokens(text, "@");
    expect(replaceToken(text, token, "bug")).toBe("ホゲ @bug ");
  });

  it("後続テキストがある場合も空白が二重にならない", () => {
    const text = "@b ホゲ";
    const [token] = findTokens(text, "@");
    expect(replaceToken(text, token, "bug")).toBe("@bug ホゲ");
  });
});
