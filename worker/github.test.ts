import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchInstallationCount } from "./github";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("fetchInstallationCount", () => {
  it("returns the total_count from GitHub's response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { total_count: 2, installations: [{}, {}] })),
    );
    await expect(fetchInstallationCount("https://api.github.com", "token")).resolves.toBe(2);
  });

  it("returns 0 when the user has no installations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { total_count: 0, installations: [] })),
    );
    await expect(fetchInstallationCount("https://api.github.com", "token")).resolves.toBe(0);
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(401, { message: "Bad credentials" })),
    );
    await expect(fetchInstallationCount("https://api.github.com", "token")).rejects.toThrow(/HTTP 401/);
  });
});
