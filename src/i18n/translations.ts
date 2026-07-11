export type Locale = "ja" | "en";

export const SUPPORTED_LOCALES: readonly Locale[] = ["ja", "en"];

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
} as const satisfies Record<Locale, unknown>;

export type Translations = (typeof translations)[Locale];
