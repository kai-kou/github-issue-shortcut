import { useLanguage } from "./LanguageContext";
import { SUPPORTED_LOCALES } from "./translations";

export function LanguageSwitcher() {
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
