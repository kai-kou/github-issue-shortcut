# Deep Research: モバイル最速 Issue 起票 PWA の UI/UX デザイン原則・ベストプラクティス

- **research_id**: design-uiux-20260717
- **engine**: claude-deep-research-workflow（ネイティブ `/deep-research`・106 エージェント・113 claims 抽出 → 25 検証 → 23 確証 / 2 反証・3 票制敵対検証）+ 未カバー 4 領域の DIY 補完（並列 WebSearch/WebFetch・Step 5 品質ゲート「不足項目だけ追加実行」に準拠）
- **generated_at**: 2026-07-17 21:20 JST
- **プロンプト**: `content/research/design-uiux-20260717_prompt.md`
- **生レポート**: `content/research/design-uiux-20260717_research_raw.md`（ワークフロー統合結果の原本）

> 情報ランク: **[A]** 一次情報・公式 / **[B]** 信頼できる二次情報 / **[C]** 要検証の二次・三次情報（本文では文脈参考のみ・断定に使わない）

---

## 1. クイックキャプチャ UX パターン（最速入力ツールの共通原則）

- **入力 1 フィールド主義 + 省略可能メタデータの記号指定**: Todoist Quick Add は単一テキストフィールドに全情報を打ち込み、記号ショートカット（`#` プロジェクト・`@` ラベル・`p1〜p3` 優先度・`+` 担当者）と自然言語日付解析が自動で構造化する。公式が「日付・ラベル・リマインダー込みでタスクを追加する最速の方法」と定義 [A] <https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz>。タップ可能なチップ UI（アクション行）も併存し、記号入力とタップ選択の両経路を提供する [A] <https://www.todoist.com/inspiration/add-tasks-todoist>
- **起動 = 即入力可能（前置き操作ゼロ）**: Drafts は起動時に即座に空ドラフトで入力可能になり、ドキュメント作成・命名・フォルダ選択などの前置き操作を一切要求しない [A] <https://docs.getdrafts.com/gettingstarted/>
- **キャプチャとトリアージの分離**: Drafts は整理（フィルタ・ワークスペース化）をキャプチャ後の別画面（draft list）に完全分離している [A] 同上。本プロジェクトでは「整理は GitHub 側（Issues 画面）に委ね、起票 PWA はキャプチャに徹する」設計根拠になる
- **ホーム画面起点のキャプチャは Android で先行実例あり**: Todoist は「Add Task」ウィジェット（ホーム画面）とクイック設定タイルを提供し、アプリ本体を開かずに入力オーバーレイを直接起動できる [A] <https://www.todoist.com/help/articles/use-a-todoist-widget-on-your-android-device-632pZA>
- **GitHub Mobile（ネイティブ）の先行事例**: compose 画面でメタデータをキーボード上部の action pills（チップ）で追加する（2023-07 改善）[A] <https://github.blog/changelog/2023-07-13-improved-issue-creation-experience-for-github-mobile/>（2026-07-10 リサーチで確認済み）
- **制約（Web の限界）**: Android Chrome ではコールドローンチ時の `autofocus` / `focus()` はカーソル表示のみでキーボードは開かない（ユーザージェスチャ内の `focus()` のみ開く）。standalone PWA でも同じ [B] <https://discourse.wicg.io/t/how-should-browsers-treat-the-autofocus-attribute-on-mobile-devices/5238/>（2026-07-10 リサーチ）。緩和策 = 起動面の最初のタップをジェスチャとして使い「起動 → 1 タップ → キーボード」まで縮める

## 2. モバイルフォーム設計（タップターゲット・キーボード・入力属性）

