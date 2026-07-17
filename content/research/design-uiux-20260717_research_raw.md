# Deep Research 生レポート: design-uiux-20260717（engine=claude-deep-research-workflow・Step 3a 直接呼び出し）

> ネイティブ /deep-research（106 エージェント・claims 113 抽出 → 25 検証 → 23 確証 / 2 反証・3 票制敵対検証）の統合結果。

## サマリー

Android ホーム画面から数秒で GitHub Issue を起票する PWA の設計には、(1) Todoist Quick Add / Drafts に共通する「起動即入力可能な単一フィールド + 記号ショートカットによる省略可能メタデータ + キャプチャとトリアージの分離」というクイックキャプチャ原則、(2) WCAG 2.2 SC 2.5.8（24x24 CSS px・AA）と Apple HIG（44x44 pt 既定 / 28x28 pt 最小・コントラスト 4.5:1）による数値基準、(3) enterkeyhint="send"（Baseline Widely available・追加ライブラリゼロ）等のブラウザ標準機能、(4) manifest shortcuts（Android は長押しで最大 3 件・優先順に記載）+ standalone 表示 + 512/192px アイコン + app shell プリキャッシュという PWA 標準経路、が一次情報で裏付けられた。Chrome 108（モバイル）以降はメニューからのインストールに Service Worker fetch ハンドラが不要になっており、インストール障壁は低い。一方、Core Web Vitals 閾値・楽観的 UI・送信失敗時の下書き保全・機械チェック（Lighthouse CI / axe-core）に関する主張は検証を通過しておらず、追加調査が必要である。

## 検証済み findings（統合後 10 件）

### F1: Todoist Quick Add は「入力 1 フィールド主義」と任意メタデータ指定を両立する実証済みパターン: 単一…

- **主張**: Todoist Quick Add は「入力 1 フィールド主義」と任意メタデータ指定を両立する実証済みパターン: 単一テキストフィールドに全情報を打ち込み、記号ショートカット（# プロジェクト・@ ラベル・p1〜p3 優先度・! リマインダー・+ 担当者・/ セクション）と自然言語日付解析（例 "tomorrow at 4pm"）が自動で構造化する。Issue 起票 PWA では「タイトル 1 フィールド必須・ラベル等は省略可能なインライン指定」の設計根拠になる
- **確度**: high / 票: 3-0 (x3 claims merged)
- **根拠**: Todoist 公式ヘルプが Quick Add を "the fastest way to add a new task, complete with dates, labels, reminders, and more" と定義し、単一フィールド内の記号シンタックス（#Work・@email・p1〜p3・!14:00・+Lucile・/Admin・自然言語日付）を逐語で確認（claims 0/1/2 を統合・全て 3-0）。注: ラベル等は純粋な自然言語ではなく記号短縮記法であり、タップ可能なチップ UI も併存する
- **出典**: <https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz> / <https://www.todoist.com/inspiration/add-tasks-todoist>

### F2: ホーム画面ショートカット起点のクイックキャプチャは Android で先行実例がある: Todoist は「Add Ta…

- **主張**: ホーム画面ショートカット起点のクイックキャプチャは Android で先行実例がある: Todoist は「Add Task」ウィジェット（ホーム画面）と「Add Task」タイル（クイック設定ドロワー）を提供し、アプリ本体を開かずに入力オーバーレイを直接起動できる
- **確度**: high / 票: 3-0
- **根拠**: Todoist 公式ページに "you can place an Add Task widget to your home screen, or an Add Task tile to your Quick Settings drawer" と明記。専用ヘルプ記事 2 本でも裏付けられた（claim 3・3-0）
- **出典**: <https://www.todoist.com/inspiration/add-tasks-todoist> / <https://www.todoist.com/help/articles/use-a-todoist-widget-on-your-android-device-632pZA> / <https://www.todoist.com/help/articles/add-an-add-task-quick-setting-tile-on-android-F5QYjq>

### F3: Drafts は「即フォーカス・単一入力」と「キャプチャとトリアージの分離」の実例: 起動時に即座に空ドラフトで入力可能…

