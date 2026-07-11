import { describe, expect, it } from "vitest";
import { isSupportedLocale, pickLocale } from "./detectLocale";

describe("pickLocale", () => {
  it("returns ja when the primary preferred language is ja", () => {
    expect(pickLocale(["ja-JP", "en-US"])).toBe("ja");
  });

  it("returns en when the primary preferred language is en", () => {
    expect(pickLocale(["en-US", "ja-JP"])).toBe("en");
  });

  it("falls back to en when no preferred language is supported", () => {
    expect(pickLocale(["fr-FR", "de-DE"])).toBe("en");
  });

  it("falls back to en when given an empty list", () => {
    expect(pickLocale([])).toBe("en");
  });
});

describe("isSupportedLocale", () => {
  it("accepts ja and en", () => {
    expect(isSupportedLocale("ja")).toBe(true);
    expect(isSupportedLocale("en")).toBe(true);
  });

  it("rejects unsupported or null values", () => {
    expect(isSupportedLocale("fr")).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
  });
});
