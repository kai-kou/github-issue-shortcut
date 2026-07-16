const STORAGE_KEY = "issue-shortcut:draft";

/** アプリ全体で保持する下書きは常に 1 件のみ（YAGNI・複数リポジトリの下書きを同時保持する要件なし）。
 * 別リポジトリに切り替えて入力すると、切替前の下書きは上書きされる。 */
export type Draft = { repo: string; title: string; body: string };

function isDraft(value: unknown): value is Draft {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Draft).repo === "string" &&
    typeof (value as Draft).title === "string" &&
    typeof (value as Draft).body === "string"
  );
}

/** 送信失敗・中断時に端末へ保持した起票の下書きを読み出す（B5-1・NFR-10）。 */
export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDraft(draft: Draft): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // localStorage 不可(プライベートブラウジング等)でも入力自体は継続する。
  }
}

/** 送信成功時に下書きをクリアする（B5-1 Done Criteria）。 */
export function clearDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 削除に失敗しても致命的ではない。
  }
}
