const POST_LOGIN_REDIRECT_KEY = "issue-shortcut:post-login-redirect";

export type PrefillParams = { repo: string | null; labels: string[]; title: string | null };

/** `/new?repo=&labels=&title=` の URL パラメータから初期選択値を読み取る（B1-2・FR-15）。
 * labels はカンマ区切り。読み取った値は初期選択にのみ使い、自動送信はしない（FR-19）。 */
export function parsePrefillParams(search: string): PrefillParams {
  const params = new URLSearchParams(search);
  const repo = params.get("repo")?.trim() || null;
  const labelsRaw = params.get("labels")?.trim() ?? "";
  const labels = labelsRaw
    ? labelsRaw
        .split(",")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
    : [];
  const title = params.get("title")?.trim() || null;
  return { repo, labels, title };
}

export function hasPrefillParams(params: PrefillParams): boolean {
  return Boolean(params.repo || params.labels.length > 0 || params.title);
}

/** 未ログイン状態で `/new` からログインへ遷移する直前に、復元用の遷移先を保存する（FR-15）。 */
export function savePendingRedirect(pathWithSearch: string): void {
  try {
    sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, pathWithSearch);
  } catch {
    // sessionStorage 不可（プライベートブラウジング等）でもログイン自体は継続する。
  }
}

/** ログイン完了後の初回描画で、保存済みの遷移先があれば取り出す（1 度読んだら消費する）。 */
export function consumePendingRedirect(): string | null {
  try {
    const pending = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
    if (pending) sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
    return pending;
  } catch {
    return null;
  }
}
