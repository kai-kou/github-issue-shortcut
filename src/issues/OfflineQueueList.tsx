import { useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { submitErrorMessage } from "./submitError";
import { QUEUE_EXPIRED_ERROR_CODE, type QueuedIssue } from "./offlineQueue";

interface OfflineQueueListProps {
  items: QueuedIssue[];
  onResend: (id: string) => Promise<void>;
  onDiscard: (id: string) => void;
}

/** 4xx/5xx で自動再送の対象外になった起票の手動救済導線（D2-1・#22）。
 * 自動再送（`useOfflineQueueSync`）は pending のみを対象にするため、
 * failed はここでの手動操作でのみ再送・破棄できる。 */
export function OfflineQueueList({ items, onResend, onDiscard }: OfflineQueueListProps) {
  const { t } = useLanguage();
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [confirmingDiscardId, setConfirmingDiscardId] = useState<string | null>(null);
  const [confirmingResendId, setConfirmingResendId] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function handleResend(id: string) {
    setResendingId(id);
    try {
      await onResend(id);
    } finally {
      setResendingId((current) => (current === id ? null : current));
    }
  }

  /** TTL 超過で自動再送を打ち切った項目（#91）は、端末内の重複防止窓（26 時間）も切れているため
   * 手動再送で重複起票しうる。ワンタップで送らず確認を挟み、利用者が「GitHub 側に作成済みでないか
   * 確認した」うえで送る形にする（4xx/5xx で失敗した項目は従来どおりワンタップ再送）。
   *
   * 判定には `errorCode` ではなく永続フラグ `expired` を使う。`errorCode` は手動再送の結果
   * （429 等）で上書きされるため、それに依存すると 2 回目以降の再送で確認が出なくなる。
   * `errorCode` も併せて見るのは、本フラグ導入前に端末へ保存されたキューへの後方互換。 */
  function requestResend(item: QueuedIssue) {
    if (item.expired === true || item.errorCode === QUEUE_EXPIRED_ERROR_CODE) {
      setConfirmingResendId(item.id);
      return;
    }
    void handleResend(item.id);
  }

  return (
    <ul className="offline-queue-list" aria-label={t.repoPicker.offlineQueueFailed}>
      {items.map((item) => (
        <li key={item.id} className="offline-queue-item">
          <div className="offline-queue-item-body">
            <p className="offline-queue-item-title">{item.title}</p>
            <p className="offline-queue-item-error">{submitErrorMessage(item.errorCode ?? "upstream_failed", t)}</p>
          </div>
          {confirmingDiscardId === item.id ? (
            <p className="offline-queue-item-confirm">
              {t.repoPicker.offlineQueueDiscardConfirmMessage}{" "}
              <button
                type="button"
                className="btn-link-danger"
                onClick={() => {
                  setConfirmingDiscardId(null);
                  onDiscard(item.id);
                }}
              >
                {t.repoPicker.offlineQueueDiscardConfirmButton}
              </button>{" "}
              <button type="button" onClick={() => setConfirmingDiscardId(null)}>
                {t.repoPicker.offlineQueueDiscardCancelButton}
              </button>
            </p>
          ) : confirmingResendId === item.id ? (
            <p className="offline-queue-item-confirm">
              {t.repoPicker.offlineQueueResendConfirmMessage}{" "}
              <button
                type="button"
                onClick={() => {
                  setConfirmingResendId(null);
                  void handleResend(item.id);
                }}
              >
                {t.repoPicker.offlineQueueResendConfirmButton}
              </button>{" "}
              {/* キャンセル文言は破棄確認と同一のため既存キーを共有する。 */}
              <button type="button" onClick={() => setConfirmingResendId(null)}>
                {t.repoPicker.offlineQueueDiscardCancelButton}
              </button>
            </p>
          ) : (
            <div className="offline-queue-item-actions">
              <button type="button" onClick={() => requestResend(item)} disabled={resendingId === item.id}>
                {resendingId === item.id ? t.repoPicker.offlineQueueResendingLabel : t.repoPicker.offlineQueueResendButton}
              </button>
              <button type="button" className="btn-link-danger" onClick={() => setConfirmingDiscardId(item.id)}>
                {t.repoPicker.offlineQueueDiscardButton}
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
