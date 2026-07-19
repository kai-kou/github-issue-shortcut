import { useEffect, useMemo, useState } from "react";
import "./App.css";
import TermsOfService from "./pages/TermsOfService";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import { ShortcutHelperPage } from "./shortcuts/ShortcutHelperPage";
import { ShortcutList } from "./shortcuts/ShortcutList";
import { LanguageProvider, useLanguage } from "./i18n/LanguageContext";
import { LanguageSwitcher } from "./i18n/LanguageSwitcher";
import { RepoPicker } from "./repos/RepoPicker";
import { useAuthState, clearAllUserCaches, type AuthState } from "./auth/useAuthState";
import { NavDrawer } from "./nav/NavDrawer";
import {
  consumePendingRedirect,
  hasPrefillParams,
  parseLaunchTargetUrl,
  parsePrefillParams,
  savePendingRedirect,
  type PrefillParams,
} from "./issues/prefillParams";

type ApiStatus = "checking" | "unreachable" | string;

/** GitHub App の Public installation ページ（App slug "issue-shortcut"・#9 で登録済み）。 */
const APP_INSTALL_URL = "https://github.com/apps/issue-shortcut/installations/new";
/** GitHub 側で App インストール/連携を管理する画面（アカウント削除後の連携解除案内・A4-3・FR-12）。 */
const GITHUB_INSTALLATIONS_URL = "https://github.com/settings/installations";

function InstallGuidance() {
  const { t } = useLanguage();
  return (
    <div className="card">
      <p>
        <strong>{t.install.title}</strong>
      </p>
      <p>{t.install.body}</p>
      <p>
        <a className="btn-primary" href={APP_INSTALL_URL}>
          {t.install.cta}
        </a>
      </p>
      <p className="status-note">{t.install.orgNotice}</p>
    </div>
  );
}

function AccountDeletionGuidance() {
  const { t } = useLanguage();
  return (
    <div className="card">
      <p>{t.account.deleted}</p>
      <p>
        <a href={GITHUB_INSTALLATIONS_URL}>{t.account.revokeCta}</a>
      </p>
      <p>
        <a href="/">{t.account.backHome}</a>
      </p>
    </div>
  );
}

interface HomeViewProps {
  prefill: PrefillParams | null;
  /** ログイン後の復元用に保存する遷移先（`/new?...`）。プレフィルが無ければ null（B1-2・FR-15）。 */
  pendingRedirectTarget: string | null;
}

/** ホーム画面。トップバー（ハンバーガー + ブランド + アカウントチップ）・メイン（起票フロー）・
 * サイドパネル（アカウント/設定を集約）を束ねる。認証状態は useAuthState で 1 度だけ取得し双方で共有する。 */
function HomeView({ prefill, pendingRedirectTarget }: HomeViewProps) {
  const { t } = useLanguage();
  const { auth, installed, logout } = useAuthState();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountDeleted, setAccountDeleted] = useState(false);
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
        return res.json() as Promise<{ status: string }>;
      })
      .then((data) => setApiStatus(data.status))
      .catch(() => setApiStatus("unreachable"));
  }, []);

  const apiStatusText =
    apiStatus === "checking"
      ? t.home.apiStatusChecking
      : apiStatus === "unreachable"
        ? t.home.apiStatusUnreachable
        : apiStatus;

  const showAccountChip = auth.status === "authenticated" && !accountDeleted;
  // アカウント削除後はローカルの認証状態を匿名扱いにマスクし、ドロワーに stale なアカウント情報
  // （削除済みユーザー名・再度の削除ボタン）を再表示させない（削除完了の終端は AccountDeletionGuidance）。
  const effectiveAuth: AuthState = accountDeleted ? { status: "anonymous" } : auth;

  return (
    <>
      <header className="app-bar">
        <button type="button" className="menu-trigger" onClick={() => setMenuOpen(true)} aria-label={t.nav.openMenu}>
          <span aria-hidden="true">☰</span>
        </button>
        <a className="app-brand" href="/">
          <span className="app-brand-mark" aria-hidden="true">
            ⚡
          </span>
          <span className="app-brand-text">{t.home.title}</span>
        </a>
        <span className="app-bar-spacer" />
        {showAccountChip ? (
          // アクセシブル名はチップ内のユーザー名（アバターは装飾）。ハンバーガー（メニューを開く）と
          // 名前が重複せず、ログイン中のユーザー名を SR にも伝えられる。
          <button type="button" className="account-chip" onClick={() => setMenuOpen(true)}>
            {auth.me.avatarUrl ? <img className="account-chip-avatar" src={auth.me.avatarUrl} alt="" /> : null}
            <span className="account-chip-login">{auth.me.login}</span>
          </button>
        ) : null}
      </header>

      <main className="app-main">
        {accountDeleted ? (
          <AccountDeletionGuidance />
        ) : (
          <>
            {/* ページ主題を示す h1 を常に 1 つだけ存在させる（見出しジャンプでの巡回・a11y）。
                匿名時は可視ヒーロー内、認証済み時は視覚的に隠した h1（起票フローを最上部に保つため）。 */}
            {auth.status === "authenticated" ? <h1 className="sr-only">{t.home.title}</h1> : null}
            {auth.status !== "authenticated" ? (
              <div className="hero">
                <h1 className="hero-title">{t.home.title}</h1>
                <p className="hero-tagline">{t.home.tagline}</p>
              </div>
            ) : null}

            {auth.status === "checking" ? <p className="status-note">{t.auth.checking}</p> : null}
            {auth.status === "error" ? <p className="status-note">{t.auth.loginError}</p> : null}
            {auth.status === "anonymous" ? (
              <p className="hero-cta">
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
            ) : null}
            {auth.status === "authenticated" && installed === false ? <InstallGuidance /> : null}
            {auth.status === "authenticated" && installed === true ? (
              <>
                <ShortcutList userId={auth.me.githubUserId} />
                <RepoPicker prefill={prefill} userId={auth.me.githubUserId} />
              </>
            ) : null}

            <p className="api-status status-note">
              {t.home.apiStatusLabel}: {apiStatusText}
            </p>
          </>
        )}
      </main>

      <NavDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        auth={effectiveAuth}
        onLogout={logout}
        onAccountDeleted={() => {
          // 別ユーザーが同一端末で再ログインした際に古い一覧が残らないよう SWR キャッシュを全消去する
          // （#101・リポジトリ/ショートカット/ラベル。旧 AuthPanel からの回帰防止）。
          clearAllUserCaches();
          setAccountDeleted(true);
          setMenuOpen(false);
        }}
        pendingRedirectTarget={pendingRedirectTarget}
      />
    </>
  );
}

