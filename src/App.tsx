import { useEffect, useMemo, useState } from "react";
import "./App.css";
import TermsOfService from "./pages/TermsOfService";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import { ShortcutHelperPage } from "./shortcuts/ShortcutHelperPage";
import { ShortcutList } from "./shortcuts/ShortcutList";
import { LanguageProvider, useLanguage } from "./i18n/LanguageContext";
import { SUPPORTED_LOCALES } from "./i18n/translations";
import { RepoPicker } from "./repos/RepoPicker";
import { clearAllCachedLabels } from "./issues/repoLabelsCache";
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

type Me = { login: string; avatarUrl: string | null; githubUserId: number };
type AuthState =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "authenticated"; me: Me }
  | { status: "error" };

/** ログイン済みユーザーが GitHub App を 1 件以上インストール済みか（A2-1・FR-4）。未確定は null。 */
type InstallState = boolean | null;

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

type DeleteState = "idle" | "confirming" | "deleting" | "error";

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

function AccountDeletion({ onDeleted }: { onDeleted: () => void }) {
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

interface AuthPanelProps {
  prefill: PrefillParams | null;
  /** ログイン後の復元用に保存する遷移先（`/new?...`）。プレフィルが無ければ null（B1-2・FR-15）。 */
  pendingRedirectTarget: string | null;
}

function AuthPanel({ prefill, pendingRedirectTarget }: AuthPanelProps) {
  const { t } = useLanguage();
  const [auth, setAuth] = useState<AuthState>({ status: "checking" });
  const [installed, setInstalled] = useState<InstallState>(null);
  const [accountDeleted, setAccountDeleted] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/me", { credentials: "same-origin" })
      .then(async (res): Promise<AuthState> => {
        if (res.status === 401) return { status: "anonymous" };
        if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
        const me = (await res.json()) as Me;
        return { status: "authenticated", me };
      })
      .then((next) => {
        if (active) setAuth(next);
      })
      .catch(() => {
        if (active) setAuth({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (auth.status !== "authenticated") return;
    let active = true;
    fetch("/api/installations", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
        return (await res.json()) as { installed: boolean };
      })
      .then((data) => {
        if (active) setInstalled(data.installed);
      })
      .catch(() => {
        // 取得失敗時は誘導を出さない（false negative より安全側: 誤って未インストール表示にしない）。
      });
    return () => {
      active = false;
    };
  }, [auth.status]);

  async function logout() {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
    clearAllCachedLabels();
    window.location.assign("/");
  }

  if (accountDeleted) return <AccountDeletionGuidance />;
  if (auth.status === "checking") return <p className="status-note">{t.auth.checking}</p>;
  if (auth.status === "error") return <p className="status-note">{t.auth.loginError}</p>;
  if (auth.status === "authenticated") {
    return (
      <>
        <p className="user-row">
          {auth.me.avatarUrl ? <img className="user-avatar" src={auth.me.avatarUrl} alt="" /> : null}
          <span className="user-login">
            <small>{t.auth.loggedInAs}</small>
            <strong>{auth.me.login}</strong>
          </span>
          <button type="button" onClick={logout}>
            {t.auth.logoutButton}
          </button>
        </p>
        {installed === false ? <InstallGuidance /> : null}
        {installed === true ? <ShortcutList /> : null}
        {installed === true ? <RepoPicker prefill={prefill} /> : null}
        <AccountDeletion onDeleted={() => setAccountDeleted(true)} />
      </>
    );
  }
  return (
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
  );
}

interface HomeProps {
  prefill: PrefillParams | null;
  pendingRedirectTarget: string | null;
}

function Home({ prefill, pendingRedirectTarget }: HomeProps) {
  const { t } = useLanguage();
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

  return (
    <>
      <div className="hero">
        <h1 className="hero-title">{t.home.title}</h1>
        <p className="hero-tagline">{t.home.tagline}</p>
      </div>
      <AuthPanel prefill={prefill} pendingRedirectTarget={pendingRedirectTarget} />
      <p className="api-status status-note">
        {t.home.apiStatusLabel}: {apiStatusText}
      </p>
    </>
  );
}

function LanguageSwitcher() {
  const { locale, setLocale, t } = useLanguage();

  return (
    <label className="language-switcher">
      {t.languageSwitcher.label}
      <select value={locale} onChange={(e) => setLocale(e.target.value as (typeof SUPPORTED_LOCALES)[number])}>
        {SUPPORTED_LOCALES.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
    </label>
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
  const hasChromeHeader = isLegalPage || isShortcutsPage;

  return (
    <>
      {hasChromeHeader ? (
        <header className="app-header">
          <a className="app-brand" href="/">
            <span className="app-brand-mark" aria-hidden="true">
              ⚡
            </span>
            {t.home.title}
          </a>
        </header>
      ) : null}
      <main className={hasChromeHeader ? "app-main text-page" : "app-main"}>
        {path === "/terms" ? (
          <TermsOfService />
        ) : path === "/privacy" ? (
          <PrivacyPolicy />
        ) : isShortcutsPage ? (
          <ShortcutHelperPage />
        ) : (
          <Home prefill={prefill} pendingRedirectTarget={pendingRedirectTarget} />
        )}
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

function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}

export default App;
