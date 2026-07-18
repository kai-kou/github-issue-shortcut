const POST_LOGIN_REDIRECT_KEY = "issue-shortcut:post-login-redirect";
/** ログイン試行を中断・キャンセルして後日 "/" を訪れた場合に、無関係な訪問へ古いプレフィルが
 * 復元されてしまわないよう、保存した遷移先を有効とみなす期間（サーバー側の pre-auth Cookie の
 * TTL と同じ 10 分）。 */
const PENDING_REDIRECT_TTL_MS = 10 * 60 * 1000;

export type PrefillParams = { repo: string | null; labels: string[]; title: string | null; body: string | null };

/** `body` と `url` を合成する（B3-4・FR-18）。Web Share Target は `text`（→`body` にマッピング済み）に
 * 共有 URL が入ることが多く `url` は空なことが多いが、両方埋まっている場合は `body` が既に `url` を
 * 含んでいなければ末尾に追記し、URL の重複・欠落を防ぐ。 */
function mergeBodyAndUrl(body: string | null, url: string | null): string | null {
  if (!url) return body;
  if (body && body.includes(url)) return body;
  return body ? `${body}\n\n${url}` : url;
}

/** カンマ区切りの生テキストをラベル配列へ（前後空白・空エントリを除去。C1-1 のショートカット作成
 * ヘルパーのラベル入力欄も同じ形式を使うため共有する）。 */
export function parseCommaList(text: string): string[] {
  return text
    .split(",")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** `/new?repo=&labels=&title=&body=` の URL パラメータから初期選択値を読み取る（B1-2/B3-4・FR-15/FR-18）。
 * labels はカンマ区切り。読み取った値は初期選択にのみ使い、自動送信はしない（FR-19）。 */
export function parsePrefillParams(search: string): PrefillParams {
  const params = new URLSearchParams(search);
  const repo = params.get("repo")?.trim() || null;
  const labelsRaw = params.get("labels")?.trim() ?? "";
  const labels = labelsRaw ? parseCommaList(labelsRaw) : [];
  const title = params.get("title")?.trim() || null;
  const body = mergeBodyAndUrl(params.get("body")?.trim() || null, params.get("url")?.trim() || null);
  return { repo, labels, title, body };
}

export function hasPrefillParams(params: PrefillParams): boolean {
  return Boolean(params.repo || params.labels.length > 0 || params.title || params.body);
}

/** Launch Handler API（`window.launchQueue`）から渡された起動 URL をパス・クエリへ分解する（#98）。
 * WebAPK が既存アプリを `start_url` で再利用起動しクエリを失うケースで、`launchParams.targetURL` から
 * 実際の起動先を復元するために使う。同一オリジンでない値・不正な URL は null（適用しない）。 */
export function parseLaunchTargetUrl(targetURL: string, origin: string): { path: string; search: string } | null {
  try {
    const url = new URL(targetURL, origin);
    if (url.origin !== origin) return null;
    return { path: url.pathname, search: url.search };
  } catch {
    return null;
  }
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
