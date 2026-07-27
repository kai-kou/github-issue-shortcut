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
    tagline: string;
    apiStatusLabel: string;
    apiStatusChecking: string;
    apiStatusUnreachable: string;
  };
  footer: {
    terms: string;
    privacy: string;
    shortcuts: string;
  };
  nav: {
    openMenu: string;
    closeMenu: string;
    title: string;
    account: string;
    shortcuts: string;
    settings: string;
    about: string;
    manageShortcuts: string;
    notSignedIn: string;
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
    smartTokenListLabel: string;
    removeSmartTokenLabel: string;
    offlineQueuePending: string;
    offlineQueueFailed: string;
    offlineQueueResendButton: string;
    offlineQueueResendingLabel: string;
    offlineQueueResendConfirmMessage: string;
    offlineQueueResendConfirmButton: string;
    offlineQueueDiscardButton: string;
    offlineQueueDiscardConfirmMessage: string;
    offlineQueueDiscardConfirmButton: string;
    offlineQueueDiscardCancelButton: string;
  };
  issueForm: {
    closeButton: string;
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
    queuedMessage: string;
    smartTokenListLabel: string;
    labelSuggestListLabel: string;
    removeSmartTokenLabel: string;
    errors: {
      reauthRequired: string;
      rateLimited: string;
      forbidden: string;
      notFound: string;
      issuesDisabled: string;
      validationFailed: string;
      duplicateSubmission: string;
      queueExpired: string;
    };
  };
  labelPicker: {
    summary: string;
    loading: string;
    loadError: string;
    empty: string;
    noPushAccessWarning: string;
  };
  terms: LegalPage;
  privacy: LegalPage;
  shortcuts: {
    backHome: string;
    pageTitle: string;
    intro: string;
    loginRequired: string;
    loadError: string;
    formTitle: string;
    nameLabel: string;
    namePlaceholder: string;
    repoLabel: string;
    repoNoneOption: string;
    labelsLabel: string;
    labelsSelectRepoFirst: string;
    titleLabel: string;
    titlePlaceholder: string;
    saveButton: string;
    saving: string;
    cancelButton: string;
    validationError: string;
    saveError: string;
    listTitle: string;
    empty: string;
    editButton: string;
    deleteButton: string;
    deleteConfirm: string;
    deleteError: string;
    urlFieldLabel: string;
    copyButton: string;
    copied: string;
    openButton: string;
    placementGuideTitle: string;
    placementGuideBody: string;
    placementGuideNote: string;
    homeListTitle: string;
  };
}