function AppContent() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [search, setSearch] = useState(() => window.location.search);
  const { t } = useLanguage();

  // /auth/callback は常に "/" へ戻すため、未ログイン時に `/new?...` から離脱していた場合は
  // ここで遷移先を復元する（B1-2・FR-15「未ログイン時はログイン後に復元」）。
  useEffect(() => {
    if (window.location.pathname !== "/") return;
    const pending = consumePendingRedirect();
    if (!pending) return;
    window.history.replaceState(null, "", pending);
    const restored = new URL(pending, window.location.origin);
    setPath(restored.pathname);
    setSearch(restored.search);
  }, []);

  // WebAPK が既存アプリを再利用起動すると location は start_url（"/"）のままになり、ホーム画面に
  // 手動追加した `/new?...` ショートカットのクエリが失われる（#98）。Launch Handler API
  // （navigate-existing・vite.config.ts）経由で実際の起動 URL を受け取り復元する。ログイン状態を
  // 問わず動作するため、上記の匿名限定 pendingRedirect 復元とは独立した経路として扱う。
  useEffect(() => {
    const launchQueue = window.launchQueue;
    if (!launchQueue) return;
    launchQueue.setConsumer((launchParams) => {
      if (!launchParams.targetURL) return;
      const target = parseLaunchTargetUrl(launchParams.targetURL, window.location.origin);
      if (!target) return;
      if (target.path === window.location.pathname && target.search === window.location.search) return;
      window.history.replaceState(null, "", `${target.path}${target.search}`);
      setPath(target.path);
      setSearch(target.search);
    });
  }, []);

  const prefill = useMemo(() => (path === "/new" ? parsePrefillParams(search) : null), [path, search]);
  const pendingRedirectTarget = prefill && hasPrefillParams(prefill) ? `${path}${search}` : null;

  const isLegalPage = path === "/terms" || path === "/privacy";
  const isShortcutsPage = path === "/shortcuts";
  const isSubPage = isLegalPage || isShortcutsPage;

  // サブページ（規約 / プライバシー / ショートカット作成ヘルパー）はドキュメント型レイアウト
  // （戻るヘッダー + フッター）。ホームはアプリシェル型（トップバー + サイドパネル）で描画する。
  if (isSubPage) {
    return (
      <>
        <header className="app-header">
          <a className="app-brand" href="/">
            <span className="app-brand-mark" aria-hidden="true">
              ⚡
            </span>
            {t.home.title}
          </a>
        </header>
        <main className="app-main text-page">
          {isShortcutsPage ? <ShortcutHelperPage /> : path === "/terms" ? <TermsOfService /> : <PrivacyPolicy />}
        </main>
        <footer className="app-footer">
          <a href="/shortcuts">{t.footer.shortcuts}</a>
          <a href="/terms">{t.footer.terms}</a>
          <a href="/privacy">{t.footer.privacy}</a>
          <span className="app-footer-spacer" />
          <LanguageSwitcher />
        </footer>
      </>
    );
  }

  return <HomeView prefill={prefill} pendingRedirectTarget={pendingRedirectTarget} />;
}

function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}

export default App;
