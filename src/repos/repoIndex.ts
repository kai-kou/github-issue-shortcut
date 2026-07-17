/** `#repo` スマート入力トークン（B3-3）の照合用インデックス。フルネーム（`owner/repo`）と、
 * 一意に定まる場合の短縮名（`repo` 部分のみ）の両方をキーにして完全一致で引けるようにする。
 * 短縮名が複数リポジトリで衝突する場合はあいまいさを避けるため短縮名エントリを作らない
 * （フルネームでの指定のみ有効・YAGNI）。 */
export function buildRepoIndex(repos: { fullName: string }[]): Map<string, string> {
  const shortNameCounts = new Map<string, number>();
  for (const repo of repos) {
    const shortName = repo.fullName.split("/")[1]?.toLowerCase();
    if (shortName) shortNameCounts.set(shortName, (shortNameCounts.get(shortName) ?? 0) + 1);
  }

  const index = new Map<string, string>();
  for (const repo of repos) {
    index.set(repo.fullName.toLowerCase(), repo.fullName);
    const shortName = repo.fullName.split("/")[1]?.toLowerCase();
    if (shortName && shortNameCounts.get(shortName) === 1) index.set(shortName, repo.fullName);
  }
  return index;
}
