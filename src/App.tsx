import { useEffect, useState } from "react";
import "./App.css";
import TermsOfService from "./pages/TermsOfService";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import { LanguageProvider, useLanguage } from "./i18n/LanguageContext";
import { SUPPORTED_LOCALES } from "./i18n/translations";

type ApiStatus = "checking" | "unreachable" | string;

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