- **タップターゲットの規範値（3 基準の整合）**:
  - WCAG 2.2 SC 2.5.8 Target Size (Minimum)・Level AA = **24×24 CSS px**（Spacing 例外: 中心に置いた直径 24px の円が他ターゲットの円と交差しなければ 24px 未満も適合）[A] <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>
  - Material Design 3 / Android = **最小 48×48dp**・ターゲット間スペーシング **8dp**。視覚アイコン（例 24dp）よりタップ領域を大きく取る [A] <https://support.google.com/accessibility/android/answer/7101858> / <https://developer.android.com/guide/topics/ui/accessibility/apps>
  - Apple HIG = 既定 **44×44pt**・絶対最小 28×28pt [A] <https://developer.apple.com/design/human-interface-guidelines/accessibility>
  - → 設計指針: **主要操作（送信・入力欄）は 48px、その他のインタラクティブ要素も 44px 以上、機械チェックの最低ラインは WCAG の 24px**
- **テキストフィールド高さ**: M3 Filled/Outlined text field の標準高さは 56dp [B] <https://m3.material.io/components/text-fields/specs>（JS レンダリングのため本文直接取得不可・複数実装で裏取り。fact_check_flags 参照）
- **`enterkeyhint`**: モバイル仮想キーボードの Enter キー表示を定義する HTML グローバル属性（`enter`/`done`/`go`/`next`/`previous`/`search`/`send` の 7 値）。送信特化のタイトル欄には `send` が適合。Baseline Widely available・ポリフィル不要（追加ライブラリゼロ経路の代表例）[A] <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/enterkeyhint>
- **`inputmode`**: 仮想キーボードレイアウトのヒント（`none`/`text`/`decimal`/`numeric`/`tel`/`search`/`email`/`url`）。バリデーションには影響しない [A] <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode>
- **`autocapitalize` / `autocomplete`**: 仮想キーボードの自動大文字化制御・自動補完ヒント [A] <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/autocapitalize>
- **iOS Safari の自動ズーム**: input のフォントサイズが **16px 未満** だとフォーカス時に自動ズームする。対策はフォーム要素に `font-size: 16px` 以上（`maximum-scale=1` でのズーム殺しは WCAG 違反のため禁止）[B] <https://css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom/>（Apple 公式明文なし・業界標準リファレンス。fact_check_flags 参照）
- **ラベルは入力欄の上に常時表示**: placeholder のみをラベル代わりにする設計を NN/g は有害と結論（入力中にラベル消失・入力済み判別不可・支援技術対応不安定など 7 点）[A] <https://www.nngroup.com/articles/form-design-placeholders/>
- **キーボードとボトム UI の共存**: `<meta name="viewport" content="... interactive-widget=resizes-content">`（Chrome 108+）でキーボード表示時に bottom-fixed UI が押し上げられる（JS 不要）[A] <https://developer.chrome.com/blog/viewport-resize-behavior>（2026-07-10 リサーチ）

## 3. PWA 起動導線・インストール（shortcuts / installability / app shell）

- **manifest `shortcuts`**: アプリの主要タスクを宣言する OS/ブラウザ標準機能（ライブラリ不要）。Android ではランチャーアイコン長押しで表示。**Chrome for Android の表示上限は 3 件**（Windows は 10 件）のため最優先アクション（New Issue）を manifest の先頭に置く。iOS Safari では動作しない（非 Baseline）[A] <https://web.dev/articles/app-shortcuts> / <https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/shortcuts>（「3 件」は Chrome 92 期の実装値で仕様保証なし。fact_check_flags 参照）
- **インストール要件の現状**: Chrome はメニューからの PWA インストールに fetch() ハンドラ付き Service Worker を **要求しない**（モバイル Chrome 108 / デスクトップ 112 以降）[A] <https://developer.chrome.com/blog/update-install-criteria>。⚠️ 反証済み主張に注意: 「beforeinstallprompt 経由は今も fetch ハンドラ必須」（0-3 で反証）「manifest は全ブラウザのインストール要件で必須」（1-2 で反証）— この 2 点を断定しない
- **manifest 推奨構成**: `short_name`/`name`・`icons`（**512×512 主 + 192×192 必須**・maskable）・`start_url`・`display`（`standalone` が最多用途）[A] <https://web.dev/learn/pwa/web-app-manifest>
- **app shell プリキャッシュ**: 高速・オフライン起動には start_url の HTML・UI 描画に必要な CSS/JS/画像を Service Worker の install イベントで `event.waitUntil()` を使いプリキャッシュする [A] <https://web.dev/learn/pwa/caching>。SW 起動コストはモバイルで約 250ms（低速機 500ms+）のため、再訪 LCP サブ秒は app shell precache が前提 [A] <https://developer.chrome.com/docs/workbox/app-shell-model>（2026-07-10 リサーチ）
- **効果の実証**: Twitter Lite は app shell 化で再訪 3 秒未満・投稿数 75% 増（compose 摩擦低減が投稿量を増やす直接証拠・2017）[A] <https://web.dev/case-studies/twitter>（2026-07-10 リサーチ）
- **Web Share Target**: インストール済み PWA が Android 共有シートに出る。Android では共有 URL が `text` フィールドに入ることが多く URL 抽出処理が必要 [A] <https://developer.chrome.com/docs/capabilities/web-apis/web-share-target>（2026-07-10 リサーチ）

