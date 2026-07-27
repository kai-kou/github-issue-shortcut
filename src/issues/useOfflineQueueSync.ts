import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import {
  enqueueOfflineIssue,
  expireStaleOfflineQueue,
  loadOfflineQueue,
  markOfflineQueueFailed,
  QUEUE_EXPIRED_ERROR_CODE,
  removeFromOfflineQueue,
  type QueuedIssue,
} from "./offlineQueue";
import { apiFetch } from "../auth/apiFetch";
import { claimRequestId, releaseRequestId } from "./sentRequestIds";
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

type PostOutcome =
  | { outcome: "success" }
  | { outcome: "duplicate" }
  | { outcome: "network-error" }
  | { outcome: "failed"; code: string };

/** キュー1件分の送信を試みる（自動再送・手動再送の両方から呼ぶ共通経路）。*/
async function postQueuedEntry(entry: QueuedIssue): Promise<PostOutcome> {
  // 同じ client_request_id の再送が別経路（他タブ・Service Worker）で走っていないかを端末内で
  // 確認してから送る（B4-4・OQ-8・P3 でサーバーの request_ids から移設）。予約できなければ
  // その送信は既に担当済みなので、実質的に成功（duplicate）として扱いキューから外す。
  if (!(await claimRequestId(entry.id))) return { outcome: "duplicate" };
  let res: Response;
  try {
    res = await apiFetch("/api/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: entry.repo, title: entry.title, body: entry.body, labels: entry.labels }),
    });
  } catch {
    // ネットワーク到達不能（まだオフライン）。次の再送を通すため予約を解放する。
    await releaseRequestId(entry.id);
    return { outcome: "network-error" };
  }
  if (res.ok) return { outcome: "success" };
  // 4xx/5xx は GitHub 側で作成されていないため、手動再送（D2-1）を通すために解放する。
  await releaseRequestId(entry.id);
  return { outcome: "failed", code: await submitErrorCode(res) };
}

/** オフライン時にキューされた起票（B4-2・FR-22・FR-23）を、オンライン復帰後に直列・間隔を空けて
 * 再送する。Service Worker 側の Workbox Background Sync（ページを閉じていても再送・vite.config.ts）
 * と並行して動作する経路で、ページがフォアグラウンドにある間の確実なキュー表示・UI 更新を担う
 * （経路をまたぐ重複送信は `sentRequestIds.ts` の端末内予約が吸収する・P3）。 */
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
        // 滞留が長すぎる pending は自動再送せず failed（queue_expired）へ落とす（#91）。サーバー側の
        // 重複防止窓（26h）が切れた後に同じ client_request_id で送ると、既に作成済みの Issue を
        // もう一度作りかねないため、ここから先はユーザーの確認（D2-1 の一覧）に委ねる。
        const { queue: current, expiredIds } = expireStaleOfflineQueue();
        if (expiredIds.length > 0) {
          startTransition(() => {
            for (const id of expiredIds) {
              applyAction({ type: "settle", id, status: "failed", errorCode: QUEUE_EXPIRED_ERROR_CODE });
            }
          });
          setQueue(current);
        }
        for (const entry of current.filter((q) => q.status === "pending")) {
          if (cancelled || !navigator.onLine) break;
          const result = await postQueuedEntry(entry);
          if (cancelled) break;
          if (result.outcome === "network-error") {
            // まだオフライン。キューに残し、次の online イベントで再試行する。
            break;
          }
          if (result.outcome === "success" || result.outcome === "duplicate") {
            startTransition(() => applyAction({ type: "settle", id: entry.id, status: "removed" }));
            setQueue(removeFromOfflineQueue(entry.id));
            clearDraftIfMatching(entry);
          } else {
            // 4xx/5xx は自動再送の対象外とし failed のままキューに残す（#22 の手動再送・破棄を待つ）。
            startTransition(() => applyAction({ type: "settle", id: entry.id, status: "failed", errorCode: result.code }));
            setQueue(markOfflineQueueFailed(entry.id, result.code));
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

  /** failed のキュー項目を手動で再送する（D2-1・#22。4xx/5xx は自動再送の対象外のためユーザー操作が起点）。 */
  async function resend(id: string) {
    const entry = loadOfflineQueue().find((q) => q.id === id);
    if (!entry) return;
    const result = await postQueuedEntry(entry);
    if (result.outcome === "success" || result.outcome === "duplicate") {
      startTransition(() => applyAction({ type: "settle", id, status: "removed" }));
      setQueue(removeFromOfflineQueue(id));
      clearDraftIfMatching(entry);
    } else if (result.outcome === "failed") {
      startTransition(() => applyAction({ type: "settle", id, status: "failed", errorCode: result.code }));
      setQueue(markOfflineQueueFailed(id, result.code));
    }
    // network-error（まだオフライン）は状態を変えず failed のまま残す。
  }

  /** failed のキュー項目を破棄する（D2-1・#22）。呼び出し側で確認 UI を挟む想定。 */
  function discard(id: string) {
    startTransition(() => applyAction({ type: "settle", id, status: "removed" }));
    setQueue(removeFromOfflineQueue(id));
  }

  const pendingCount = optimisticQueue.filter((q) => q.status === "pending").length;
  const failedCount = optimisticQueue.filter((q) => q.status === "failed").length;
  const failedItems = optimisticQueue.filter((q) => q.status === "failed");

  return { queue: optimisticQueue, pendingCount, failedCount, failedItems, enqueue, resend, discard };
}
