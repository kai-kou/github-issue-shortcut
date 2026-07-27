const STORAGE_KEY = "issue-shortcut:offline-queue";

/** ネットワーク到達不能時にキューされた起票（B4-2・FR-22）。`failed` はサーバーから 4xx/5xx が
 * 返り自動再送の対象外になったもので、手動での再送・破棄（D2-1・#22）を待つ状態を表す。 */
export type QueueStatus = "pending" | "failed";

/** キュー滞留の上限（24 時間）。Service Worker 側の Background Sync 保持期間
 * （`vite.config.ts` の `maxRetentionTime: 24 * 60` 分）と揃え、client_request_id の重複防止窓
 * （`sentRequestIds.ts` の `SENT_REQUEST_ID_WINDOW_MS` = 26 時間・P3 で端末内へ移設）より短く取る。
 *
 * 重複防止窓より長いと、「別経路（他タブ・SW）が既に送信して Issue が作られたが、その結果が
 * このキューに反映されないまま滞留し、26 時間の予約が stale になった後に同じ client_request_id で
 * 自動再送されて重複起票される」経路が開く（#91）。この値は必ず 26 時間より短く保つこと。 */
export const OFFLINE_QUEUE_TTL_MS = 24 * 60 * 60 * 1000;

/** TTL 超過で自動再送を打ち切ったエントリのエラーコード（`submitErrorMessage` が専用文言へ振り分ける）。 */
export const QUEUE_EXPIRED_ERROR_CODE = "queue_expired";

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
  /** TTL 超過で自動再送を打ち切ったことを表す永続フラグ（#91）。`errorCode` は「直近の送信試行の
   * 結果」で上書きされるため、手動再送が別の理由（429 等）で失敗すると `queue_expired` の記録が
   * 消えてしまう。期限切れは恒久的な分類なので outcome とは独立のフィールドで保持し、手動再送の
   * 確認ステップ（重複起票の警告）が二度目以降も必ず出るようにする。 */
  expired?: boolean;
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

/** TTL 超過（= もう自動再送してはいけない）判定。localStorage 非依存の純関数（ユニットテスト対象）。 */
export function isOfflineQueueEntryExpired(entry: QueuedIssue, now: number): boolean {
  return now - entry.queuedAt >= OFFLINE_QUEUE_TTL_MS;
}

/** pending のうち TTL 超過分を failed（`queue_expired`）へ落とした結果を返す純関数。
 * 期限切れを自動再送の対象から外し、ユーザーの手動確認（D2-1 の一覧・再送 / 破棄）へ委ねることで、
 * サーバー側の重複防止窓が切れた後の重複起票を防ぐ（#91）。 */
export function expireStaleEntries(
  queue: QueuedIssue[],
  now: number,
): { queue: QueuedIssue[]; expiredIds: string[] } {
  const expiredIds: string[] = [];
  const next = queue.map((entry) => {
    if (entry.status !== "pending" || !isOfflineQueueEntryExpired(entry, now)) return entry;
    expiredIds.push(entry.id);
    return { ...entry, status: "failed" as const, errorCode: QUEUE_EXPIRED_ERROR_CODE, expired: true };
  });
  return expiredIds.length > 0 ? { queue: next, expiredIds } : { queue, expiredIds };
}

/** 保存済みキューへ TTL を適用し、期限切れがあれば永続化する（自動再送の直前に呼ぶ）。 */
export function expireStaleOfflineQueue(now: number = Date.now()): {
  queue: QueuedIssue[];
  expiredIds: string[];
} {
  const result = expireStaleEntries(loadOfflineQueue(), now);
  if (result.expiredIds.length > 0) persist(result.queue);
  return result;
}

/** 再送で 4xx/5xx が返った場合、自動再送の対象から外し failed としてキューに残す（#22 の一覧・再送・破棄を待つ）。 */
export function markOfflineQueueFailed(id: string, errorCode: string): QueuedIssue[] {
  const next = loadOfflineQueue().map((q) => (q.id === id ? { ...q, status: "failed" as const, errorCode } : q));
  persist(next);
  return next;
}
