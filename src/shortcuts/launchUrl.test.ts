import { describe, expect, it } from "vitest";
import { buildLaunchUrl } from "./launchUrl";

describe("buildLaunchUrl", () => {
  it("includes repo, labels, and title as query parameters", () => {
    expect(buildLaunchUrl({ repo: "owner/name", labels: ["bug", "ui"], title: "雛形" }, "https://example.com")).toBe(
      "https://example.com/new?repo=owner%2Fname&labels=bug%2Cui&title=%E9%9B%9B%E5%BD%A2",
    );
  });

  it("omits empty fields and returns a bare /new for an all-empty preset", () => {
    expect(buildLaunchUrl({ repo: "", labels: [], title: "" }, "https://example.com")).toBe("https://example.com/new");
  });

  it("includes only the non-empty fields", () => {
    expect(buildLaunchUrl({ repo: "owner/name", labels: [], title: "" }, "https://example.com")).toBe(
      "https://example.com/new?repo=owner%2Fname",
    );
  });
});
