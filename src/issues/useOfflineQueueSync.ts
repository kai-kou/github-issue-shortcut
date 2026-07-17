import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import {
  enqueueOfflineIssue,
  loadOfflineQueue,
  markOfflineQueueFailed,
  removeFromOfflineQueue,
  type QueuedIssue,
} from "./offlineQueue";
import { submitErrorCode } from "./submitError";
import { loadDraft, clearDraft } from "./draft";

/** サーバー側のレート制限（10 req/min・#73）に十分な余裕を持たせつつ、キュー滞留を長引かせない間隔。 */
const RETRY_INTERVAL_MS = 2000;

type OptimisticAction = { type: "settle"; id: string; status: "removed" | "failed"; errorCode?: string };

function applyOptimistic(state: QueuedIssue[], action: OptimisticAction): QueuedIssue[] {
  if (action.status === "removed") return state.filter((q) => q.id !== action.id);
  return state.map((q) => (q.id === action.id ? { ...q, status: "failed" as const, errorCode: action.errorCode } : q));
}

/** キュー再送が成功したら、送信した内容と同一の下書き（B5-1）が残っていれば消す（もう不要なため）。
 * repo だけでなく title・body も一致する場合に限定し、ユーザーが同じリポジトリで既に次の
 * 内容を入力し始めていた場合に、その入力中の下書きを誤って消さないようにする。 */
function clearDraftIfMatching(entry: { repo: string; title: string; body: string }): void {
  const draft = loadDraft();
  if (draft && draft.repo === entry.repo && draft.title === entry.title && draft.body === entry.body) {
    clearDraft();
  }
}

/** オフライン時にキューされた起票（B4-2・FR-22・FR-23）を、オンライン復帰後に直列・間隔を空けて
 * 再送する。Service Worker 側の Workbox Background Sync（ページを閉じていても再送・vite.config.ts）
 * と並行して動作する経路で、ページがフォアグラウンドにある間の確実なキュー表示・UI 更新を担う
 * （重複送信は issue_log 照合・B4-3・#70 がサーバー側で吸収するため安全）。 */
export function useOfflineQueueSync() {
  const [queue, setQueue] = useState<QueuedIssue[]>(() => loadOfflineQueue());
  const [optimisticQueue, applyAction] = useOptimistic(queue, applyOptimistic);
  const [, startTransition] = useTransition();
  const flushingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function flush() {
      if (flushingRef.current) return;
      flushingRef.current = true;
      try {
        for (const entry of loadOfflineQueue().filter((q) => q.status === "pending")) {
          if (cancelled || !navigator.onLine) break;
          let res: Response;
          try {
            res = await fetch("/api/issues", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                repo: entry.repo,
                title: entry.title,
                body: entry.body,
                labels: entry.labels,
                clientRequestId: entry.id,
              }),
            });
          } catch {
            // ネットワーク到達不能（まだオフライン）。キューに残し、次の online イベントで再試行する。
            break;
          }
          if (cancelled) break;
          if (res.ok) {
            startTransition(() => applyAction({ type: "settle", id: entry.id, status: "removed" }));
            setQueue(removeFromOfflineQueue(entry.id));
            clearDraftIfMatching(entry);
          } else {
            const code = await submitErrorCode(res);
            // duplicate_submission（409）は直前の同一内容が既に成功済みであることを意味する
            // （B4-3・issue_log 照合）ため、実質的に成功とみなしキューから除去する。
            if (code === "duplicate_submission") {
              startTransition(() => applyAction({ type: "settle", id: entry.id, status: "removed" }));
              setQueue(removeFromOfflineQueue(entry.id));
              clearDraftIfMatching(entry);
            } else {
              // 4xx/5xx は自動再送の対象外とし failed のままキューに残す（#22 の手動再送・破棄を待つ）。
              startTransition(() => applyAction({ type: "settle", id: entry.id, status: "failed", errorCode: code }));
              setQueue(markOfflineQueueFailed(entry.id, code));
            }
          }
          await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
        }
      } finally {
        flushingRef.current = false;
      }
    }

    flush();
    window.addEventListener("online", flush);
    return () => {
      cancelled = true;
      window.removeEventListener("online", flush);
    };
  }, [applyAction]);

  /** ネットワーク到達不能で送信できなかった起票をキューへ積む（呼び出し側は catch 節から使う）。
   * `id` は呼び出し側が最初の送信試行時に発行済みの client_request_id をそのまま渡す（B4-4）。 */
  function enqueue(entry: { id: string; repo: string; title: string; body: string; labels: string[] }) {
    setQueue(enqueueOfflineIssue(entry));
  }

  const pendingCount = optimisticQueue.filter((q) => q.status === "pending").length;
  const failedCount = optimisticQueue.filter((q) => q.status === "failed").length;

  return { queue: optimisticQueue, pendingCount, failedCount, enqueue };
}
