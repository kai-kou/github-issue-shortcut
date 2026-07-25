import { describe, expect, it } from "vitest";
import { hasPushAccess } from "./pushAccess";

// RepoPicker / ShortcutHelperPage が共有する push 権限判定（#128）。判定がドリフトすると
// 「push 権限がないのにラベル UI が有効になり silently dropped される」（B5-3）が再発する。
describe("hasPushAccess", () => {
  const repos = [
    { fullName: "kai-kou/alpha", pushAccess: true },
    { fullName: "kai-kou/beta", pushAccess: false },
  ];

  it("returns the pushAccess flag of the selected repository", () => {
    expect(hasPushAccess(repos, "kai-kou/alpha")).toBe(true);
    expect(hasPushAccess(repos, "kai-kou/beta")).toBe(false);
  });

  it("returns false when nothing is selected", () => {
    expect(hasPushAccess(repos, "")).toBe(false);
    expect(hasPushAccess(repos, null)).toBe(false);
    expect(hasPushAccess(repos, undefined)).toBe(false);
  });

  it("returns false when the selected repository is not in the list", () => {
    expect(hasPushAccess(repos, "kai-kou/unknown")).toBe(false);
    expect(hasPushAccess([], "kai-kou/alpha")).toBe(false);
  });
});
