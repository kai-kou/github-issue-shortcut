# リサーチ: Android/PWA クイック起票 UX（2026-07-10 実施）

> 専門リサーチチーム（モバイル UX 班）による調査結果の要約。全て 2026-07-10 時点の一次情報で検証済み。

## 1. Todoist クイック追加 UX の分解

- 公式ドキュメントで確認できた構成要素: スマート入力（`@ラベル` `#プロジェクト` `p1〜p3` 優先度・自然言語日付をタイプ中にインライン認識・ハイライト表示、タップで解除）+ 入力中に出るタスクアクション行（優先度・日付・ラベル等・カスタマイズ可）+ Android のクイック設定タイル「Add Task」。
  出典: <https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz> / <https://www.todoist.com/help/articles/add-an-add-task-quick-setting-tile-on-android-F5QYjq>
- Todoist Web は `https://todoist.com/add?content=...` というクイック追加 URL を持ち、公式埋め込みウィジェット `@doist/todoist-quickadd` は **プレフィルのみで自動送信しない**（安全パターン）。Todoist Web 自体は PWA だが manifest に `shortcuts` も `share_target` もない。
  出典: <https://github.com/Doist/todoist-quickadd> / <https://app.todoist.com/manifest.json>
- GitHub Mobile（ネイティブ）は 2023-07 に作成 UX を改善済み: ホームの「+」→ compose、メタデータは **キーボード上部の action pills（チップ）** で追加。チップ UI の直接の先行事例。
  出典: <https://github.blog/changelog/2023-07-13-improved-issue-creation-experience-for-github-mobile/>

## 2. Web/PWA での再現可能性と限界

### 再現できるもの
- **ボトムシート**: `<dialog>`（Baseline）/ Popover API（2025-01 Baseline）/ CSS scroll-snap、React なら vaul（shadcn/ui Drawer の中身）や react-modal-sheet。M3 のボトムシート設計指針あり。
  出典: <https://web.dev/blog/popover-baseline> / <https://github.com/emilkowalski/vaul> / <https://m3.material.io/components/bottom-sheets>
- **キーボードとボトムシートの共存**: `<meta name="viewport" content="... interactive-widget=resizes-content">`（Chrome 108+）で、キーボード表示時に bottom-fixed UI が押し上げられる。JS 不要の最簡ルート。
  出典: <https://developer.chrome.com/blog/viewport-resize-behavior>
- **スマート入力（トークン認識）**: 純粋なアプリロジックなので再現可能。

### 再現できないもの（最重要の制約）
- **コールドローンチ時のキーボード自動表示は不可能**。Android Chrome では `autofocus`/`focus()` はカーソル表示のみでキーボードは開かない（ユーザージェスチャ内の `focus()` のみキーボードが開く）。standalone PWA でも同じ。`navigator.virtualKeyboard.show()` も逃げ道にならない。
  出典: <https://discourse.wicg.io/t/how-should-browsers-treat-the-autofocus-attribute-on-mobile-devices/5238/> / <https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard/show>
  - **緩和策**: 起動面の最初のタップをジェスチャとして使う（プレースホルダ入力欄タップ→同期的に `focus()`）＝「起動→1 タップ→キーボード」まで縮められる。

## 3. 起動導線（Android）

- **manifest `shortcuts`**: アイコン長押しメニュー。**Android Chrome は最大 3 個**。静的（manifest 更新→WebAPK 更新は約 24 時間周期・`SHORTCUTS_DIFFER` が更新トリガー）。URL にクエリパラメータ可（`/new?repo=...&labels=...`）。アイコンは PNG 96px 以上推奨。
  出典: <https://web.dev/articles/app-shortcuts> / <https://web.dev/articles/manifest-updates>
- **インストール**: 要件を満たす PWA は WebAPK 化（アプリ一覧・intent filter 登録・ショートカット/バッジ対応）。manifest に `screenshots`/`description` を足すと Play ストア風のリッチインストール UI。
  出典: <https://web.dev/articles/webapks> / <https://web.dev/patterns/web-apps/richer-install-ui>