## 4. 体感速度・パフォーマンス UX（Core Web Vitals・知覚閾値・楽観的 UI）

- **Core Web Vitals 公式閾値（2025〜2026 時点・75 パーセンタイル基準）** [A] <https://web.dev/articles/vitals> / <https://web.dev/articles/defining-core-web-vitals-thresholds>:
  - LCP: good < **2.5s** / poor > 4.0s
  - INP: good ≤ **200ms** / poor > 500ms（2024-03-12 に FID を正式置換 [A] <https://web.dev/blog/inp-cwv-march-12>）
  - CLS: good ≤ **0.1** / poor > 0.25
- **応答時間の知覚閾値（Nielsen 1993 原典）** [A] <https://www.nngroup.com/articles/response-times-3-important-limits/>:
  - **0.1 秒** = 瞬時と感じる限界（フィードバック不要）/ **1 秒** = 思考の連続性が保たれる限界 / **10 秒** = 注意を保持できる限界（超えるなら percent-done 進捗表示）
  - → 起票 10 秒 KPI は「10 秒ルール」の枠内設計。タップ応答は 0.1 秒（INP 200ms 以内）、送信完了は 1 秒以内目標
- **楽観的 UI（optimistic UI）**: React 19 `useOptimistic` が標準サポート。即時に成功状態を描画 → バックグラウンド送信 → 失敗時は自動で実状態にロールバック（Action/Transition 内でのみ呼び出し可）[A] <https://react.dev/reference/react/useOptimistic>。適用条件 = 成功率が高く失敗時リカバリが軽微な操作（Issue 起票は好適用例）。不可逆操作・失敗しやすい操作には適用しない。失敗時のサイレントロールバック禁止（明示エラー + 救済 UI 必須）[B] <https://www.smashingmagazine.com/2016/11/true-lies-of-optimistic-user-interfaces/>
- **ローディング表示の使い分け**: フォーム送信のような「表示するコンテンツが少ない」処理はスケルトンではなく軽量インジケーター。1 秒未満で完了する処理はインジケーター自体不要（Nielsen 1 秒ルールから導出）。スケルトンはレイアウト構造のある複数要素の読み込み向け [B] <https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/>（知覚効果の定量値は学術裏付け未確認のため断定しない）

## 5. 失敗時 UX・入力内容の保全（本プロジェクト最重要 KPI）