- **主張**: Drafts は「即フォーカス・単一入力」と「キャプチャとトリアージの分離」の実例: 起動時に即座に空ドラフトで入力可能になり、ドキュメント作成・命名・フォルダ選択などの前置き操作を一切要求しない。整理（フィルタ・ワークスペース化）はキャプチャ後の別画面（draft list）として提供される。Issue 起票 PWA では「起動 = タイトル入力欄に autofocus・整理は GitHub 側に委ねる」設計の根拠になる
- **確度**: high / 票: 3-0 (x2 claims merged)
- **根拠**: 公式ドキュメントに "When you first launch drafts, it opens ready for you to type so you can jot down your thoughts without fumbling around creating new documents, naming them, digging through folders, etc." と "The draft list is where you manage drafts. Retrieve past drafts, filter and organize them, create workspaces, and more" を逐語確認（claims 4/5 統合・各 3-0）。注: "New Draft After" タイムアウト内の再入場は直前ドラフトを再開する
- **出典**: <https://docs.getdrafts.com/gettingstarted/>

### F4: タップターゲットの規範的最小値は WCAG 2.2 SC 2.5.8 Target Size (Minimum)・Lev…

- **主張**: タップターゲットの規範的最小値は WCAG 2.2 SC 2.5.8 Target Size (Minimum)・Level AA の 24x24 CSS px。24px 未満のターゲットも Spacing 例外（各ターゲットのバウンディングボックス中心に置いた直径 24 CSS px の円が他ターゲット・他の小型ターゲットの円と交差しない）で適合可能。機械チェック（CSS 計測テスト）に直接落とし込める数値基準
- **確度**: high / 票: 3-0 (x2 claims merged)
- **根拠**: W3C 一次情報を実フェッチし "The size of the target for pointer inputs is at least 24 by 24 CSS pixels"（Level AA）と Spacing 例外の規範文を逐語確認（claims 6/7 統合・各 3-0）。例外は spacing/equivalent/inline/user agent control/essential の 5 種
- **出典**: <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>

### F5: Apple HIG は iOS/iPadOS のコントロール（ヒットターゲット）を既定 44x44 pt・絶対最小 28…

- **主張**: Apple HIG は iOS/iPadOS のコントロール（ヒットターゲット）を既定 44x44 pt・絶対最小 28x28 pt と規定（watchOS も同値）。WCAG 24px より厳しい 44pt を主要ボタン（送信ボタン等）の設計基準に採るのが安全側
- **確度**: high / 票: 3-0
- **根拠**: Apple 公式 HIG アクセシビリティページの表を実フェッチで逐語確認: "iOS, iPadOS 44x44 pt / 28x28 pt"（claim 8・3-0）。28pt はアクセシビリティ表内の「最小コントロールサイズ」で、44pt が推奨基準
- **出典**: <https://developer.apple.com/design/human-interface-guidelines/accessibility>

### F6: コントラストは Apple HIG が WCAG Level AA 値を採用: 17pt 以下のテキストは 4.5:1、…

- **主張**: コントラストは Apple HIG が WCAG Level AA 値を採用: 17pt 以下のテキストは 4.5:1、18pt 以上は 3:1、太字は全サイズ 3:1。既定で満たせない場合はシステムの「コントラストを上げる」設定オン時に高コントラスト配色を提供し、ライト/ダーク両アピアランスで検証する — ダークモード実装のチェックリスト項目に直接転記できる
- **確度**: high / 票: 3-0
- **根拠**: HIG の表 "Up to 17 pts | All | 4.5:1 / 18 pts | All | 3:1 / All | Bold | 3:1" と Increase Contrast・両モード検証の文言を実フェッチで逐語確認（claim 9・3-0）。注: Apple の「太字は全サイズ 3:1」は WCAG AA（太字 14pt 以上のみ 3:1 緩和）の簡略化
- **出典**: <https://developer.apple.com/design/human-interface-guidelines/accessibility>

