import { useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { submitErrorMessage } from "./submitError";
import type { QueuedIssue } from "./offlineQueue";

interface OfflineQueueListProps {
  items: QueuedIssue[];
  onResend: (id: string) => Promise<void>;
  onDiscard: (id: string) => void;
}

/** 4xx/5xx で自動再送の対象外になった起票の手動救済導線（D2-1・#22）。
 * Background Sync / クライアント側自動再送は pending のみを対象にするため、
 * failed はここでの手動操作でのみ再送・破棄できる。 */
export function OfflineQueueList({ items, onResend, onDiscard }: OfflineQueueListProps) {
  const { t } = useLanguage();
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [confirmingDiscardId, setConfirmingDiscardId] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function handleResend(id: string) {
    setResendingId(id);
    try {
      await onResend(id);
    } finally {
      setResendingId((current) => (current === id ? null : current));
    }
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
          ) : (
            <div className="offline-queue-item-actions">
              <button type="button" onClick={() => handleResend(item.id)} disabled={resendingId === item.id}>
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
