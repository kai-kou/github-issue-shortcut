import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { translations, type Locale, type Translations } from "./translations";
import { isSupportedLocale, pickLocale } from "./detectLocale";

const STORAGE_KEY = "issue-shortcut:locale";

function detectInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isSupportedLocale(stored)) return stored;
  } catch {
    // localStorage 不可（プライベートブラウジング等）。ブラウザ言語検出にフォールバック。
  }
  return pickLocale(navigator.languages ?? [navigator.language]);
}

interface LanguageContextValue {
  locale: Locale;
  t: Translations;
  setLocale: (locale: Locale) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // localStorage 不可（プライベートブラウジング等）。永続化なしで継続。
    }
  }, [locale]);

  const setLocale = (next: Locale) => {
    if (isSupportedLocale(next)) setLocaleState(next);
  };

  return (
    <LanguageContext.Provider value={{ locale, t: translations[locale], setLocale }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