- **下書きストレージの選択**: localStorage は同期 API（メインスレッドをブロック）・約 5MB・文字列のみ。IndexedDB は非同期・構造化データ・大容量 [B] <https://dev.to/tene/localstorage-vs-indexeddb-javascript-guide-storage-limits-best-practices-fl5>。起票フォーム程度の小さな下書きなら localStorage で十分だが、保存トリガーが高頻度（keyup 毎）なら非同期の IndexedDB が安全
- **Safari ITP の 7 日削除**: Safari 13.1/iOS 13.4 以降、7 日間サイト訪問がないとスクリプト書き込み可能ストレージ（localStorage・IndexedDB・SW 登録含む）が全削除される。**ホーム画面追加（PWA インストール）した場合は対象外** [A] <https://support.didomi.io/apple-adds-a-7-day-cap-on-all-script-writable-storage>（Webkit 公式ブログ由来）→ インストール誘導は下書き保全の観点でも重要
- **再送キュー**: Workbox `workbox-background-sync` は失敗 POST を IndexedDB にキューしオンライン復帰時に再送（`maxRetentionTime` 標準約 24 時間）。**ネットワーク到達不能のみ対象で 4xx/5xx は再送対象外** → GitHub API の 422/403 等はアプリ側で明示的に「要修正」表示が必要 [A] <https://developer.chrome.com/docs/workbox/modules/workbox-background-sync>
- **エラーメッセージ設計（NN/g）** [A] <https://www.nngroup.com/articles/error-message-guidelines/>: エラー発生箇所の近傍に表示・人間可読・非難しないトーン・建設的な次アクション提示・**フィールドの入力内容は保持**（再入力を強制しない）
- **GitHub REST API エラーのユーザー向け表示** [A] <https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api> / <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>:
  - 401 → 「セッション切れ」+ 再ログイン導線（下書き保持のまま）
  - 403/429（レート制限）→ `retry-after` / `x-ratelimit-reset` を解析し「あと◯分で再送できます（下書きは保存済み）」
  - 404 → プライベートリポジトリの権限不足は意図的に 404 が返る仕様（存在秘匿）。「リポジトリが見つからないか、権限がありません」と表示
  - 422 → `errors[].field` をフィールド直下のエラー表示にマッピング
- **保存トリガー（ブラウザ標準）**: `beforeunload` はモバイルで信頼できない（発火しないケースを MDN が明言・bfcache 阻害）[A] <https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event>。下書き保存は **`visibilitychange`（hidden 遷移時 = 確実に観測できる最後のタイミング）と `pagehide`** でトリガーする [A] <https://developer.chrome.com/docs/web-platform/page-lifecycle-api>

## 6. アクセシビリティ・片手操作・ダークモード

- **コントラスト比（WCAG AA / Apple HIG 同値）**: 通常テキスト **4.5:1**・大きいテキスト（18pt 以上）**3:1** [A] <https://developer.apple.com/design/human-interface-guidelines/accessibility>。ライト/ダーク両アピアランスで検証する
- **Thumb zone（親指到達圏）**: Steven Hoober の実地観察研究（1,333 件）で片手グリップ 49%・**タップ操作の 75% が親指駆動** [A] <https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php>。画面を green（届く）/ stretch / red（届きにくい）に分類し、頻度の高い操作は画面下部に置く [B] <https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/> → 送信ボタンは画面下部固定（sticky footer）・上部ナビに主要アクションを置かない
- **フォーカス管理**: エラー時・画面遷移時にフォーカスを見失わせない（WCAG 2.4.3 Focus Order / 2.4.11 Focus Not Obscured (Minimum)・2.2 で追加）[A] <https://www.w3.org/WAI/WCAG22/Understanding/>
- **ダークモード**: `color-scheme: light dark` + `prefers-color-scheme` メディアクエリで OS 設定に追従（本リポジトリは `index.css` で `color-scheme` 宣言済み）。ダークファースト設計がユーティリティアプリで主流化 [C] <https://uxpilot.ai/blogs/mobile-app-design-trends>（トレンド参考・断定しない）
- **モーション配慮**: アニメーションは `prefers-reduced-motion: reduce` 時に無効化する [A] <https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion>。既定でも遷移アニメーションは最小限に（起票速度最優先のミッションと整合）

## 7. デザイン原則の機械チェック化・レビュー体制・トレンド