### F7: enterkeyhint はモバイル仮想キーボードの Enter キーのラベル/アイコンを定義する HTML グローバル…

- **主張**: enterkeyhint はモバイル仮想キーボードの Enter キーのラベル/アイコンを定義する HTML グローバル属性で、値は enter/done/go/next/previous/search/send のちょうど 7 種。"send"（"Typically delivering the text to its target"）が送信特化のタイトル入力欄に適する。Baseline Widely available（2021 年 11 月以降全ブラウザ対応）でポリフィル不要 — 「追加ライブラリゼロ」経路の代表例
- **確度**: high / 票: 3-0 (x3 claims merged)
- **根拠**: MDN と WHATWG HTML 仕様（§6.8.10）の双方で 7 値の閉じた列挙と send の意味を逐語確認。caniuse で Chrome 77+/Safari 13.1+/Firefox 94+ を裏付け（claims 10/11/12 統合・各 3-0）。注: あくまでヒントであり、キーボードによって描画忠実度は異なる（非対応環境では既定 Enter 表示に劣化するだけ）
- **出典**: <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/enterkeyhint>

### F8: PWA の manifest `shortcuts` メンバーはアプリ内の主要タスクへのリンクを宣言する OS/ブラウザ…

- **主張**: PWA の manifest `shortcuts` メンバーはアプリ内の主要タスクへのリンクを宣言する OS/ブラウザ標準（ライブラリ不要）機能で、Android ではランチャーアイコンの長押しで表示される。ただし Chrome for Android は最大 3 件しか表示しない（Windows の Chrome/Edge は 10 件）ため、最優先アクション（New Issue）を manifest の先頭に置く。表示数・表示形式はブラウザ/OS の裁量で、iOS Safari 等では動作しない（非 Baseline）
- **確度**: high / 票: 3-0 (x4 claims merged)
- **根拠**: web.dev に "Chrome and Edge on Windows limit the number of app shortcuts to 10 while Chrome for Android only display 3" と「manifest 記載順に表示・優先順で並べよ」の明示、MDN に「コンテキストメニュー表示（右クリック/長押し）」「非 Baseline」「ブラウザが切り詰めうる」を逐語確認（claims 13/14/15/16 統合・各 3-0）。注: shortcuts はインストール済み PWA でのみ表示。web.dev 記事は 2020 年掲載で「3 件」は Chrome 92 期の実装値（仕様保証ではない）
- **出典**: <https://web.dev/articles/app-shortcuts> / <https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/shortcuts>

### F9: インストール要件とマニフェスト推奨構成: Chrome はメニューからの PWA インストールに fetch() ハンド…

- **主張**: インストール要件とマニフェスト推奨構成: Chrome はメニューからの PWA インストールに fetch() ハンドラ付き Service Worker を要求しない（モバイル Chrome 108・デスクトップ 112 以降）。Google は short_name または name・icons・start_url・display の指定を強く推奨。アイコンは 512x512 を主とし 192x192/384x384/1024x1024 を追加（欠落・サイズ不正は一部プラットフォームでインストール要件を満たさない。Chrome は 192 と 512 の両方を要求）。display は fullscreen/standalone/minimal-ui/browser の 4 値で、standalone が最多用途 — ホーム画面ショートカットからの起動をネイティブアプリ的に見せる設定
- **確度**: high / 票: 3-0 (x4 claims merged)
- **根拠**: Chrome 公式ブログに "removed the requirement to have a service worker that implements the fetch() method for installation from the menu, since version 108 on mobile and 112 on Desktop" と推奨フィールドを逐語確認。web.dev に 512px 主アイコン・display 4 値・"Most use cases implement standalone"（Web Almanac 実測リンク付き）を逐語確認（claims 17/18/19/20 統合・各 3-0）
- **出典**: <https://developer.chrome.com/blog/update-install-criteria> / <https://web.dev/learn/pwa/web-app-manifest>

### F10: 起動速度（app shell）の標準パターン: 高速・オフライン起動には start_url の HTML・メイン UI…

