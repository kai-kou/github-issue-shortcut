const STORAGE_KEY = "issue-shortcut:repos-cache";

export type Repo = { id: number; fullName: string; private: boolean; pushAccess: boolean };

function isRepo(value: unknown): value is Repo {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "number" &&
    typeof v.fullName === "string" &&
    typeof v.private === "boolean" &&
    typeof v.pushAccess === "boolean"
  );
}

/**
 * 起動時の即時表示（stale-while-revalidate・#101）のため、直近の `/api/repos` 結果を端末内
 * ローカルキャッシュから読み出す。キャッシュ未保存なら null を返す（recentRepos.ts と同じ
 * 堅牢性: 破損 JSON・localStorage 不可でも例外を投げず null に倒す）。
 */
export function loadReposCache(): Repo[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(isRepo);
  } catch {
    return null;
  }
}

/** 最新の `/api/repos` 結果をキャッシュへ保存する（次回起動時の即時表示用）。 */
export function saveReposCache(repos: Repo[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(repos));
  } catch {
    // localStorage 不可(プライベートブラウジング等)でもキャッシュを諦めるだけで機能に影響しない。
  }
}

/** ログアウト・アカウント削除時に呼び出し、別ユーザーのリポジトリ一覧が残らないようにする。 */
export function clearReposCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}
