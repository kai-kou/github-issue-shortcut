import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIssue,
  fetchAccessibleRepos,
  fetchInstallationCount,
  fetchInstallations,
  fetchRepoLabels,
  GitHubApiError,
} from "./github";

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

  it("aggregates repositories across installations, sorted and de-duplicated, carrying push permission", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/user/installations?")) {
        return jsonResponse(200, { installations: [{ id: 10 }, { id: 20 }] });
      }
      if (url.includes("/user/installations/10/repositories")) {
        return jsonResponse(200, {
          repositories: [{ id: 1, full_name: "kai-kou/beta", private: false, permissions: { push: false } }],
        });
      }
      if (url.includes("/user/installations/20/repositories")) {
        return jsonResponse(200, {
          repositories: [
            { id: 2, full_name: "kai-kou/alpha", private: true, permissions: { push: true } },
            { id: 1, full_name: "kai-kou/beta", private: false, permissions: { push: false } },
          ],
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAccessibleRepos("https://api.github.com", "token")).resolves.toEqual([
      { id: 2, fullName: "kai-kou/alpha", private: true, pushAccess: true },
      { id: 1, fullName: "kai-kou/beta", private: false, pushAccess: false },
    ]);
  });

  it("defaults pushAccess to false when the permissions field is absent", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/user/installations?")) {
        return jsonResponse(200, { installations: [{ id: 10 }] });
      }
      return jsonResponse(200, { repositories: [{ id: 1, full_name: "kai-kou/beta", private: false }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAccessibleRepos("https://api.github.com", "token")).resolves.toEqual([
      { id: 1, fullName: "kai-kou/beta", private: false, pushAccess: false },
    ]);
  });
});

describe("fetchRepoLabels", () => {
  it("returns the label list for a repository", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, [{ name: "bug", color: "d73a4a" }, { name: "enhancement", color: "a2eeef" }])),
    );
    await expect(fetchRepoLabels("https://api.github.com", "token", "kai-kou/alpha")).resolves.toEqual([
      { name: "bug", color: "d73a4a" },
      { name: "enhancement", color: "a2eeef" },
    ]);
  });

  it("follows pagination until a short page is returned", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ name: `label-${i}`, color: "ededed" }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, fullPage))
      .mockResolvedValueOnce(jsonResponse(200, [{ name: "last", color: "000000" }]));
    vi.stubGlobal("fetch", fetchMock);
    const labels = await fetchRepoLabels("https://api.github.com", "token", "kai-kou/alpha");
    expect(labels).toHaveLength(101);
    expect(labels.at(-1)).toEqual({ name: "last", color: "000000" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a GitHubApiError on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(404, { message: "Not Found" })),
    );
    const err: GitHubApiError = await fetchRepoLabels("https://api.github.com", "token", "kai-kou/missing").catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err.status).toBe(404);
  });
});

describe("createIssue", () => {
  it("posts to /repos/{owner}/{repo}/issues with the pinned API version and returns number/htmlUrl", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.github.com/repos/kai-kou/alpha/issues");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-GitHub-Api-Version"]).toBe("2026-03-10");
      expect(JSON.parse(init?.body as string)).toEqual({ title: "バグ報告", body: "詳細" });
      return jsonResponse(201, { number: 42, html_url: "https://github.com/kai-kou/alpha/issues/42" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createIssue("https://api.github.com", "token", "kai-kou/alpha", { title: "バグ報告", body: "詳細" }),
    ).resolves.toEqual({ number: 42, htmlUrl: "https://github.com/kai-kou/alpha/issues/42" });
  });

  it("omits body from the request payload when empty (title-only submission)", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(init?.body as string)).toEqual({ title: "タイトルのみ" });
      return jsonResponse(201, { number: 1, html_url: "https://github.com/kai-kou/alpha/issues/1" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await createIssue("https://api.github.com", "token", "kai-kou/alpha", { title: "タイトルのみ", body: "" });
  });

  it("includes labels in the request payload when provided (B3-2)", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(init?.body as string)).toEqual({ title: "バグ報告", labels: ["bug", "urgent"] });
      return jsonResponse(201, { number: 2, html_url: "https://github.com/kai-kou/alpha/issues/2" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await createIssue("https://api.github.com", "token", "kai-kou/alpha", {
      title: "バグ報告",
      body: "",
      labels: ["bug", "urgent"],
    });
  });

  it("omits labels from the request payload when the array is empty", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(init?.body as string)).toEqual({ title: "タイトルのみ" });
      return jsonResponse(201, { number: 3, html_url: "https://github.com/kai-kou/alpha/issues/3" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await createIssue("https://api.github.com", "token", "kai-kou/alpha", { title: "タイトルのみ", body: "", labels: [] });
  });

  it("throws a GitHubApiError carrying the status and GitHub's message on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(404, { message: "Not Found" })),
    );
    const err: GitHubApiError = await createIssue("https://api.github.com", "token", "kai-kou/missing", {
      title: "x",
      body: "",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe("Not Found");
    expect(err.rateLimited).toBe(false);
  });

  it("marks a 403 with Retry-After as rate limited and carries the wait time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "You have exceeded a secondary rate limit" }), {
            status: 403,
            headers: { "Content-Type": "application/json", "Retry-After": "30" },
          }),
      ),
    );
    const err: GitHubApiError = await createIssue("https://api.github.com", "token", "kai-kou/alpha", {
      title: "x",
      body: "",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err.status).toBe(403);
    expect(err.rateLimited).toBe(true);
    expect(err.retryAfterSeconds).toBe(30);
  });

  it("marks a 403 without rate-limit headers as a plain permission error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(403, { message: "Resource not accessible by integration" })),
    );
    const err: GitHubApiError = await createIssue("https://api.github.com", "token", "kai-kou/alpha", {
      title: "x",
      body: "",
    }).catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.rateLimited).toBe(false);
  });

  it("throws a 410 GitHubApiError when issues are disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(410, { message: "Issues are disabled for this repo" })),
    );
    const err: GitHubApiError = await createIssue("https://api.github.com", "token", "kai-kou/alpha", {
      title: "x",
      body: "",
    }).catch((e) => e);
    expect(err.status).toBe(410);
  });

  it("throws a 422 GitHubApiError on validation/spam rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(422, { message: "Validation failed" })),
    );
    const err: GitHubApiError = await createIssue("https://api.github.com", "token", "kai-kou/alpha", {
      title: "x",
      body: "",
    }).catch((e) => e);
    expect(err.status).toBe(422);
  });
});
