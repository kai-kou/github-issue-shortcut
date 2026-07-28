import { useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { clearAllLocalUserData } from "./useAuthState";
import { apiFetch } from "./apiFetch";

type DeleteState = "idle" | "confirming" | "deleting" | "error";

/**
 * アカウント削除を実行する（A4-3・FR-12）。サーバーは個人データを保持しないため（P2）、削除の実体は
 * 「トークン Cookie の破棄 + 端末内データの削除 + GitHub 側のトークン失効」。
 * GitHub 側の連携解除案内は onDeleted 側で表示する。
 */
export function AccountDeletion({ onDeleted }: { onDeleted: () => void }) {
  const { t } = useLanguage();
  const [state, setState] = useState<DeleteState>("idle");

  async function handleDelete() {
    setState("deleting");
    try {
      const res = await apiFetch("/api/account", { method: "DELETE" });
      if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
      // 端末内に残るデータを **未送信の下書き・オフラインキューまで含めて** 全消去する（#181）。
      // ショートカット設定は P1 で正本が localStorage へ移っており、削除の主役はこちら側にある
      // （サーバー側は GitHub トークンの失効と Cookie 破棄を /api/account が行う。P3 以降サーバーに削除対象は無い）。
      // 呼び出し側のハンドラではなくここで消す: この UI が「未送信分も削除されます」と表示している以上、
      // 実際に消す責任も同じ場所に置かないと、別画面へ再利用したときに表示だけが残る。
      clearAllLocalUserData();
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
