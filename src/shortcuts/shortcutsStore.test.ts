import { describe, expect, it } from "vitest";
import { normalizeShortcutInput, parseStoredShortcuts, type Shortcut } from "./shortcutsStore";

// shortcutsStore の localStorage 依存部（create/update/delete/list の保存 IO）は Workers プールに
// localStorage が無いため、authCache/reposCache/offlineQueue と同様 E2E（e2e/shortcuts.spec.ts）で
// 検証する。ここでは入力検証と保存済み JSON の解釈という純関数を固める。

const USER = 4242;

function preset(overrides: Partial<Shortcut> = {}): Shortcut {
  return { id: "s-1", repo: "kai-kou/app", labels: ["bug"], title: "t", name: "n", ...overrides };
}

describe("normalizeShortcutInput（旧 worker/index.ts の parseShortcutInput 相当・P1 でクライアントへ移設）", () => {
  it("値を trim し、空ラベルを落とす", () => {
    expect(
      normalizeShortcutInput({ repo: " kai-kou/app ", labels: [" bug ", "  "], title: " hi ", name: " n " }),
    ).toEqual({ repo: "kai-kou/app", labels: ["bug"], title: "hi", name: "n" });
  });

  it("repo・labels・title が全て空なら null（name だけでは保存できない）", () => {
    expect(normalizeShortcutInput({ name: "name only" })).toBeNull();
    expect(normalizeShortcutInput({})).toBeNull();
  });

  it("長さ・件数の上限を超える入力は null", () => {
    expect(normalizeShortcutInput({ repo: "a".repeat(141) })).toBeNull();
    expect(normalizeShortcutInput({ title: "a".repeat(501) })).toBeNull();
    expect(normalizeShortcutInput({ repo: "o/r", labels: ["a".repeat(51)] })).toBeNull();
    expect(normalizeShortcutInput({ repo: "o/r", labels: Array.from({ length: 21 }, (_, i) => `l${i}`) })).toBeNull();
    expect(normalizeShortcutInput({ repo: "o/r", name: "a".repeat(13) })).toBeNull();
  });

  it("上限ちょうどは通す（境界）", () => {
    expect(normalizeShortcutInput({ repo: "a".repeat(140), name: "a".repeat(12) })).not.toBeNull();
  });
});

describe("parseStoredShortcuts", () => {
  it("現在ユーザーの保存内容を保存順のまま返す", () => {
    const raw = JSON.stringify({ userId: USER, shortcuts: [preset(), preset({ id: "s-2", repo: "kai-kou/other" })] });
    expect(parseStoredShortcuts(raw, USER)).toEqual([preset(), preset({ id: "s-2", repo: "kai-kou/other" })]);
  });

  it("別アカウントの保存内容は返さない（#101・一覧の混入防止）", () => {
    const raw = JSON.stringify({ userId: 9999, shortcuts: [preset({ repo: "someone/private-repo" })] });
    expect(parseStoredShortcuts(raw, USER)).toEqual([]);
  });

  it("未保存・破損 JSON・想定外の形は空配列に倒す", () => {
    expect(parseStoredShortcuts(null, USER)).toEqual([]);
    expect(parseStoredShortcuts("{not json", USER)).toEqual([]);
    expect(parseStoredShortcuts(JSON.stringify({ userId: USER }), USER)).toEqual([]);
  });

  it("要素単位で壊れているものだけを落とす", () => {
    const raw = JSON.stringify({ userId: USER, shortcuts: [preset(), { id: "broken" }, { repo: "no-id" }] });
    expect(parseStoredShortcuts(raw, USER)).toEqual([preset()]);
  });
});
