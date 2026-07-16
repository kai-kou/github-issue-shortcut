import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAccessibleRepos, fetchInstallationCount, fetchInstallations } from "./github";

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

describe("fetchInstallations", () => {
  it("returns an empty array when there are no installations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { total_count: 0, installations: [] })),
    );
    await expect(fetchInstallations("https://api.github.com", "token")).resolves.toEqual([]);
  });

  it("follows pagination until a short page is returned", async () => {
    const fullPage = Array.from({ length: 2 }, (_, i) => ({ id: i + 1 }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { installations: fullPage }))
      .mockResolvedValueOnce(jsonResponse(200, { installations: [{ id: 3 }] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchInstallations("https://api.github.com", "token", 2)).resolves.toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(500, { message: "boom" })),
    );
    await expect(fetchInstallations("https://api.github.com", "token")).rejects.toThrow(/HTTP 500/);
  });
});

describe("fetchAccessibleRepos", () => {
  it("returns an empty array when the user has no installations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { installations: [] })),
    );
    await expect(fetchAccessibleRepos("https://api.github.com", "token")).resolves.toEqual([]);
  });

  it("aggregates repositories across installations, sorted and de-duplicated", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/user/installations?")) {
        return jsonResponse(200, { installations: [{ id: 10 }, { id: 20 }] });
      }
      if (url.includes("/user/installations/10/repositories")) {
        return jsonResponse(200, {
          repositories: [{ id: 1, full_name: "kai-kou/beta", private: false }],
        });
      }
      if (url.includes("/user/installations/20/repositories")) {
        return jsonResponse(200, {
          repositories: [
            { id: 2, full_name: "kai-kou/alpha", private: true },
            { id: 1, full_name: "kai-kou/beta", private: false },
          ],
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAccessibleRepos("https://api.github.com", "token")).resolves.toEqual([
      { id: 2, fullName: "kai-kou/alpha", private: true },
      { id: 1, fullName: "kai-kou/beta", private: false },
    ]);
  });
});