- **複数ショートカットアイコン**: Chrome の「ホーム画面に追加 → ショートカットを作成」でクエリパラメータ付き URL のアイコンを複数置ける（ブラウザバッジ付き・二級市民）。**ただしタップ時に standalone WebAPK で開くかブラウザタブで開くかは公式ドキュメントで未確認**（要実機検証・リスク項目）。確実なのは manifest shortcuts（3 個まで）+ share_target + アプリ内リンク。
  出典: <https://web.dev/learn/pwa/installation>
- **Web Share Target**: インストール済み PWA が Android 共有シートに出る（Chrome 76+・GET でクエリパラメータ受取）。**Android は共有 URL が `text` フィールドに入ることが多い**（`url` は空）→ text から URL 抽出処理が必要。manifest 変更後は再インストールが必要な場合あり。
  出典: <https://developer.chrome.com/docs/capabilities/web-apis/web-share-target> / <https://github.com/w3c/web-share-target/issues/81>
- **launch_handler / launchQueue**: 起動 URL の受け取り制御（experimental・Chromium）。モバイルは実質 navigate-existing 挙動。
  出典: <https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/launch_handler>

## 4. 起動速度

- Service Worker 起動コストはモバイルで **約 250ms**（低速機で 500ms+）。app shell を precache（Workbox generateSW）すれば再訪 LCP はサブ秒が現実的。認証で HTML が動的な場合は navigation preload。
  出典: <https://web.dev/blog/navigation-preload> / <https://developer.chrome.com/docs/workbox/app-shell-model>
- Twitter Lite 事例: app shell 化で再訪 3 秒未満・**投稿数 75% 増**（compose 摩擦低減が投稿量を増やす直接証拠・2017 データ）。
  出典: <https://web.dev/case-studies/twitter>

## 5. オフライン・信頼性パターン

- **Workbox BackgroundSyncPlugin**: 失敗した POST を IndexedDB にキューし、回復時に再送（約 24h 保持）。**ネットワーク失敗のみ対象で 4xx/5xx は再送されない**→ API エラーは別途 UI 処理。
  出典: <https://developer.chrome.com/docs/workbox/modules/workbox-background-sync>
- 楽観的 UI（即時成功表示 + 失敗時の救済導線）は React 19 `useOptimistic` で標準サポート。
  出典: <https://react.dev/reference/react/useOptimistic>

## 6. 将来のネイティブ化パス

- **TWA（Bubblewrap v1.24.1・現役）**: 常にライブサイトを表示するためストア再リリース不要。web manifest の `shortcuts` を **ネイティブ App Shortcuts に自動変換** する機能あり（`twa-manifest.json` の `shortcuts`）。制約: ネイティブ API ブリッジなし（通知委譲のみ）。ホーム画面 **ウィジェット** は理論上同居可能だが公式事例なし（カスタムネイティブコード保守が必要）。
  出典: <https://github.com/GoogleChromeLabs/bubblewrap> / <https://developer.chrome.com/docs/android/trusted-web-activity/>
- **Capacitor**: ランタイムショートカット（`@capawesome/capacitor-app-shortcuts`）やウィジェット（要ネイティブコード）が必要になったら選択肢。ただし Web 資産をバンドルするため **リリースごとにストア更新が必要**。
  出典: <https://capawesome.io/plugins/app-shortcuts/>
- **PWA `widgets` manifest は Edge/Windows 専用** で Android には来ていない → Android ウィジェットが必要なら TWA+ネイティブコード or Capacitor。
  出典: <https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/widgets>

## 7. MVP の UX と将来拡張ロードマップ（提案）

1. **MVP**: 起動即入力画面（app shell precache・SW 250ms + サブ秒表示）。「起動→タップ→入力→送信」= 実質 3 アクション。送信は楽観的 UI + 失敗時下書き保全。
2. **M2**: manifest shortcuts（最大 3 リポジトリ×ラベルプリセット）+ URL パラメータ起動（`/new?repo=&labels=`）+ Web Share Target。
3. **M3**: Todoist 風スマート入力（`@label` `#repo` トークン）+ ボトムシート UI（vaul）+ オフラインキュー（Background Sync）。
4. **M4**: TWA 化して Play 配布・ネイティブ App Shortcuts。ウィジェットは需要が立ってから。
