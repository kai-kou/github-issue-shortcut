import type { ShortcutPreset } from "./launchUrl";

const STORAGE_KEY = "issue-shortcut:shortcuts-cache";

export type Shortcut = ShortcutPreset & { id: string };

function isShortcut(value: unknown): value is Shortcut {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.repo === "string" &&
    typeof v.title === "string" &&
    typeof v.name === "string" &&
    Array.isArray(v.labels) &&
    v.labels.every((l) => typeof l === "string")
  );
}

/**
 * 起動時の即時表示（stale-while-revalidate・#101）のため、直近の `/api/shortcuts` 結果を端末内
 * ローカルキャッシュから読み出す。キャッシュ未保存なら null を返す（recentRepos.ts と同じ
 * 堅牢性: 破損 JSON・localStorage 不可でも例外を投げず null に倒す）。
 */
export function loadShortcutsCache(): Shortcut[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(isShortcut);
  } catch {
    return null;
  }
}

/** 最新の `/api/shortcuts` 結果をキャッシュへ保存する（次回起動時の即時表示用）。 */
export function saveShortcutsCache(shortcuts: Shortcut[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts));
  } catch {
    // localStorage 不可(プライベートブラウジング等)でもキャッシュを諦めるだけで機能に影響しない。
  }
}

/** ログアウト・アカウント削除時に呼び出し、別ユーザーのショートカット一覧が残らないようにする。 */
export function clearShortcutsCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}
