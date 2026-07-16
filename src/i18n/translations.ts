export type Locale = "ja" | "en";

export const SUPPORTED_LOCALES: readonly Locale[] = ["ja", "en"];

/** 法的ページの本文ブロック。段落と箇条書きを元の文書の出現順で保持する。 */
export type LegalBlock = { p: string } | { ul: string[] };

interface LegalSection {
  heading: string;
  blocks: LegalBlock[];
}

interface LegalPage {
  title: string;
  intro: string;
  sections: LegalSection[];
}

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
  auth: {
    loginButton: string;
    checking: string;
    loggedInAs: string;
    logoutButton: string;
    loginError: string;
  };
  account: {
    deleteButton: string;
    confirmMessage: string;
    confirmButton: string;
    cancelButton: string;
    error: string;
    deleted: string;
    revokeCta: string;
    backHome: string;
  };
  install: {
    title: string;
    body: string;
    cta: string;
    orgNotice: string;
  };
  repoPicker: {
    loading: string;
    loadError: string;
    searchLabel: string;
    searchPlaceholder: string;
    empty: string;
  };
  issueForm: {
    targetRepoLabel: string;
    titleLabel: string;
    titlePlaceholder: string;
    bodyLabel: string;
    bodyPlaceholder: string;
    submitButton: string;
    submitting: string;
    successMessage: string;
    viewIssueLink: string;
    errorMessage: string;
    errors: {
      reauthRequired: string;
      rateLimited: string;
      forbidden: string;
      notFound: string;
      issuesDisabled: string;
      validationFailed: string;
      duplicateSubmission: string;
    };
  };
  terms: LegalPage;
  privacy: LegalPage;
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
    auth: {
      loginButton: "GitHub でログイン",
      checking: "ログイン状態を確認中...",
      loggedInAs: "ログイン中",
      logoutButton: "ログアウト",
      loginError: "ログイン状態を確認できませんでした",
    },
    account: {
      deleteButton: "アカウント削除",
      confirmMessage: "本アプリ内のデータ（セッション・トークン）を完全に削除します。よろしいですか？",
      confirmButton: "削除する",
      cancelButton: "キャンセル",
      error: "アカウント削除に失敗しました。もう一度お試しください。",
      deleted: "アカウントを削除しました。GitHub 側の連携解除は以下から行ってください。",
      revokeCta: "GitHub App の連携管理を開く",
      backHome: "ホームに戻る",
    },
    install: {
      title: "GitHub App のインストールが必要です",
      body: "起票したいリポジトリに GitHub App をインストールすると使えるようになります。",
      cta: "GitHub App をインストール",
      orgNotice:
        "Organization のリポジトリでは、管理者でない場合はインストール申請となり承認をお待ちいただくことがあります。",
    },
    repoPicker: {
      loading: "リポジトリを取得中...",
      loadError: "リポジトリを取得できませんでした",
      searchLabel: "リポジトリを検索",
      searchPlaceholder: "owner/repo",
      empty: "該当するリポジトリがありません",
    },
    issueForm: {
      targetRepoLabel: "起票先",
      titleLabel: "タイトル",
      titlePlaceholder: "Issue のタイトル（必須）",
      bodyLabel: "本文（任意）",
      bodyPlaceholder: "詳細があれば入力してください",
      submitButton: "Issue を作成",
      submitting: "作成中...",
      successMessage: "Issue を作成しました",
      viewIssueLink: "GitHub で開く",
      errorMessage: "Issue を作成できませんでした",
      errors: {
        reauthRequired: "ログインの有効期限が切れました。再度ログインしてください。",
        rateLimited: "リクエストが多すぎます。しばらく時間をおいてから再試行してください。",
        forbidden: "このリポジトリへの権限がありません。App のインストール状態をご確認ください。",
        notFound: "リポジトリが見つからないか、アクセスできません。",
        issuesDisabled: "このリポジトリは Issues が無効になっています。",
        validationFailed: "内容を見直してから再度お試しください。",
        duplicateSubmission: "この内容は直前に送信済みです。連続で作成されないよう自動的にスキップしました。",
      },
    },
    terms: {
      title: "利用規約",
      intro:
        "本規約は、GitHub Issue Shortcut（以下「本アプリ」）の利用条件を定めるものです。本アプリを利用した時点で、本規約に同意したものとみなします。",
      sections: [
        {
          heading: "1. 無保証",
          blocks: [
            {
              p: "本アプリは現状有姿（as is）で提供され、明示・黙示を問わずいかなる保証も行いません。本アプリの利用により生じた損害について、開発者は責任を負いません。",
            },
          ],
        },
        {
          heading: "2. 自己責任",
          blocks: [
            {
              p: "本アプリを通じて GitHub リポジトリへ Issue を作成する行為は、利用者自身の責任で行ってください。誤った内容の起票や意図しない Issue の作成についても、開発者は責任を負いません。",
            },
          ],
        },
        {
          heading: "3. 禁止行為",
          blocks: [
            {
              ul: [
                "スパム目的の Issue 起票、および連続的・大量の起票による GitHub API への過度な負荷をかける行為",
                "本アプリまたは GitHub のサービスの運営を妨害する行為",
                "法令または公序良俗に違反する行為",
                "本アプリの脆弱性を悪用する行為",
              ],
            },
            { p: "禁止行為が確認された場合、予告なく該当アカウントの利用を制限することがあります。" },
          ],
        },
        {
          heading: "4. サービスの変更・終了",
          blocks: [
            {
              p: "開発者は、利用者への事前告知なく本アプリの内容を変更し、または提供を終了することがあります。これによって生じた損害について、開発者は責任を負いません。",
            },
          ],
        },
        {
          heading: "5. 規約の変更",
          blocks: [{ p: "本規約は予告なく変更されることがあります。変更後の内容は本ページに掲載した時点で効力を生じます。" }],
        },
      ],
    },
    privacy: {
      title: "プライバシーポリシー",
      intro: "本ポリシーは、GitHub Issue Shortcut（以下「本アプリ」）が収集する情報とその取り扱いについて定めるものです。",
      sections: [
        {
          heading: "1. 収集するデータ",
          blocks: [
            {
              ul: [
                "GitHub アカウント情報（ユーザー ID・ユーザー名など、ログインに必要な範囲）",
                "GitHub アクセストークン・リフレッシュトークン（暗号化して保管）",
                "ショートカット設定（よく使うリポジトリ・ラベルの組み合わせ）",
                "最小限の計測イベント（起票の成功・失敗など、機能改善に必要な範囲のみ。Issue のタイトル・本文などのユーザーコンテンツは分析目的で保存しません）",
              ],
            },
          ],
        },
        {
          heading: "2. 保存先",
          blocks: [
            {
              p: "収集したデータは Cloudflare（Workers / D1）上に保存します。アクセストークン・リフレッシュトークンは AES-256-GCM で暗号化して保管し、平文では保存しません。",
            },
          ],
        },
        {
          heading: "3. 利用目的",
          blocks: [{ p: "本アプリへのログイン維持、Issue 起票の実行、ショートカット機能の提供のためにのみデータを利用します。" }],
        },
        {
          heading: "4. 保持期間",
          blocks: [{ p: "アカウントが存在する間、上記データを保持します。ログアウトによりセッション情報は無効化されます。" }],
        },
        {
          heading: "5. 削除方法",
          blocks: [
            {
              p: "アプリ内のアカウント削除機能により、本アプリが保存する全データ（ユーザー情報・セッション・トークン・ショートカット設定・起票履歴）を即時に削除できます。あわせて GitHub 側の連携解除（本アプリの GitHub App 認可の取り消し）の手順を案内します。",
            },
          ],
        },
      ],
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
    auth: {
      loginButton: "Sign in with GitHub",
      checking: "Checking sign-in status...",
      loggedInAs: "Signed in as",
      logoutButton: "Sign out",
      loginError: "Could not check sign-in status",
    },
    account: {
      deleteButton: "Delete account",
      confirmMessage: "This permanently deletes your data in this app (session, tokens). Are you sure?",
      confirmButton: "Delete",
      cancelButton: "Cancel",
      error: "Failed to delete account. Please try again.",
      deleted: "Your account has been deleted. Please revoke the GitHub App connection below.",
      revokeCta: "Manage GitHub App connection",
      backHome: "Back to home",
    },
    install: {
      title: "Install the GitHub App to get started",
      body: "Install the GitHub App on the repositories you want to file issues in.",
      cta: "Install GitHub App",
      orgNotice:
        "For organization repositories, non-admins may need to request installation and wait for an admin's approval.",
    },
    repoPicker: {
      loading: "Loading repositories...",
      loadError: "Could not load repositories",
      searchLabel: "Search repositories",
      searchPlaceholder: "owner/repo",
      empty: "No matching repositories",
    },
    issueForm: {
      targetRepoLabel: "Target repository",
      titleLabel: "Title",
      titlePlaceholder: "Issue title (required)",
      bodyLabel: "Body (optional)",
      bodyPlaceholder: "Add details if you have any",
      submitButton: "Create issue",
      submitting: "Creating...",
      successMessage: "Issue created",
      viewIssueLink: "Open on GitHub",
      errorMessage: "Could not create the issue",
      errors: {
        reauthRequired: "Your login has expired. Please sign in again.",
        rateLimited: "Too many requests. Please wait a bit and try again.",
        forbidden: "You don't have access to this repository. Check that the App is installed.",
        notFound: "The repository could not be found or is not accessible.",
        issuesDisabled: "Issues are disabled for this repository.",
        validationFailed: "Please review the content and try again.",
        duplicateSubmission: "This was already submitted moments ago, so the duplicate was skipped automatically.",
      },
    },
    terms: {
      title: "Terms of Service",
      intro:
        "These Terms govern your use of GitHub Issue Shortcut (the \"App\"). By using the App, you agree to these Terms.",
      sections: [
        {
          heading: "1. No Warranty",
          blocks: [
            {
              p: "The App is provided \"as is\" without warranties of any kind, express or implied. The developer is not liable for any damages arising from use of the App.",
            },
          ],
        },
        {
          heading: "2. Your Responsibility",
          blocks: [
            {
              p: "Creating issues in GitHub repositories through the App is done at your own responsibility. The developer is not liable for incorrect submissions or unintended issue creation.",
            },
          ],
        },
        {
          heading: "3. Prohibited Conduct",
          blocks: [
            {
              ul: [
                "Creating spam issues, or placing excessive load on the GitHub API through repeated or bulk submissions",
                "Interfering with the operation of the App or GitHub's services",
                "Violating applicable law or public order and morals",
                "Exploiting vulnerabilities in the App",
              ],
            },
            { p: "If prohibited conduct is identified, the affected account's access may be restricted without prior notice." },
          ],
        },
        {
          heading: "4. Changes and Termination",
          blocks: [
            {
              p: "The developer may change or discontinue the App without prior notice to users. The developer is not liable for any damages resulting from this.",
            },
          ],
        },
        {
          heading: "5. Changes to These Terms",
          blocks: [{ p: "These Terms may change without notice. Changes take effect once posted on this page." }],
        },
      ],
    },
    privacy: {
      title: "Privacy Policy",
      intro: "This Policy describes what information GitHub Issue Shortcut (the \"App\") collects and how it is handled.",
      sections: [
        {
          heading: "1. Data We Collect",
          blocks: [
            {
              ul: [
                "GitHub account information (user ID, username, and other data needed for login)",
                "GitHub access and refresh tokens (stored encrypted)",
                "Shortcut settings (combinations of frequently used repositories and labels)",
                "Minimal usage events (e.g. issue submission success/failure, only as needed for product improvement; issue titles and bodies are never stored for analytics purposes)",
              ],
            },
          ],
        },
        {
          heading: "2. Where Data Is Stored",
          blocks: [
            {
              p: "Collected data is stored on Cloudflare (Workers / D1). Access and refresh tokens are encrypted with AES-256-GCM and are never stored in plaintext.",
            },
          ],
        },
        {
          heading: "3. Purpose of Use",
          blocks: [{ p: "Data is used only to maintain your login session, execute issue submissions, and provide shortcut features." }],
        },
        {
          heading: "4. Retention Period",
          blocks: [{ p: "Data is retained while your account exists. Session information is invalidated upon logout." }],
        },
        {
          heading: "5. How to Delete Your Data",
          blocks: [
            {
              p: "The in-app account deletion feature immediately deletes all data the App stores (user info, sessions, tokens, shortcut settings, and issue submission history). It also guides you through revoking the App's GitHub authorization.",
            },
          ],
        },
      ],
    },
  },
} as const satisfies Record<Locale, Translations>;

export type { Translations };