- **主張**: 起動速度（app shell）の標準パターン: 高速・オフライン起動には start_url の HTML・メイン UI 描画に必要な CSS・画像・JavaScript（app shell 一式）を Service Worker の install イベント時に event.waitUntil() でプリキャッシュする。waitUntil() はキャッシュ処理の Promise が確定するまでブラウザが SW を終了させないことを保証する
- **確度**: high / 票: 3-0 (x2 claims merged)
- **根拠**: web.dev PWA コースで "the main page HTML (your app's start_url). CSS stylesheets needed for the main user interface. Images used in the user interface. JavaScript files required to render the user interface" と install 時プリキャッシュ + waitUntil の説明を逐語確認。MDN Caching ガイド・Workbox app-shell-model でも現行裏付けあり（claims 21/22 統合・各 3-0）。注: 同ページは JSON データ・Web フォントのキャッシュも推奨しており上記は中核サブセット
- **出典**: <https://web.dev/learn/pwa/caching>

## 反証済み（ガイドラインで断定禁止）

- ❌ 「Chrome's install prompt (beforeinstallprompt-driven UI) still requires the presence of a fetch() handler at the time of the post, even though menu-based install does not.」（票 0-3・出典 <https://developer.chrome.com/blog/update-install-criteria>）
- ❌ 「A web app manifest is required for a PWA to meet installability criteria in every browser, so the GitHub Issue shortcut PWA must ship a valid manifest to be installable to the Android home screen.」（票 1-2・出典 <https://web.dev/learn/pwa/web-app-manifest>）

## caveats（統合結果の限界）

(1) カバレッジの偏り: 検証を通過した 23 claims は調査項目 1（クイックキャプチャ）・2（フォーム設計の一部）・3（PWA）・6（アクセシビリティの一部）に集中しており、項目 4（Core Web Vitals 閾値・楽観的 UI・知覚閾値 0.1/1/10 秒の根拠）、項目 5（送信失敗時の下書き保全・localStorage/IndexedDB・GitHub API エラー表示）、項目 7（Lighthouse CI・axe-core・Playwright による機械チェック・2025〜2026 トレンド）は生存 claim がゼロで、本統合結果だけではデザインガイドラインの該当セクションを一次情報付きで書けない。(2) Material Design 3 のタッチターゲット値（通例 48x48dp）と親指到達圏（thumb zone）・inputmode/autofocus の一次情報も未検証。(3) 反証済み claim が 2 件ある: 「beforeinstallprompt 経由のインストールには当時 fetch() ハンドラが依然必要」(0-3) と「manifest は全ブラウザのインストール要件で必須」(1-2) — インストール要件をガイドライン化する際はこの 2 点を断定しないこと。(4) 時間依存性: Chrome の shortcuts 表示上限（Android 3 件）は Chrome 92 期の実装値で仕様保証がなく、インストール要件も継続的に緩和中（2023-12 更新のブログが最新確認点）。(5) Todoist/Drafts の claim はベンダー一次資料であり、設計意図の記述としては適切だが独立ベンチマークではない。

## openQuestions（補完リサーチ対象）

- Core Web Vitals（特に INP 200ms・LCP 2.5s・CLS 0.1）の 2025〜2026 年時点の公式閾値と、モバイル PWA での楽観的 UI（送信即完了表示 + バックグラウンド POST）のベストプラクティスは何か（一次情報未取得）
- 送信失敗・オフライン時の入力保全の標準実装は何が最適か: localStorage 即時下書き保存 vs IndexedDB + Background Sync API の再送キュー、および GitHub API の 401/403/レート制限エラーをユーザーにどう表示すべきか
- タップターゲット 24px/44pt・コントラスト 4.5:1・enterkeyhint 等の基準を CI で機械チェックする具体手段（Lighthouse CI の対応 audit・axe-core ルール ID・Playwright でのタップ数/起票所要時間計測パターン）は何か
- Material Design 3 の公式タッチターゲット最小値（48dp と推定）と thumb zone（片手操作到達圏）研究の一次情報はどこにあり、Apple 44pt / WCAG 24px とどう整合させてガイドライン化すべきか

