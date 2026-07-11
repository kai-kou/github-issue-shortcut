export type Locale = "ja" | "en";

export const SUPPORTED_LOCALES: readonly Locale[] = ["ja", "en"];

interface Translations {
  home: {
    title: string;
    hello: string;
    apiStatusLabel: string;
    apiStatusChecking: string;
    apiStatusUnreachable: string;
  };
  footer: {
    terms: string;
    privacy: string;
  };
  languageSwitcher: {
    label: string;
  };
}

export const translations = {
  ja: {
    home: {
      title: "GitHub Issue Shortcut",
      hello: "Hello World",
      apiStatusLabel: "API ステータス",
      apiStatusChecking: "確認中...",
      apiStatusUnreachable: "到達不可",
    },
    footer: {
      terms: "利用規約",
      privacy: "プライバシーポリシー",
    },
    languageSwitcher: {
      label: "言語",
    },
  },
  en: {
    home: {
      title: "GitHub Issue Shortcut",
      hello: "Hello World",
      apiStatusLabel: "API status",
      apiStatusChecking: "checking...",
      apiStatusUnreachable: "unreachable",
    },
    footer: {
      terms: "Terms of Service",
      privacy: "Privacy Policy",
    },
    languageSwitcher: {
      label: "Language",
    },
  },
} as const satisfies Record<Locale, Translations>;

export type { Translations };
