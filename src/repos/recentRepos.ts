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

/** 最近使用の履歴を消す。private リポジトリ名を含むため、ログアウト・別ユーザー検知・
 * アカウント削除で必ず消す（共有端末で次の利用者に前の利用者のリポジトリ名が見えないように・#181）。 */
export function clearRecentRepos(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage 不可でも他の削除は続行する（呼び出し側は例外を期待しない）。
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
