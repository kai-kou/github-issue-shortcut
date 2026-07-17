const STORAGE_KEY = "issue-shortcut:offline-queue";

/** ネットワーク到達不能時にキューされた起票（B4-2・FR-22）。`failed` はサーバーから 4xx/5xx が
 * 返り自動再送の対象外になったもので、手動での再送・破棄（D2-1・#22）を待つ状態を表す。 */
export type QueueStatus = "pending" | "failed";

export type QueuedIssue = {
  /** キュー管理用 ID。最初の送信試行時に発行し、SW 側 Background Sync・クライアント側再送の
   * 双方で同じ値を送り続けることで、サーバー側の長時間窓の重複防止（B4-4・OQ-8）に使う
   * client_request_id を兼ねる。 */
  id: string;
  repo: string;
  title: string;
  body: string;
  labels: string[];
  queuedAt: number;
  status: QueueStatus;
  /** status が failed のときのエラーコード（B5-2 の分類・upstream_failed 等）。 */
  errorCode?: string;
};

function isQueuedIssue(value: unknown): value is QueuedIssue {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.repo === "string" &&
    typeof v.title === "string" &&
    typeof v.body === "string" &&
    Array.isArray(v.labels) &&
    v.labels.every((l) => typeof l === "string") &&
    typeof v.queuedAt === "number" &&
    (v.status === "pending" || v.status === "failed")
  );
}

export function loadOfflineQueue(): QueuedIssue[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isQueuedIssue) : [];
  } catch {
    return [];
  }
}

function persist(queue: QueuedIssue[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage 不可(プライベートブラウジング等)でも送信自体は継続する（draft.ts と同方針）。
  }
}

/** オフライン（ネットワーク到達不能）による送信失敗をキューへ積む。`id` は最初の送信試行時に
 * 発行済みの client_request_id を呼び出し側から渡す（SW キューとの重複防止キーを合わせるため・B4-4）。 */
export function enqueueOfflineIssue(entry: Omit<QueuedIssue, "queuedAt" | "status">): QueuedIssue[] {
  const queued: QueuedIssue = { ...entry, queuedAt: Date.now(), status: "pending" };
  const next = [...loadOfflineQueue(), queued];
  persist(next);
  return next;
}

export function removeFromOfflineQueue(id: string): QueuedIssue[] {
  const next = loadOfflineQueue().filter((q) => q.id !== id);
  persist(next);
  return next;
}

/** 再送で 4xx/5xx が返った場合、自動再送の対象から外し failed としてキューに残す（#22 の一覧・再送・破棄を待つ）。 */
export function markOfflineQueueFailed(id: string, errorCode: string): QueuedIssue[] {
  const next = loadOfflineQueue().map((q) => (q.id === id ? { ...q, status: "failed" as const, errorCode } : q));
  persist(next);
  return next;
}