## 取得ソース一覧

- [primary] <https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz>（角度: クイックキャプチャUXパターン（実例・先行製品）・claims 5）
- [primary] <https://www.todoist.com/inspiration/add-tasks-todoist>（角度: クイックキャプチャUXパターン（実例・先行製品）・claims 5）
- [primary] <https://docs.getdrafts.com/gettingstarted/>（角度: クイックキャプチャUXパターン（実例・先行製品）・claims 4）
- [blog] <https://super-productivity.com/blog/gtd-inbox-capture-system/>（角度: クイックキャプチャUXパターン（実例・先行製品）・claims 5）
- [blog] <https://www.makeuseof.com/google-keep-idea-capture-workflow/>（角度: クイックキャプチャUXパターン（実例・先行製品）・claims 5）
- [secondary] <https://www.todoist.com/productivity-methods/getting-things-done>（角度: クイックキャプチャUXパターン（実例・先行製品）・claims 5）
- [primary] <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>（角度: モバイルフォーム・タップターゲットの一次情報数値・claims 4）
- [unreliable] <https://m3.material.io/foundations/designing/structure>（角度: モバイルフォーム・タップターゲットの一次情報数値・claims 0）
- [primary] <https://developer.apple.com/design/human-interface-guidelines/accessibility>（角度: モバイルフォーム・タップターゲットの一次情報数値・claims 5）
- [primary] <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/enterkeyhint>（角度: モバイルフォーム・タップターゲットの一次情報数値・claims 5）
- [secondary] <https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/>（角度: モバイルフォーム・タップターゲットの一次情報数値・claims 5）
- [blog] <https://css-tricks.com/better-form-inputs-for-better-mobile-user-experiences/>（角度: モバイルフォーム・タップターゲットの一次情報数値・claims 5）
- [primary] <https://web.dev/articles/app-shortcuts>（角度: PWA起動速度・manifest shortcuts・installability・claims 5）
- [primary] <https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/shortcuts>（角度: PWA起動速度・manifest shortcuts・installability・claims 5）
- [primary] <https://developer.chrome.com/blog/update-install-criteria>（角度: PWA起動速度・manifest shortcuts・installability・claims 5）
- [primary] <https://web.dev/learn/pwa/web-app-manifest>（角度: PWA起動速度・manifest shortcuts・installability・claims 5）
- [primary] <https://web.dev/learn/pwa/caching>（角度: PWA起動速度・manifest shortcuts・installability・claims 5）
- [primary] <https://www.nngroup.com/articles/response-times-3-important-limits/>（角度: 体感速度・楽観的UI・オフライン時の入力保全・claims 5）
- [primary] <https://web.dev/articles/vitals>（角度: 体感速度・楽観的UI・オフライン時の入力保全・claims 5）
- [primary] <https://web.dev/articles/defining-core-web-vitals-thresholds>（角度: 体感速度・楽観的UI・オフライン時の入力保全・claims 5）
- [blog] <https://simonhearne.com/2021/optimistic-ui-patterns/>（角度: 体感速度・楽観的UI・オフライン時の入力保全・claims 5）
- [primary] <https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md>（角度: 機械チェック化・CI・2025-26モバイルUIトレンド・claims 5）
- [blog] <https://rishikc.com/articles/accessibility-testing-ci-integration/>（角度: 機械チェック化・CI・2025-26モバイルUIトレンド・claims 5）
- [primary] <https://github.com/treosh/lighthouse-ci-action>（角度: 機械チェック化・CI・2025-26モバイルUIトレンド・claims 5）

## stats

```json
{
 "angles": 5,
 "sourcesFetched": 24,
 "claimsExtracted": 113,
 "claimsVerified": 25,
 "confirmed": 23,
 "killed": 2,
 "unverified": 0,
 "afterSynthesis": 10,
 "urlDupes": 0,
 "budgetDropped": 6,
 "agentCalls": 106
}
```
