import { SUPPORTED_LOCALES, type Locale } from "./translations";

const DEFAULT_LOCALE: Locale = "en";

/** ブラウザの言語設定（`navigator.languages` 相当）から対応ロケールを選ぶ。マッチしなければ既定（en）。 */
export function pickLocale(preferredLanguages: readonly string[]): Locale {
  for (const lang of preferredLanguages) {
    const primary = lang.split("-")[0].toLowerCase();
    const match = SUPPORTED_LOCALES.find((locale) => locale === primary);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

export function isSupportedLocale(value: string | null): value is Locale {
  return value !== null && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