- **axe-core（@axe-core/playwright）**: `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag22aa']).analyze()` → `violations` 空を assert。`color-contrast` は既定有効。**`target-size` ルール（WCAG 2.2 SC 2.5.8 対応・axe-core 4.5 で追加）はデフォルト無効** のため `wcag22aa` タグの明示が必須 [A] <https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md> / <https://www.deque.com/blog/axe-core-4-5-first-wcag-2-2-support-and-more/>
- **Playwright での KPI 計測**: `element.boundingBox()` でタップターゲット実寸を検証（axe の target-size 無効時の補完）・`test.use({ colorScheme: 'dark' })` でダークモード検証・`performance.now()` 差分で所要時間計測・タップ数はテストシナリオの操作ステップ数で表現 [A] <https://playwright.dev/docs/emulation> / <https://playwright.dev/docs/test-use-options>
- **Lighthouse CI**: `lighthouserc` の `assert.assertions` で `categories:performance` / `categories:accessibility` に `minScore` を設定。GitHub Actions は `treosh/lighthouse-ci-action` が定番・複数回実行の中央値推奨 [A] <https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md>。**Lighthouse v12（2024）で PWA カテゴリは廃止**（installability は Chrome DevTools 側が正）[A] <https://developer.chrome.com/docs/lighthouse/pwa/installable-manifest>
- **バンドルサイズ予算**: Vite の `build.chunkSizeWarningLimit` は warning のみで CI 失敗しない [B] <https://github.com/vitejs/vite/discussions/9440>。ハード失敗させるなら `size-limit`（exit non-zero・PR サイズ差分コメント連携あり）[A] <https://github.com/andresz1/size-limit-action>
- **レビュー体制のベストプラクティス**: 数値基準（24px/48px・4.5:1・16px・INP 200ms）は機械チェックに落とし、機械化できない原則（タップ数追加の判断・情報階層・文言トーン）はチェックリスト + レビュー観点として明文化する（本プロジェクトの self-review-checklist 方式と整合）
- **2025〜2026 トレンド（ユーティリティアプリ関連・参考）**: 意図的ミニマリズム（全要素が存在理由を持つ）・ボトムシートの標準化・ダークモード標準化・過剰アニメーション排除 [C] <https://muz.li/blog/whats-changing-in-mobile-app-design-ui-patterns-that-matter-in-2026/> ほか（トレンド記事は要検証情報として参考に留める）

---

## official_names（正式名称確認）

| term | official | 日本語 | 根拠 |
|------|----------|--------|------|
| WCAG 2.2 タップターゲット基準 | Success Criterion 2.5.8 Target Size (Minimum)（Level AA） | ターゲットのサイズ（最小） | s007 |
| INP | Interaction to Next Paint | — | s019 |
| Todoist の高速入力機能 | Quick Add | クイック追加 | s001 |
| Apple のデザインガイドライン | Human Interface Guidelines (HIG) | ヒューマンインターフェイスガイドライン | s009 |
| Google のデザインシステム | Material Design 3 (M3) | マテリアルデザイン 3 | s025 |
| Enter キー表示属性 | enterkeyhint（HTML グローバル属性） | — | s010 |
| Workbox の再送モジュール | workbox-background-sync | — | s031 |
| React 19 楽観的更新 Hook | useOptimistic | — | s022 |
| Safari のトラッキング防止機構 | Intelligent Tracking Prevention (ITP) | — | s030 |
| アクセシビリティ検査エンジン | axe-core | — | s036 |

## fact_check_flags（未確認・要レビュー事項: 4 件・rank C なし）

| # | claim | rank | reason |
|---|-------|------|--------|
| 1 | Chrome for Android の manifest shortcuts 表示上限「3 件」 | B | web.dev 記事（2020 年掲載・Chrome 92 期）の実装値で仕様保証がない。実装時に実機確認する | 
| 2 | M3 テキストフィールドの標準高さ 56dp | B | m3.material.io が JS レンダリングで本文直接取得不可。検索スニペット・複数実装リポジトリでの裏取りに留まる |
| 3 | iOS Safari は input フォントサイズ 16px 未満でフォーカス時に自動ズームする | B | 挙動は広く再現されているが Apple 公式ドキュメントの明文が存在しない（業界標準リファレンス CSS-Tricks 由来） |
| 4 | ホーム画面追加した PWA は Safari ITP 7 日削除の対象外 | B | WebKit 公式ブログ由来の二次まとめで確認。iOS 実機での長期検証はしていない |

