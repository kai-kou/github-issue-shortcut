import { useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { clearAllCachedLabels } from "../issues/repoLabelsCache";

type DeleteState = "idle" | "confirming" | "deleting" | "error";

/** アプリ内データ（セッション・トークン等）の削除を実行する（A4-3・FR-12）。GitHub 側の連携解除案内は onDeleted 側で表示する。 */
export function AccountDeletion({ onDeleted }: { onDeleted: () => void }) {
  const { t } = useLanguage();
  const [state, setState] = useState<DeleteState>("idle");

  async function handleDelete() {
    setState("deleting");
    try {
      const res = await fetch("/api/account", { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
      clearAllCachedLabels();
      onDeleted();
    } catch {
      setState("error");
    }
  }

  if (state === "confirming" || state === "deleting") {
    return (
      <p className="status-note">
        {t.account.confirmMessage}{" "}
        <button type="button" onClick={handleDelete} disabled={state === "deleting"}>
          {t.account.confirmButton}
        </button>{" "}
        <button type="button" onClick={() => setState("idle")} disabled={state === "deleting"}>
          {t.account.cancelButton}
        </button>
      </p>
    );
  }

  return (
    <p className="status-note">
      <button type="button" className="btn-link-danger" onClick={() => setState("confirming")}>
        {t.account.deleteButton}
      </button>
      {state === "error" ? <span> {t.account.error}</span> : null}
    </p>
  );
}
