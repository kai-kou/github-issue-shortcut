import type { GitHubLabel } from "./useRepoLabels";

const STORAGE_PREFIX = "issue-shortcut:repo-labels:";

type CachedEntry = { labels: GitHubLabel[] };

function isGitHubLabel(value: unknown): value is GitHubLabel {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as GitHubLabel).name === "string" &&
    typeof (value as GitHubLabel).color === "string"
  );
}

function isCachedEntry(value: unknown): value is CachedEntry {
  return typeof value === "object" && value !== null && Array.isArray((value as CachedEntry).labels) && (value as CachedEntry).labels.every(isGitHubLabel);
}

/** リポジトリごとのラベル一覧を端末内ローカルキャッシュから読み出す（stale-while-revalidate・#102）。
 * キー自体にリポジトリ名を含めるため、リポジトリを切り替えても別リポジトリのラベルと混ざらない。 */
export function loadCachedLabels(repoFullName: string): GitHubLabel[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + repoFullName);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCachedEntry(parsed) ? parsed.labels : null;
  } catch {
    return null;
  }
}

export function saveCachedLabels(repoFullName: string, labels: GitHubLabel[]): void {
  try {
    const entry: CachedEntry = { labels };
    localStorage.setItem(STORAGE_PREFIX + repoFullName, JSON.stringify(entry));
  } catch {
    // localStorage 不可(プライベートブラウジング等)でもラベル取得自体は継続する。
  }
}

/** ログアウト・アカウント削除時に全リポジトリ分のラベルキャッシュを消す（次のユーザーに前ユーザーの
 * ラベルが見えないように・#102 Done Criteria）。 */
export function clearAllCachedLabels(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // 削除に失敗しても致命的ではない。
  }
}