## 出典（主要ソース一覧・ランク付き）

| id | rank | URL |
|----|------|-----|
| s001 | A | <https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz> |
| s002 | A | <https://www.todoist.com/inspiration/add-tasks-todoist> |
| s003 | A | <https://www.todoist.com/help/articles/use-a-todoist-widget-on-your-android-device-632pZA> |
| s004 | A | <https://docs.getdrafts.com/gettingstarted/> |
| s005 | A | <https://github.blog/changelog/2023-07-13-improved-issue-creation-experience-for-github-mobile/> |
| s006 | B | <https://discourse.wicg.io/t/how-should-browsers-treat-the-autofocus-attribute-on-mobile-devices/5238/> |
| s007 | A | <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html> |
| s008 | A | <https://support.google.com/accessibility/android/answer/7101858> |
| s009 | A | <https://developer.apple.com/design/human-interface-guidelines/accessibility> |
| s010 | A | <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/enterkeyhint> |
| s011 | A | <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode> |
| s012 | A | <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/autocapitalize> |
| s013 | B | <https://css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom/> |
| s014 | A | <https://www.nngroup.com/articles/form-design-placeholders/> |
| s015 | A | <https://developer.chrome.com/blog/viewport-resize-behavior> |
| s016 | A | <https://web.dev/articles/app-shortcuts> |
| s017 | A | <https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/shortcuts> |
| s018 | A | <https://developer.chrome.com/blog/update-install-criteria> |
| s019 | A | <https://web.dev/articles/vitals> |
| s020 | A | <https://web.dev/articles/defining-core-web-vitals-thresholds> |
| s021 | A | <https://www.nngroup.com/articles/response-times-3-important-limits/> |
| s022 | A | <https://react.dev/reference/react/useOptimistic> |
| s023 | B | <https://www.smashingmagazine.com/2016/11/true-lies-of-optimistic-user-interfaces/> |
| s024 | B | <https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/> |
| s025 | A | <https://developer.android.com/guide/topics/ui/accessibility/apps> |
| s026 | B | <https://m3.material.io/components/text-fields/specs> |
| s027 | A | <https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php> |
| s028 | B | <https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/> |
| s029 | B | <https://dev.to/tene/localstorage-vs-indexeddb-javascript-guide-storage-limits-best-practices-fl5> |
| s030 | A | <https://support.didomi.io/apple-adds-a-7-day-cap-on-all-script-writable-storage> |
| s031 | A | <https://developer.chrome.com/docs/workbox/modules/workbox-background-sync> |
| s032 | A | <https://www.nngroup.com/articles/error-message-guidelines/> |
| s033 | A | <https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api> |
| s034 | A | <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api> |
| s035 | A | <https://developer.chrome.com/docs/web-platform/page-lifecycle-api> |
| s036 | A | <https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md> |
| s037 | A | <https://www.deque.com/blog/axe-core-4-5-first-wcag-2-2-support-and-more/> |
| s038 | A | <https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md> |
| s039 | A | <https://developer.chrome.com/docs/lighthouse/pwa/installable-manifest> |
| s040 | A | <https://github.com/andresz1/size-limit-action> |
| s041 | A | <https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion> |
| s042 | A | <https://web.dev/learn/pwa/web-app-manifest> |
| s043 | A | <https://web.dev/learn/pwa/caching> |
| s044 | A | <https://web.dev/case-studies/twitter> |
| s045 | A | <https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event> |
| s046 | A | <https://playwright.dev/docs/emulation> |
| s047 | C | <https://muz.li/blog/whats-changing-in-mobile-app-design-ui-patterns-that-matter-in-2026/>（トレンド参考・本文で断定に不使用） |

## 反証済み主張（ガイドラインで断定禁止）

- ❌ 「Chrome の beforeinstallprompt 経由インストールには今も fetch() ハンドラが必要」（3 票中 3 反証）
- ❌ 「manifest は全ブラウザのインストール要件で必須」（3 票中 2 反証）
