const STORAGE_KEY = "issue-shortcut:recent-repos";
const MAX_RECENT = 5;

/** 最近使用したリポジトリ（新しい順）を端末内ローカル履歴から読み出す（B2-2・FR-13）。 */
export function loadRecentRepos(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** リポジトリの選択を最近使用の先頭に記録する。既存の同名エントリは重複排除する。 */
export function recordRecentRepo(fullName: string): string[] {
  const next = [fullName, ...loadRecentRepos().filter((n) => n !== fullName)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可(プライベートブラウジング等)でも選択自体は継続する。
  }
  return next;
}