export const translations = {
  ja: {
    home: {
      title: "GitHub Issue Shortcut",
      tagline: "思いついた瞬間に、最短で GitHub Issue を起票",
      apiStatusLabel: "API ステータス",
      apiStatusChecking: "確認中...",
      apiStatusUnreachable: "到達不可",
    },
    footer: {
      terms: "利用規約",
      privacy: "プライバシーポリシー",
      shortcuts: "ショートカット管理",
    },
    nav: {
      openMenu: "メニューを開く",
      closeMenu: "メニューを閉じる",
      title: "メニュー",
      account: "アカウント",
      shortcuts: "ショートカット",
      settings: "設定",
      about: "情報",
      manageShortcuts: "ショートカットを作成・管理",
      notSignedIn: "未ログイン",
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
      confirmMessage: "この端末に保存されたデータ（ログイン情報・ショートカット設定・キャッシュ）を完全に削除します。よろしいですか？",
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
      searchPlaceholder: "owner/repo（#repo で直接指定も可）",
      empty: "該当するリポジトリがありません",
      smartTokenListLabel: "認識されたリポジトリ指定",
      removeSmartTokenLabel: "指定を解除",
      offlineQueuePending: "送信待ちのオフラインキュー:",
      offlineQueueFailed: "送信に失敗した起票（手動対応が必要）:",
      offlineQueueResendButton: "再送",
      offlineQueueResendingLabel: "再送中...",
      offlineQueueResendConfirmMessage:
        "24 時間以上経過しています。GitHub 側に既に作成済みだった場合、再送すると重複して作成されます。それでも再送しますか？",
      offlineQueueResendConfirmButton: "再送する",
      offlineQueueDiscardButton: "破棄",
      offlineQueueDiscardConfirmMessage: "この起票を破棄しますか？（元に戻せません）",
      offlineQueueDiscardConfirmButton: "破棄する",
      offlineQueueDiscardCancelButton: "キャンセル",
    },
    issueForm: {
      closeButton: "閉じる",
      targetRepoLabel: "起票先",
      titleLabel: "タイトル",
      titlePlaceholder: "Issue のタイトル（必須・@label でラベル指定も可）",
      bodyLabel: "本文（任意）",
      bodyPlaceholder: "詳細があれば入力してください",
      submitButton: "Issue を作成",
      submitting: "作成中...",
      successMessage: "Issue を作成しました",
      viewIssueLink: "GitHub で開く",
      errorMessage: "Issue を作成できませんでした",
      queuedMessage: "オフラインです。接続回復後に自動で再送します（下書き保存済み）。",
      smartTokenListLabel: "認識されたラベル指定",
      labelSuggestListLabel: "ラベルの候補",
      removeSmartTokenLabel: "ラベル指定を解除",
      errors: {
        reauthRequired: "ログインの有効期限が切れたか、無効になりました。再度ログインしてください（入力内容は下書きとして保存されています）。",
        rateLimited: "リクエストが多すぎます。しばらく時間をおいてから再試行してください。",
        forbidden: "このリポジトリへの権限がありません。App のインストール状態をご確認ください。",
        notFound: "リポジトリが見つからないか、アクセスできません。",
        issuesDisabled: "このリポジトリは Issues が無効になっています。",
        validationFailed: "内容を見直してから再度お試しください。",
        duplicateSubmission: "この内容は直前に送信済みです。連続で作成されないよう自動的にスキップしました。",
        queueExpired:
          "24 時間以上送信できなかったため、自動再送を停止しました。GitHub 側に作成済みでないか確認してから、再送または破棄してください。",
      },
    },
    labelPicker: {
      summary: "ラベルを追加",
      loading: "ラベルを取得中...",
      loadError: "ラベルを取得できませんでした",
      empty: "ラベルがありません",
      noPushAccessWarning: "このリポジトリへの push 権限がないため、ラベルは反映されません（起票は可能です）。",
    },
    shortcuts: {
      backHome: "ホームに戻る",
      pageTitle: "ショートカット作成ヘルパー",
      intro:
        "リポジトリ・ラベル・タイトル雛形を選んで、起票画面を初期選択済みで開けるショートカットを保存できます。保存したショートカットはホーム画面上部の一覧に並び、タップですぐに起票を始められます。",
      loginRequired: "ショートカットを作成するには GitHub でログインしてください。",
      loadError: "読み込めませんでした",
      formTitle: "新しいショートカットを作成",
      nameLabel: "表示名（任意・12文字まで）",
      namePlaceholder: "日報",
      repoLabel: "リポジトリ（任意）",
      repoNoneOption: "（指定しない）",
      labelsLabel: "ラベル（任意）",
      labelsSelectRepoFirst: "リポジトリを選択するとラベルを選べます。",
      titleLabel: "タイトル雛形（任意）",
      titlePlaceholder: "バグ報告: ",
      saveButton: "保存",
      saving: "保存中...",
      cancelButton: "キャンセル",
      validationError: "リポジトリ・ラベル・タイトルのいずれかを入力してください",
      saveError: "保存できませんでした",
      listTitle: "保存済みショートカット",
      empty: "まだショートカットがありません",
      editButton: "編集",
      deleteButton: "削除",
      deleteConfirm: "このショートカットを削除しますか？",
      deleteError: "削除できませんでした",
      urlFieldLabel: "起動 URL",
      copyButton: "URL をコピー",
      copied: "コピーしました",
      openButton: "開く",
      placementGuideTitle: "保存したショートカットの使い方",
      placementGuideBody:
        "保存したショートカットは、ホーム画面上部の「保存済みショートカット」一覧からタップして開けます。「URL をコピー」で得た URL は、ブラウザのブックマークや他アプリへの貼り付け、ホーム画面へのリンク追加に使えます。",
      placementGuideNote:
        "この URL を単体でホーム画面のアイコンにしても、初期選択（プリセット）は反映されません（アプリはトップ画面で起動します・Android の仕様）。プリセット付きで開くには上記の方法を使ってください。",
      homeListTitle: "保存済みショートカット",
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
            {
              p: "本アプリはお客様のデータをサーバーに保存せず、ショートカット設定・下書きはお使いの端末内にのみ保存されます。そのため提供終了時に開発者が引き渡す・削除するデータはなく、端末内のデータはブラウザのデータ削除またはアプリ内のアカウント削除機能でお客様自身に削除いただく必要があります。過去に作成した Issue は GitHub 側に残ります。",
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
                "GitHub アクセストークン・リフレッシュトークン。暗号化した Cookie としてお使いの端末に保存し、サーバーには保存しません",
                "GitHub アカウント情報（ユーザー名・アイコンなど）。表示のたびに GitHub から取得し、サーバーには保存しません",
                "ショートカット設定（よく使うリポジトリ・ラベルの組み合わせ）。サーバーへは送信せず、お使いの端末内にのみ保存します",
                "Issue のタイトル・本文などのユーザーコンテンツは、GitHub へ送信するためだけに使用し、サーバーには保存しません",
              ],
            },
          ],
        },
        {
          heading: "2. 保存先",
          blocks: [
            {
              p: "本アプリのサーバー（Cloudflare Workers）は、お客様の個人データを保存しません。GitHub のトークンは AES-256-GCM で暗号化した Cookie としてお使いの端末に保存され（JavaScript からは読み取れない HttpOnly Cookie）、サーバーはリクエストのたびに復号して使うだけです。ショートカット設定・下書き・各種キャッシュも、お使いの端末内（ブラウザのローカルストレージ）にのみ保存されます。二重起票の防止に使う送信履歴もお使いの端末内にのみ保存されます。レート制限には Cloudflare のカウンタを使用し、GitHub のユーザー ID をハッシュ化した値だけを鍵として渡します（ユーザー ID そのものや送信内容は渡しません）。",
            },
          ],
        },
        {
          heading: "3. 利用目的",
          blocks: [{ p: "本アプリへのログイン維持、Issue 起票の実行、ショートカット機能の提供のためにのみデータを利用します。" }],
        },
        {
          heading: "4. 保持期間",
          blocks: [{ p: "端末内のデータは、お客様が削除するまで保持されます（トークン Cookie は最長 30 日で失効し、以降は再ログインが必要です）。本アプリがサーバー側に保持するデータはありません（サーバー基盤に残る記録については「5. サーバー基盤に残る記録」をご覧ください）。ログアウトすると端末のトークン Cookie が破棄され、あわせて GitHub 側でもアクセストークンを失効させます。" }],
        },
        {
          heading: "5. サーバー基盤に残る記録",
          blocks: [
            {
              p: "本アプリは Cloudflare Workers 上で動作しており、本アプリ自身が何も保存しなくても、基盤側にリクエストの記録が残る場合があります。本アプリでは、リクエストとその応答（ヘッダー・Cookie を含む）を記録する設定を無効化しており、残るのはエラー発生時の記録（例外の内容）だけです。それも記録対象を全体の約 5% に絞っており、Cloudflare 側で自動的に削除されます（保持期間は Cloudflare の上限に従い、本アプリが利用しているプランでは最長 3 日・上位プランでも最長 7 日）。この記録は障害調査のためだけに参照するもので、Issue の内容・GitHub のトークン・ショートカット設定は含まれません。",
            },
          ],
        },
        {
          heading: "6. 削除方法",
          blocks: [
            {
              p: "アプリ内のアカウント削除機能により、端末内に保存されたデータ（トークン Cookie・ショートカット設定・送信履歴・各種キャッシュ）を即時に削除し、GitHub 側のアクセストークンも失効させます。本アプリのサーバーには削除すべきお客様のデータがそもそも保存されていません。あわせて GitHub 側の連携解除（本アプリの GitHub App 認可の取り消し）の手順を案内します。",
            },
          ],
        },
        {
          heading: "7. お問い合わせ",
          blocks: [
            {
              p: "本ポリシーおよびデータの取り扱いに関するお問い合わせは、本アプリの GitHub リポジトリの Issue（https://github.com/kai-kou/github-issue-shortcut/issues）からご連絡ください。",
            },
          ],
        },
      ],
    },
  },
  en: {
    home: {
      title: "GitHub Issue Shortcut",
      tagline: "Capture ideas as GitHub issues in seconds",
      apiStatusLabel: "API status",
      apiStatusChecking: "checking...",
      apiStatusUnreachable: "unreachable",
    },
    footer: {
      terms: "Terms of Service",
      privacy: "Privacy Policy",
      shortcuts: "Manage shortcuts",
    },
    nav: {
      openMenu: "Open menu",
      closeMenu: "Close menu",
      title: "Menu",
      account: "Account",
      shortcuts: "Shortcuts",
      settings: "Settings",
      about: "About",
      manageShortcuts: "Create & manage shortcuts",
      notSignedIn: "Not signed in",
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
      confirmMessage: "This permanently deletes the data stored on this device (login info, shortcut settings, caches). Are you sure?",
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
      searchPlaceholder: "owner/repo (or type #repo to jump directly)",
      empty: "No matching repositories",
      smartTokenListLabel: "Recognized repository",
      removeSmartTokenLabel: "Remove",
      offlineQueuePending: "Pending offline queue:",
      offlineQueueFailed: "Failed to send (needs manual action):",
      offlineQueueResendButton: "Resend",
      offlineQueueResendingLabel: "Resending...",
      offlineQueueResendConfirmMessage:
        "More than 24 hours have passed. If it was already created on GitHub, resending will create a duplicate. Resend anyway?",
      offlineQueueResendConfirmButton: "Resend anyway",
      offlineQueueDiscardButton: "Discard",
      offlineQueueDiscardConfirmMessage: "Discard this issue? This can't be undone.",
      offlineQueueDiscardConfirmButton: "Yes, discard",
      offlineQueueDiscardCancelButton: "Cancel",
    },
    issueForm: {
      closeButton: "Close",
      targetRepoLabel: "Target repository",
      titleLabel: "Title",
      titlePlaceholder: "Issue title (required; type @label to add a label)",
      bodyLabel: "Body (optional)",
      bodyPlaceholder: "Add details if you have any",
      submitButton: "Create issue",
      submitting: "Creating...",
      successMessage: "Issue created",
      viewIssueLink: "Open on GitHub",
      errorMessage: "Could not create the issue",
      queuedMessage: "You're offline. This will be sent automatically once you're back online (saved as a draft).",
      smartTokenListLabel: "Recognized labels",
      labelSuggestListLabel: "Label suggestions",
      removeSmartTokenLabel: "Remove label",
      errors: {
        reauthRequired: "Your login has expired or is no longer valid. Please sign in again (your input is kept as a draft).",
        rateLimited: "Too many requests. Please wait a bit and try again.",
        forbidden: "You don't have access to this repository. Check that the App is installed.",
        notFound: "The repository could not be found or is not accessible.",
        issuesDisabled: "Issues are disabled for this repository.",
        validationFailed: "Please review the content and try again.",
        duplicateSubmission: "This was already submitted moments ago, so the duplicate was skipped automatically.",
        queueExpired:
          "This couldn't be sent for over 24 hours, so automatic resending stopped. Check whether it was already created on GitHub, then resend or discard it.",
      },
    },
    labelPicker: {
      summary: "Add labels",
      loading: "Loading labels...",
      loadError: "Could not load labels",
      empty: "No labels",
      noPushAccessWarning: "You don't have push access to this repository, so labels won't be applied (the issue itself can still be created).",
    },
    shortcuts: {
      backHome: "Back to home",
      pageTitle: "Shortcut helper",
      intro:
        "Pick a repository, labels, and a title template to save a shortcut that opens the issue form with those fields pre-selected. Saved shortcuts appear in the list at the top of the home screen—tap one to start filing right away.",
      loginRequired: "Sign in with GitHub to create shortcuts.",
      loadError: "Could not load",
      formTitle: "Create a new shortcut",
      nameLabel: "Display name (optional, up to 12 characters)",
      namePlaceholder: "Daily note",
      repoLabel: "Repository (optional)",
      repoNoneOption: "(none)",
      labelsLabel: "Labels (optional)",
      labelsSelectRepoFirst: "Select a repository to choose labels.",
      titleLabel: "Title template (optional)",
      titlePlaceholder: "Bug report: ",
      saveButton: "Save",
      saving: "Saving...",
      cancelButton: "Cancel",
      validationError: "Enter at least one of repository, labels, or title",
      saveError: "Could not save",
      listTitle: "Saved shortcuts",
      empty: "No shortcuts yet",
      editButton: "Edit",
      deleteButton: "Delete",
      deleteConfirm: "Delete this shortcut?",
      deleteError: "Could not delete",
      urlFieldLabel: "Launch URL",
      copyButton: "Copy URL",
      copied: "Copied",
      openButton: "Open",
      placementGuideTitle: "Using your saved shortcuts",
      placementGuideBody:
        "Open a saved shortcut by tapping it in the \"Saved shortcuts\" list at the top of the home screen. Use \"Copy URL\" to bookmark it, paste it into another app, or add it to your home screen as a link.",
      placementGuideNote:
        "Adding this URL to your home screen as a standalone icon won't keep the pre-selected fields—the app always launches on its main screen (an Android limitation). Use the methods above to open it with the preset applied.",
      homeListTitle: "Saved shortcuts",
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
            {
              p: "The App stores none of your data on its server; shortcut settings and drafts live only on your device. If the App is discontinued there is therefore no data for the developer to hand over or delete, and any data on your device must be removed by you, either by clearing your browser data or by using the in-app account deletion feature. Issues you have already created remain in GitHub.",
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
                "GitHub access and refresh tokens. They are stored on your device as an encrypted cookie and are never stored on the server",
                "GitHub account information (username, avatar). It is fetched from GitHub each time it is displayed and is never stored on the server",
                "Shortcut settings (combinations of frequently used repositories and labels). These are never sent to the server and are stored only on your device",
                "Issue titles and bodies are used solely to submit them to GitHub and are never stored on our server",
              ],
            },
          ],
        },
        {
          heading: "2. Where Data Is Stored",
          blocks: [
            {
              p: "The App's server (Cloudflare Workers) does not store your personal data. GitHub tokens live on your device inside a cookie encrypted with AES-256-GCM (an HttpOnly cookie that JavaScript cannot read); the server merely decrypts it for the duration of each request. Shortcut settings, drafts, and caches are likewise stored only on your device (browser local storage). The submission history used to prevent duplicate submissions is likewise kept only on your device. Rate limiting relies on a Cloudflare-managed counter, to which we pass only a hashed form of your GitHub user ID (never the ID itself or the submitted content).",
            },
          ],
        },
        {
          heading: "3. Purpose of Use",
          blocks: [{ p: "Data is used only to maintain your login session, execute issue submissions, and provide shortcut features." }],
        },
        {
          heading: "4. Retention Period",
          blocks: [{ p: "Data on your device is retained until you delete it (the token cookie expires after at most 30 days, after which you sign in again). The App retains no data of yours on the server (for records kept by the underlying platform, see \"5. Records Kept by the Underlying Platform\"). Signing out destroys the token cookie on your device and revokes the access token at GitHub." }],
        },
        {
          heading: "5. Records Kept by the Underlying Platform",
          blocks: [
            {
              p: "The App runs on Cloudflare Workers, so even though the App itself stores nothing, the platform may keep records of requests. The App disables the setting that records requests and responses (including headers and cookies), so the only records left are errors (uncaught exceptions), and even those are sampled down to roughly 5%. Cloudflare deletes them automatically after its retention limit (at most 3 days on the plan this App uses; at most 7 days on higher plans). These records are consulted only to investigate incidents; they contain no issue content, GitHub tokens, or shortcut settings.",
            },
          ],
        },
        {
          heading: "6. How to Delete Your Data",
          blocks: [
            {
              p: "The in-app account deletion feature immediately deletes the data stored on your device (the token cookie, shortcut settings, submission history, and caches) and revokes your access token at GitHub. There is no data of yours on the App's server to delete in the first place. It also guides you through revoking the App's GitHub authorization.",
            },
          ],
        },
        {
          heading: "7. Contact",
          blocks: [
            {
              p: "For questions about this Policy or how your data is handled, open an issue in the App's GitHub repository (https://github.com/kai-kou/github-issue-shortcut/issues).",
            },
          ],
        },
      ],
    },
  },
} as const satisfies Record<Locale, Translations>;

export type { Translations };
