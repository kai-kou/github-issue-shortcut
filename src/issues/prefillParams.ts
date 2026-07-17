const POST_LOGIN_REDIRECT_KEY = "issue-shortcut:post-login-redirect";
/** ログイン試行を中断・キャンセルして後日 "/" を訪れた場合に、無関係な訪問へ古いプレフィルが
 * 復元されてしまわないよう、保存した遷移先を有効とみなす期間（サーバー側の pre-auth Cookie の
 * TTL と同じ 10 分）。 */
const PENDING_REDIRECT_TTL_MS = 10 * 60 * 1000;

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

type PendingRedirect = { target: string; savedAt: number };

/** 未ログイン状態で `/new` からログインへ遷移する直前に、復元用の遷移先を保存する（FR-15）。 */
export function savePendingRedirect(pathWithSearch: string): void {
  try {
    const entry: PendingRedirect = { target: pathWithSearch, savedAt: Date.now() };
    sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, JSON.stringify(entry));
  } catch {
    // sessionStorage 不可（プライベートブラウジング等）でもログイン自体は継続する。
  }
}

/** ログイン完了後の初回描画で、保存済みの遷移先があれば取り出す（1 度読んだら消費する）。
 * ログインを中断・キャンセルした後日に "/" を訪れた場合など、TTL 超過分は復元しない。 */
export function consumePendingRedirect(): string | null {
  try {
    const raw = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
    const entry = JSON.parse(raw) as Partial<PendingRedirect>;
    if (typeof entry.target !== "string" || typeof entry.savedAt !== "number") return null;
    if (Date.now() - entry.savedAt > PENDING_REDIRECT_TTL_MS) return null;
    return entry.target;
  } catch {
    return null;
  }
}
