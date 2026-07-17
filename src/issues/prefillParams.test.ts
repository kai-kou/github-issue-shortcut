import { describe, expect, it } from "vitest";
import { hasPrefillParams, parsePrefillParams } from "./prefillParams";

describe("parsePrefillParams", () => {
  it("reads repo, labels, and title from the query string", () => {
    expect(parsePrefillParams("?repo=owner%2Fname&labels=bug%2Cui&title=%E9%9B%9B%E5%BD%A2")).toEqual({
      repo: "owner/name",
      labels: ["bug", "ui"],
      title: "雛形",
    });
  });

  it("trims whitespace around labels and drops empty entries", () => {
    expect(parsePrefillParams("?labels=bug%2C%20%2C%20ui")).toEqual({
      repo: null,
      labels: ["bug", "ui"],
      title: null,
    });
  });

  it("returns nulls and an empty labels array when no params are present", () => {
    expect(parsePrefillParams("")).toEqual({ repo: null, labels: [], title: null });
  });

  it("treats a blank param value as absent", () => {
    expect(parsePrefillParams("?repo=&title=")).toEqual({ repo: null, labels: [], title: null });
  });
});

describe("hasPrefillParams", () => {
  it("is false when nothing is set", () => {
    expect(hasPrefillParams({ repo: null, labels: [], title: null })).toBe(false);
  });

  it("is true when any single field is set", () => {
    expect(hasPrefillParams({ repo: "owner/name", labels: [], title: null })).toBe(true);
    expect(hasPrefillParams({ repo: null, labels: ["bug"], title: null })).toBe(true);
    expect(hasPrefillParams({ repo: null, labels: [], title: "雛形" })).toBe(true);
  });
});
