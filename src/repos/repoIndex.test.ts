import { describe, expect, it } from "vitest";
import { buildRepoIndex } from "./repoIndex";

describe("buildRepoIndex", () => {
  it("indexes both the full name and the unique short name", () => {
    const index = buildRepoIndex([{ fullName: "kai-kou/alpha" }, { fullName: "acme/gamma" }]);
    expect(index.get("kai-kou/alpha")).toBe("kai-kou/alpha");
    expect(index.get("alpha")).toBe("kai-kou/alpha");
    expect(index.get("gamma")).toBe("acme/gamma");
  });

  it("is case-insensitive on lookup keys", () => {
    const index = buildRepoIndex([{ fullName: "kai-kou/Alpha" }]);
    expect(index.get("kai-kou/alpha")).toBe("kai-kou/Alpha");
    expect(index.get("alpha")).toBe("kai-kou/Alpha");
  });

  it("omits the short-name entry when it collides across repos", () => {
    const index = buildRepoIndex([{ fullName: "kai-kou/alpha" }, { fullName: "acme/alpha" }]);
    expect(index.has("alpha")).toBe(false);
    expect(index.get("kai-kou/alpha")).toBe("kai-kou/alpha");
    expect(index.get("acme/alpha")).toBe("acme/alpha");
  });
});
