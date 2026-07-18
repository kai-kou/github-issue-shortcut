import type { ShortcutPreset } from "./launchUrl";

const STORAGE_KEY = "issue-shortcut:shortcuts-cache";

export type Shortcut = ShortcutPreset & { id: string };

/** キャッシュ本体。どのユーザーの一覧かを `userId` で紐付け、別アカウントへ切り替えた際に
 * 前ユーザーのショートカット名・タイトルが新ユーザーへ一瞬でも表示されるのを防ぐ（#101・NFR-17）。 */
type CachedPayload = { userId: number; shortcuts: Shortcut[] };

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

function isCachedPayload(value: unknown): value is CachedPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.userId === "number" && Array.isArray(v.shortcuts);
}

/**
 * 起動時の即時表示（stale-while-revalidate・#101）のため、直近の `/api/shortcuts` 結果を端末内
 * ローカルキャッシュから読み出す。**キャッシュの所有ユーザーが現在ログイン中のユーザー（`userId`）と
 * 一致する場合のみ**返す（別アカウントへ切り替えた際の一覧の混入を防ぐ）。キャッシュ未保存・別ユーザー・
 * 破損 JSON・localStorage 不可のいずれでも例外を投げず null に倒す（recentRepos.ts と同じ堅牢性）。
 */
export function loadShortcutsCache(userId: number): Shortcut[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isCachedPayload(parsed) || parsed.userId !== userId) return null;
    return parsed.shortcuts.filter(isShortcut);
  } catch {
    return null;
  }
}

/** 最新の `/api/shortcuts` 結果を現在ユーザー（`userId`）に紐付けてキャッシュへ保存する（次回起動時の即時表示用）。 */
export function saveShortcutsCache(userId: number, shortcuts: Shortcut[]): void {
  try {
    const payload: CachedPayload = { userId, shortcuts };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
