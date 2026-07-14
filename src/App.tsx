import { useEffect, useState } from "react";
import "./App.css";
import TermsOfService from "./pages/TermsOfService";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import { LanguageProvider, useLanguage } from "./i18n/LanguageContext";
import { SUPPORTED_LOCALES } from "./i18n/translations";

type ApiStatus = "checking" | "unreachable" | string;

type Me = { login: string; avatarUrl: string | null; githubUserId: number };
type AuthState =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "authenticated"; me: Me }
  | { status: "error" };

function AuthPanel() {
  const { t } = useLanguage();
  const [auth, setAuth] = useState<AuthState>({ status: "checking" });

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

  async function logout() {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
    window.location.assign("/");
  }

  if (auth.status === "checking") return <p>{t.auth.checking}</p>;
  if (auth.status === "error") return <p>{t.auth.loginError}</p>;
  if (auth.status === "authenticated") {
    return (
      <p>
        {t.auth.loggedInAs}: <strong>{auth.me.login}</strong>{" "}
        <button type="button" onClick={logout}>
          {t.auth.logoutButton}
        </button>
      </p>
    );
  }
  return (
    <p>
      <a href="/auth/login">{t.auth.loginButton}</a>
    </p>
  );
}

function Home() {
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
      <h1>{t.home.title}</h1>
      <p>{t.home.hello}</p>
      <p>
        {t.home.apiStatusLabel}: {apiStatusText}
      </p>
      <AuthPanel />
    </>
  );
}

function LanguageSwitcher() {
  const { locale, setLocale, t } = useLanguage();

  return (
    <label>
      {t.languageSwitcher.label}:{" "}
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
  const path = window.location.pathname;
  const { t } = useLanguage();

  return (
    <>
      {path === "/terms" ? (
        <TermsOfService />
      ) : path === "/privacy" ? (
        <PrivacyPolicy />
      ) : (
        <Home />
      )}
      <footer>
        <a href="/terms">{t.footer.terms}</a> / <a href="/privacy">{t.footer.privacy}</a>
        <div>
          <LanguageSwitcher />
        </div>
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
