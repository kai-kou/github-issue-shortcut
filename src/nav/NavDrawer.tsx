import { useEffect, useRef, type MouseEvent } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { LanguageSwitcher } from "../i18n/LanguageSwitcher";
import { AccountDeletion } from "../auth/AccountDeletion";
import type { AuthState } from "../auth/useAuthState";
import { savePendingRedirect } from "../issues/prefillParams";

interface NavDrawerProps {
  open: boolean;
  onClose: () => void;
  auth: AuthState;
  /** ログアウト実行（App からは useAuthState().logout を渡す）。 */
  onLogout: () => void;
  /** アカウント削除完了時。App 側で削除後案内（連携解除リンク）を表示する。 */
  onAccountDeleted: () => void;
  /** 未ログイン時のログイン導線でログイン後の復元先として保存する遷移先（無ければ null）。 */
  pendingRedirectTarget: string | null;
}

/** アカウント・ショートカット・設定・情報を集約する左スライドのナビゲーションドロワー。
 * ブラウザ標準の <dialog>（showModal）でフォーカストラップ・Escape・backdrop を賄う（追加ライブラリなし・D-6）。 */
export function NavDrawer({ open, onClose, auth, onLogout, onAccountDeleted, pendingRedirectTarget }: NavDrawerProps) {
  const { t } = useLanguage();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // React の open 状態を <dialog> の showModal/close に同期する（二重呼び出しは例外になるためガードする）。
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // backdrop クリックで閉じる（native <dialog> は既定で backdrop クリックを閉じないため target 判定で補う）。
  // 閉じ操作は必ず dialog.close() を同期的に呼ぶ（Escape と同一経路）。close イベント経由で onClose(state 更新)
  // が走るため、React の再レンダー（children アンマウント）は dialog が閉じた後に起き、フォーカス復帰の
  // 取りこぼし・閉じる瞬間の空フレームを避けられる（RepoPicker の .issue-sheet と同型・#113 レビュー）。
  function handleBackdropClick(e: MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) dialogRef.current?.close();
  }

  return (
    <dialog
      ref={dialogRef}
      className="side-drawer"
      aria-label={t.nav.title}
      onClose={onClose}
      onClick={handleBackdropClick}
    >
      {open ? (
        <div className="side-drawer-body">
          <div className="side-drawer-header">
            <strong className="side-drawer-title">{t.nav.title}</strong>
            <button
              type="button"
              className="side-drawer-close"
              onClick={() => dialogRef.current?.close()}
              aria-label={t.nav.closeMenu}
            >
              ×
            </button>
          </div>

          <section className="drawer-section" aria-labelledby="drawer-account-heading">
            <h2 id="drawer-account-heading" className="drawer-section-title">
              {t.nav.account}
            </h2>
            {auth.status === "checking" ? <p className="status-note">{t.auth.checking}</p> : null}
            {auth.status === "error" ? <p className="status-note">{t.auth.loginError}</p> : null}
            {auth.status === "anonymous" ? (
              <>
                <p className="status-note">{t.nav.notSignedIn}</p>
                <p>
                  <a
                    className="btn-primary"
                    href="/auth/login"
                    onClick={() => {
                      if (pendingRedirectTarget) savePendingRedirect(pendingRedirectTarget);
                    }}
                  >
                    {t.auth.loginButton}
                  </a>
                </p>
              </>
            ) : null}
            {auth.status === "authenticated" ? (
              <>
                <p className="user-row">
                  {auth.me.avatarUrl ? <img className="user-avatar" src={auth.me.avatarUrl} alt="" /> : null}
                  <span className="user-login">
                    <small>{t.auth.loggedInAs}</small>
                    <strong>{auth.me.login}</strong>
                  </span>
                </p>
                <p>
                  <button type="button" onClick={onLogout}>
                    {t.auth.logoutButton}
                  </button>
                </p>
                <AccountDeletion onDeleted={onAccountDeleted} />
              </>
            ) : null}
          </section>

          <section className="drawer-section" aria-labelledby="drawer-shortcuts-heading">
            <h2 id="drawer-shortcuts-heading" className="drawer-section-title">
              {t.nav.shortcuts}
            </h2>
            <a className="drawer-nav-link" href="/shortcuts">
              {t.nav.manageShortcuts}
            </a>
          </section>

          <section className="drawer-section" aria-labelledby="drawer-settings-heading">
            <h2 id="drawer-settings-heading" className="drawer-section-title">
              {t.nav.settings}
            </h2>
            <LanguageSwitcher />
          </section>

          <section className="drawer-section" aria-labelledby="drawer-about-heading">
            <h2 id="drawer-about-heading" className="drawer-section-title">
              {t.nav.about}
            </h2>
            <a className="drawer-nav-link" href="/terms">
              {t.footer.terms}
            </a>
            <a className="drawer-nav-link" href="/privacy">
              {t.footer.privacy}
            </a>
          </section>
        </div>
      ) : null}
    </dialog>
  );
}
