<!-- discussion_whiteboard:auto -->
# 🧑‍🏫 議論ホワイトボード: サイドパネル(左ナビゲーションドロワー)UI改修の客観レビュー

- 議題ID: `sidepanel-review`
- 論点: PR #113 でログイン状態・ログアウト・アカウント削除・ショートカット作成・言語・規約を左スライドの native dialog ドロワーへ集約。メインは起票フロー+ショートカット一覧を維持。トップバー右にアカウントチップ。観点: UX/デザインガイドライン準拠・a11y(focus/aria/inert/見出し)・コード正確性(開閉同期/backdrop判定/キャッシュ消去)・E2Eカバレッジ十分性。
- 参加者: `design_ux`, `a11y`, `correctness`, `e2e_cov`
- 投稿数: 10
- 更新: 2026-07-19T20:05:05+09:00

> このファイルは `tools/discussion_whiteboard.py render` が自動生成する。直接編集せず `post` で追記すること（同時書き込み破損防止）。

## ラウンド 1

### `e2e_cov` — 主張
<sub>2026-07-19T19:53:43+09:00</sub>

## E2E カバレッジ評価（サイドパネル / NavDrawer）

### 既カバー（login.spec.ts）
- ハンバーガー（`メニューを開く|Open menu`）クリックでドロワーを開いてからログアウトボタンを操作（L27-28）
- 同経路でアカウント削除ボタンを操作（L56-58）
- いずれもドロワーを開く行為自体は「ログアウト/削除の前段」として通っているだけで、開閉の挙動そのもの（アサーション対象）ではない
- 専用の `e2e/nav-drawer.spec.ts` は存在せず（grep 済み: 他 spec に `NavDrawer`/`side-drawer`/`account-chip` の参照なし）、ドロワー固有挙動は login.spec.ts の副産物としてのみ触れられている

新規 `e2e/nav-drawer.spec.ts` を作り、以下を追加すべき（`configureMockRepo`/`resetMockRepo` ヘルパーは a11y.spec.ts から流用、ログインは `page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click()` の書き味に合わせる）。

### 未カバー項目と追加テスト案

**① ハンバーガーでドロワーが開く / must**
```ts
test("ハンバーガーでドロワーが開く", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /メニューを開く|Open menu/ }).click();
  await expect(page.getByRole("dialog", { name: /メニュー|Menu/ })).toBeVisible(); // aria-label=t.nav.title 想定
});
```
※ `<dialog>` の role は `dialog`。`t.nav.title` の実文言確認要（i18n/ja.ts, en.ts）。

**② アカウントチップでも開く / must**（未ログイン時はチップ非表示のため要ログイン）
```ts
test("アカウントチップでもドロワーが開く", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
  await expect(page.getByText(/e2e-user/)).toBeVisible();
  await page.getByRole("button", { name: /e2e-user/ }).click(); // account-chip
  await expect(page.getByRole("button", { name: /ログアウト|Sign out/ })).toBeVisible();
});
```

**③ Escape で閉じる / must**（`<dialog>` ネイティブ挙動だが回帰防止のため明示テスト必須。onClose ハンドラが React state と同期していない場合に壊れうる）
```ts
test("Escape キーでドロワーが閉じる", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /メニューを開く|Open menu/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});
```

**④ backdrop クリックで閉じる / must**（NavDrawer.tsx L35-37 の `handleBackdropClick` は target === dialogRef.current の自前判定。ロジックバグ（誤って本文クリックでも閉じる/閉じない）を検出できるのは e2e のみ）
```ts
test("backdrop クリックでドロワーが閉じる", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /メニューを開く|Open menu/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // dialog 要素自体（backdrop 領域）の左上隅をクリックし、内部コンテンツは避ける
  await dialog.click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeHidden();
});
```

**⑤ ×ボタンで閉じる / must**
```ts
test("×ボタンでドロワーが閉じる", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /メニューを開く|Open menu/ }).click();
  await page.getByRole("button", { name: /^×$|閉じる|^Close$/ }).click(); // aria-label=t.nav.closeMenu の実文言確認要
  await expect(page.getByRole("dialog")).toBeHidden();
});
```
※ 現状 `aria-label={t.nav.closeMenu}` の値がロード見た限り不明（`×` はテキストノードで aria-hidden ではない）。実文言を i18n ファイルで確認しセレクタを確定する必要あり。

**⑥ ドロワー内リンク遷移（ショートカット作成/規約/プライバシー）/ should**
```ts
test("ドロワーからショートカット管理ページへ遷移する", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /メニューを開く|Open menu/ }).click();
  await page.getByRole("link", { name: t.nav.manageShortcuts /* 実文言 */ }).click();
  await expect(page).toHaveURL(/\/shortcuts$/);
  await expect(page.getByRole("button", { name: /^保存$|^Save$/ })).toBeVisible();
});
// 規約・プライバシーも同型で2ケース追加（drawer-nav-link href="/terms" / "/privacy"）
```
既存 a11y.spec.ts はショートカットページに直接 `page.goto("/shortcuts")` で到達しており、ドロワー経由の導線自体は未検証（リンクの `href` とラベルの対応がズレていても既存テストは検出できない）。

**⑦ ドロワー内の言語切替が効く / should**（`LanguageSwitcher` はドロワー内に再配置されたが、切替後の反映を e2e で見ていない。単体テストの可能性はあるが e2e で UI 反映を1件担保すべき）
```ts
test("ドロワー内の言語切替でUI言語が切り替わる", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /メニューを開く|Open menu/ }).click();
  await page.getByRole("button", { name: /English|英語/ }).click(); // LanguageSwitcher の実セレクタ確認要
  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible(); // ハンバーガーaria-labelが英語化
});
```

**⑧ 匿名時のドロワー内ログインボタン / must**（NavDrawer.tsx L62-76: `auth.status === "anonymous"` 分岐は未ログイン時にドロワーを開けること自体が既存 login.spec.ts で通っていない。login.spec.ts はトップページのログインリンクのみ経由）
```ts
test("未ログイン時、ドロワー内にもログイン導線がある", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /メニューを開く|Open menu/ }).click();
  await expect(page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ })).toBeVisible();
});
```

**⑨ 閉→開でフォーカスがトリガーへ戻る / must**（フォーカス管理はアクセシビリティ上重要。`<dialog>` ネイティブは close() 時にフォーカスを呼び出し元へ戻す仕様だが、`onClose={onClose}` 経由の React 制御下で実際に機能しているかは e2e でしか確認できない。design-guidelines D-6 相当の要件と推測）
```ts
test("ドロワーを閉じるとハンバーガーへフォーカスが戻る", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: /メニューを開く|Open menu/ });
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});
```

**⑩ メインに起票フロー＋ショートカット一覧が残ること / should**（ドロワー開閉がメインコンテンツの DOM ツリーを破壊/アンマウントしないことの回帰防止。App.tsx L118-158 の `<main>` はドロワーと兄弟要素だが、`<dialog>` の実装変更で誤って main を巻き込む regression を検出する網が現状ない）
```ts
test("ドロワー開閉後もメインの起票フローとショートカット一覧が保持される", async ({ page }) => {
  await configureMockRepo(request); // beforeEach 相当
  await page.goto("/");
  await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
  await page.getByRole("button", { name: "kai-kou/alpha" }).click();
  await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toBeVisible();

  await page.getByRole("button", { name: /メニューを開く|Open menu/ }).click();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toBeVisible(); // main が保持されている
});
```

### 優先度サマリー
- must（6件）: ①②③④⑤⑧⑨ → 7件（数え直し: ①②③④⑤⑧⑨で7件。基本操作・アクセシビリティの根幹）
- should（3件）: ⑥⑦⑩
- nice: なし（全項目がユーザー影響のある回帰リスクと判断）

### 補足
- `<dialog>` の native focus-trap / Escape / backdrop 挙動に依存する設計（NavDrawer.tsx コメント L21）ゆえに、**モバイルエミュレーション（Pixel 7・playwright.config.ts）でのブラウザ実装差**が唯一の検証手段。単体テスト（jsdom）は `<dialog>` の showModal 非対応のため代替にならず、e2e が必須。
- ⑨（フォーカス復帰）と④（backdrop）はロジックにバグが混入しやすい箇所（自前 target 判定・React state 同期）であり、既存の login.spec.ts はこれらを一切踏んでいない。カバレッジの穴として最優先で埋めるべき。

### `a11y` — 主張
<sub>2026-07-19T19:54:58+09:00</sub>

# a11y レビュー: NavDrawer（左ナビゲーションドロワー）＋トップバー

## 1. [critical] × ボタン／backdrop クリックで閉じるとフォーカスがトリガーに復帰しない（body に落ちる）

- file: `src/nav/NavDrawer.tsx:27-32`（同期先 effect）, `:47-54`（close ボタン onClick）, `:35-37`（backdrop）
- 問題: `open` state を `false` にする同じレンダーで `{open ? <div className="side-drawer-body">...</div> : null}` が children を **即座にアンマウント** する（App.tsx の menuOpen state と同一の条件）。React のコミットはこの unmount を同期的に DOM へ反映するが、`dialog.close()` を呼ぶのは **後段の `useEffect`（passive effect）**。
  - × ボタン / backdrop クリック時のフローは `onClick={onClose}` → 直接 `setMenuOpen(false)` → 再レンダーで children（フォーカスされていた × ボタン自身を含む）が DOM から除去される → ブラウザは「フォーカス中の要素が DOM から消えた」ため `document.activeElement` を即座に `<body>` へ移す（この時点ではまだ `dialog.close()` は呼ばれておらず `dialog.open` は true のまま）→ その後 `useEffect` が発火し `dialog.close()` を実行。
  - HTML 標準の dialog closing steps は「現在のフォーカスが dialog の子孫かどうか（insideDialog）」を close() 実行時点でチェックし、true の場合のみ `previouslyFocusedElement`（＝ハンバーガー or アカウントチップ）へフォーカスを復帰する。上記の unmount 済み child により close() 実行時点で `insideDialog` は既に false（focus は body）になっているため、**ネイティブのフォーカス復帰処理がスキップされる**。
  - 結果: × ボタン／backdrop で閉じた直後、キーボード/SR ユーザーのフォーカスが `<body>` 相当へ失われ、トリガー（ハンバーガー・アカウントチップ）に戻らない。WCAG 2.4.3（Focus Order）相当の実害。
- Escape キーでの close は影響を受けない: ブラウザが Escape を検知して同期的に close 処理（フォーカス復帰含む）を先に実行し、その後 `close` イベント→ React の `onClose` prop → `setMenuOpen(false)` が発火する順序のため、close() 実行時点ではまだ children がマウントされておりフォーカスは dialog 内にある。つまり **同じコンポーネントで閉じる導線ごとにフォーカス復帰の挙動が異なる**（Escape だけ正しい）。
- 推奨修正: children を `open` に連動してアンマウントするのをやめる（常時マウントして CSS `dialog:not([open])` の UA デフォルト非表示に任せる）か、× ボタン/backdrop のハンドラでも `onClose()` ではなく `dialogRef.current?.close()` を直接呼び、close イベント経由で state を更新する（Escape と同じ経路に統一する）。もしくは open→false の直前に明示的に `triggerRef.current?.focus()` を呼ぶフォールバックを実装する。

## 2. [major] 認証済みホームに `<h1>` が一切存在しない

- file: `src/App.tsx:118-158`（`auth.status !== "authenticated"` の時だけ `<h1 className="hero-title">` を出す）
- `ShortcutList`/`RepoPicker` にも見出し要素なし（grep で `<h[1-6]` 該当ゼロ）。認証済みユーザーは `<main>` 内に見出しが1つも無いページに着地する。見出しジャンプ（NVDA/JAWS の H キー）で辿るスクリーンリーダーユーザーの主要な巡回手段が機能しない。
- ドロワー内の `<h2>` は `<dialog>`（top-layer・独立したモーダルコンテキスト）内なので、開くまでメイン文書のアウトラインには寄与しない。
- axe の `wcag2a`/`wcag2aa`/`wcag22aa` タグには `page-has-heading-one`（best-practice ルール）が含まれないため、`e2e/a11y.spec.ts` では検出されない。かつ同スペックは認証済みホーム（`gotoIssueFormScreen` 後の画面）自体を axe でスキャンしていない（起票フォーム画面のテストはドロワーの外側の状態）。
- 推奨修正: 認証済みホームにも（視覚的に隠してよいので）`<h1>{t.home.title}</h1>` を追加する。

## 3. [minor] a11y テストがドロワーを一度も開かない

- file: `e2e/a11y.spec.ts`（全文確認済み・3 テストとも `menuOpen` を true にする操作なし）
- axe スキャン対象にドロワー内容（aria-labelledby・見出し・フォームコントロール）が一度も含まれておらず、上記 #1 のフォーカス復帰バグも検出できない。
- 推奨修正: ハンバーガーをクリックしてドロワーを開いた状態で axe スキャンするテストと、×/Escape/backdrop それぞれで閉じた後に `document.activeElement` がトリガーへ戻ることを検証する Playwright テストを追加する。

## 4. [minor] ドロワー内の見出しが h2 から始まる（h1 なし）

- file: `src/nav/NavDrawer.tsx:56-123`（4 セクション全て `<h2>`、dialog 自体は `aria-label` のみで見出し要素なし）
- `<dialog>` はモーダル化すると多くの SR で独立文書的に扱われるため、h2 始まりは軽微な逸脱。`aria-label="メニュー"` がアクセシブルネームを担保しているため実害は小さいが、望ましくは `aria-label` を保ちつつ視覚上隠した `<h1>`（または最初のセクションを h1 化）を検討。

## 5. [minor] 初回オープン時のフォーカス移動先が「閉じるボタン」

- file: `src/nav/NavDrawer.tsx:47-54`
- children は `showModal()` 呼び出し前に既にマウント済みのため、DOM 順で最初のフォーカス可能要素（ヘッダーの × ボタン）に自動的にフォーカスが移る（仕様準拠で正しく動作している点は確認済み）。ただし UX として「開いた瞬間に真っ先に "閉じる" へフォーカス」が意図どおりか要確認。問題ではなく設計判断の確認事項。

## 6. [verified OK] コントラスト比は基準を満たす

- `--color-text-muted` on `--color-surface`: ライト `#59636e` on `#ffffff` ≈ **6.1:1**、ダーク `#9198a1` on `#161b22` ≈ **5.9:1**。いずれも通常テキストの WCAG AA 4.5:1 を満たす（`.drawer-section-title` 含む）。指摘なし。

## 7. [verified OK / 要確認事項] 背景の inert 化はネイティブ dialog に依存

- `showModal()` 中は HTML 標準により他要素が自動的に `inert`（フォーカス不可・AT から除外）になるため、追加の `aria-hidden`/`inert` 実装は不要（現状の実装で問題なし）。ただし対象ブラウザの最低ラインが inert-on-modal-dialog 未対応の古い WebView を含む場合、背景コンテンツが SR に漏れる可能性がある点だけ留意（PWA の対象ブラウザ次第・実装変更は不要、確認のみ）。

### `design_ux` — 主張
<sub>2026-07-19T19:55:46+09:00</sub>

## design_ux（UX / デザインガイドライン準拠）— PR #113 サイドパネル UI 改修レビュー Round 1

### 1. [major] 言語切替・ショートカット管理・規約へのアクセスが 0 タップ→2 タップ以上に後退（最小操作原則の後退）
- **file**: `src/App.tsx`（`HomeView`、新設）/ 旧実装は `git show c80c5c1 -- src/App.tsx` で確認可能な削除済み `<footer className="app-footer">`（`/shortcuts` `/terms` `/privacy` リンク + `LanguageSwitcher` を常時表示）
- **問題**: 本 PR 以前は Home 画面下部に **常時表示** の footer があり、言語切替（`<select>`）・ショートカット管理・規約・プライバシーへ **0 タップ** で到達できた。本 PR で Home の footer は完全撤去され、これらはすべて `NavDrawer`（`src/nav/NavDrawer.tsx:97-123`）内に移動した。現状、言語切替 1 つとっても「ハンバーガー / アカウントチップをタップ → ドロワーが開く → 設定セクションまでスクロール → `<select>` を操作」という最低 2 タップ + スクロールが必要になった。
- **なぜ重要か**: `design-guidelines.md` の D-3 は起票フロー本体（起動→入力→送信）への追加タップを禁じているが、それ以外の頻用操作（特に言語切替はバイリンガル利用者が起票のたびに切り替える可能性がある）についても、既存 UI が満たしていた「0 タップ到達」を後退させる変更は、レビュー観点で明示されている「最小操作で完了」の精神に反する。ドロワー化自体は D-1（キャプチャとトリアージの分離）の趣旨には沿うが、トレードオフの記録がコミットメッセージ・PR 説明に見当たらない。
- **推奨対応**: (a) 言語切替だけは footer 相当の常時表示コントロールとして残す、または (b) この後退が意図的な設計判断であることを PR 説明文の「設計意図」に明記し、KPI（初回セットアップ 5 分以内・起票 10 秒以内）への影響がないことを確認する。

### 2. [major] 右上アカウントチップが左スライドのドロワーを開く空間的不整合（レンズ担当としての明示評価依頼）
- **file**: `src/App.tsx:98-100`（`menu-trigger`＝左上ハンバーガー）と `src/App.tsx:111-114`（`account-chip`＝右上、同一 `NavDrawer` を `setMenuOpen(true)` で起動）
- **問題**: ハンバーガー（左上）とアカウントチップ（右上）という異なる位置にある 2 つのトリガーが、常に「左からスライドインする同一ドロワー」を開く。ユーザーがチップを右上でタップした直後に UI が反対側の左端から出現する。
- **なぜ重要か**: モバイル UI の一般的な空間対応（Fitts's Law / spatial mapping）では、タップ位置と出現位置が一致すると学習コストが下がる。左ハンバーガー→左ドロワーは標準的だが、右チップ→左ドロワーは初見ユーザーに「誤操作では」という違和感を与えうる。ただし本ガイドライン（D-1〜D-10）にこの点を直接規定する条文はなく、これは一般的なユーザビリティ知見に基づく所見であり実測データはない点は明記する。
- **推奨対応**: 実装を変える前に、最小コストの検証（例: 5 人程度のユーザビリティテスト、または既存 E2E に「チップタップ→開くドロワーの視認性」を確認するステップを足す）を推奨。設計判断として維持するなら、チップの視覚的つながり（例: チップから左上ハンバーガーへ視線誘導するアニメーション方向のヒント）を検討する余地がある。

### 3. [minor] ドロワー内リンク行に遷移であることを示す視覚的アフォーダンスがない
- **file**: `src/nav/NavDrawer.tsx:101-103`（`ショートカットを作成・管理` → `/shortcuts`）、`:117-122`（規約・プライバシー）
- **問題**: `drawer-nav-link`（`src/App.css:876-882`）は色付きテキストのみで、同じセクション内の「アカウント」（その場で完結する操作＝ログアウト・削除ボタン）と「ショートカット/情報」（別画面へ遷移するリンク）が視覚的に区別されていない。
- **なぜ重要か**: ドロワー内での発見可能性・行動予測性に軽微な影響。遷移系と非遷移系操作が同一の行スタイルだと、どちらが「その場で完結」か「別画面に飛ぶ」かが事前に分からない。
- **推奨対応**: 遷移リンクには外部/内部遷移を示す軽量なインジケーター（例: `›` サフィックス）を付けるか、`design-review-checklist.md` に今後の目視観点として追記する。

### 4. [minor] 新設インタラクティブ要素（ドロワー・チップ・ハンバーガー）が機械タップターゲット検証の対象外
- **file**: `e2e/design-guidelines.spec.ts`（`gotoIssueFormScreen()` は起票フォーム画面のみを対象）と `src/nav/NavDrawer.tsx` 全体・`src/App.tsx:98-114`
- **問題**: 24×24px / 44px の機械チェック（`design-guidelines.spec.ts`）はログイン→リポジトリ選択→起票フォーム画面の要素のみを走査しており、本 PR で新設された `menu-trigger` / `account-chip` / `side-drawer-close` / `drawer-nav-link` 等はテスト対象に入っていない。CSS 上は 44px を明示しているため現状は基準を満たしているとみられるが、退行時に検知されない。
- **なぜ重要か**: 数値基準（D-4）は SSOT で機械チェック必須と位置づけられており、UI 拡張のたびに検証範囲が追随しないと「実装当初のみ準拠・その後静かに劣化」というリスクが生じる。
- **推奨対応**: `design-guidelines.spec.ts` にドロワーを開いた状態のタップターゲット検証を追加する（別 Issue でも可）。

### `correctness` — 主張
<sub>2026-07-19T19:57:10+09:00</sub>

## correctness レンズ: バグ/エッジケース（round 1）

### ① CRITICAL / 確定リグレッション — アカウント削除時に repos/shortcuts キャッシュが消去されなくなった
**該当**: `src/App.tsx:165-169`（`onAccountDeleted` コールバック）, `src/auth/AccountDeletion.tsx:12-22`（`handleDelete`）

現行コード:
```tsx
onAccountDeleted={() => {
  // 同一端末で別ユーザーが再ログインした際に古い一覧が残らないようにする（#101）。
  setAccountDeleted(true);
  setMenuOpen(false);
}}
```
`AccountDeletion.handleDelete()` 自体は `clearAllCachedLabels()` のみ呼ぶ（`clearReposCache`/`clearShortcutsCache` は呼ばない）。

**旧実装との比較（`git show ded3ac7:src/App.tsx` L202-210・リファクタ直前コミット）**:
```tsx
<AccountDeletion
  onDeleted={() => {
    // 同一端末で別ユーザーが再ログインした際に古い一覧が残らないようにする（#101）。
    clearReposCache();
    clearShortcutsCache();
    setAccountDeleted(true);
  }}
/>
```
旧 `AuthPanel` は `onDeleted` 側で `clearReposCache()` + `clearShortcutsCache()` を呼び、`AccountDeletion` 自身の `clearAllCachedLabels()` と合わせて 3 キャッシュ全消去を担保していた。今回の `useAuthState`/`NavDrawer` 抽出（PR #113・commit c80c5c1）で **コメント文言はそのまま残したのに呼び出し本体だけ落ちている**。`clearReposCache`/`clearShortcutsCache` の JSDoc（`reposCache.ts:54`, `shortcutsCache.ts:58`）も「ログアウト・アカウント削除時に呼び出し」と明記しており、実装がその契約を満たさなくなった。

**失敗シナリオ**: 端末を共有する/同一 GitHub ユーザーが削除後に同一アカウントで再登録・再ログインすると（`userId` が同一のため `loadReposCache`/`loadShortcutsCache` の所有者チェックを通過する）、削除前の repos/shortcuts 一覧が SWR キャッシュとして残り、`/api/repos` の再取得が終わるまで一瞬表示される。NFR-17（別アカウント混入防止）そのものの侵害ではないが、「アカウント削除＝ローカル痕跡も消える」という機能要件（A4-3・FR-12）とコード自身のコメントに反する。既存 `login.spec.ts` の削除テスト（L50-68）は `/api/me` 401 のみ検証し、localStorage の repos/shortcuts キャッシュ状態は未検証のため、このリグレッションはテストで捕捉されない。

**推奨修正**: `App.tsx` の `onAccountDeleted` に `clearReposCache()`/`clearShortcutsCache()` を復元するか、`AccountDeletion.handleDelete()` 側に 3 キャッシュ全消去を集約する（`useAuthState.ts` の `clearAllUserCaches()` が既にこの目的の関数として存在するので、それを呼ぶのが自然）。

重大度: **major**（データ衛生のリグレッション。実害は同一ユーザー限定でユーザー間漏洩ではないが、既存の意図的な防御・コメント・JSDoc契約を裏切る）

---

### ② MAJOR — アカウント削除後もハンバーガーメニューが有効なまま、削除済みユーザーの stale 情報が再表示可能
**該当**: `src/App.tsx:93`（`showAccountChip`）, `src/App.tsx:98-100`（`menu-trigger` ボタン）, `src/nav/NavDrawer.tsx:78-94`（`auth.status==="authenticated"` 分岐）

`accountDeleted` は `<main>` の描画切り替え（`AccountDeletionGuidance` 表示）にのみ使われ、`<header>` のハンバーガー（`menu-trigger`）は無条件レンダリングされ続ける（`showAccountChip` はチップ非表示だけを担当し、ボタン自体は隠さない）。一方 `useAuthState` の `auth` state は初回 `/api/me` 取得後は更新されず、`onAccountDeleted` も `logout()` や状態リセットを一切呼ばない。

**失敗シナリオ**: アカウント削除完了 → `AccountDeletionGuidance`（連携解除案内）が表示された状態でユーザーがハンバーガーを押す → `NavDrawer` が `auth.status==="authenticated"` のまま再描画され、削除済みユーザーの stale なログイン名・アバター・「ログアウト」ボタン・`<AccountDeletion>`（もう一度「削除する」を押せる状態）が再度表示される。ここで再度削除を試みると、サーバー側セッションは既に破棄済み（`login.spec.ts:65-67` が `/api/me` 401 を確認）のため `DELETE /api/account` も 401/エラーになり、`AccountDeletion` は `state==="error"` に落ちて汎用エラーメッセージを出す — 実際には初回削除は成功しているのに UI 上は失敗したように見える紛らわしい dead end。

**推奨修正**: `showAccountChip` と同じ判定（`!accountDeleted`）をハンバーガーの活性/表示にも適用するか、`accountDeleted` を `NavDrawer` にも伝搬して認証セクションを非表示にする。あるいは `onAccountDeleted` で `auth` を anonymous 相当にリセットする。

重大度: **major**（クラッシュはしないが、削除済みアカウントの PII が UI に再露出し、紛らわしい再削除フローに入れる）

---

### ③ MEDIUM — backdrop/×ボタンでの閉じるパスが Escape と非対称で、閉時に一瞬空のドロワーが見える
**該当**: `src/nav/NavDrawer.tsx:27-32`（同期 `useEffect`）, `:35-37`（`handleBackdropClick`）, `:47`/`:125`（`{open ? <div>… : null}`）, `:51`（× ボタン `onClick={onClose}`）

backdrop クリックと × ボタンはどちらも `onClose()`（＝親の `setMenuOpen(false)`）を直接呼ぶだけで、`dialogRef.current?.close()` を呼ばない。すると:
1. React が `open=false` で再レンダリング → `{open ? <div className="side-drawer-body">… : null}` により中身が即座にアンマウントされる。
2. `<dialog>` 自体はまだネイティブに開いたまま（`dialog.open === true`。まだ `dialog.close()` していない）。
3. その後の `useEffect`（ペイント後）でようやく `dialog.close()` が呼ばれる。

Escape キーの場合はブラウザが先に `dialog.close()` 相当の処理をしてから `close` イベント（→`onClose`）を発火するため順序が逆で、この空白フレームは起きない。backdrop/× ボタン経由だけ、閉じるアニメーションの前に中身が消えた空のドロワー矩形＋backdrop が一瞬見える可能性がある（低速端末・低フレームレートで顕在化しやすい）。

**参考**: 同じ `<dialog>` パターンを使う `RepoPicker.tsx` の `.issue-sheet` は × ボタンで `dialogRef.current?.close()` を直接呼んでおり（L279）、`open` の双方向 state 同期も持たない。`NavDrawer` だけがこの非対称な二重経路を持ち込んでいる。

**推奨修正**: `handleBackdropClick` と × ボタンの `onClick` を `() => dialogRef.current?.close()` に変更し、`onClose`（state 更新）は常に `dialog` の `close` イベント経由の一本の経路に統一する。

重大度: **medium**（機能は壊れないが視覚的フリッカーの実バグ。E2E では検出困難でユーザー体感でのみ顕在化）

---

### ④ MINOR — ドロワー表示中はユーザー名が DOM に二重出現（将来のテストトラップ）
**該当**: `src/App.tsx:113`（`account-chip` 内 `auth.me.login`）, `src/nav/NavDrawer.tsx:84`（`user-login` 内 `auth.me.login`）

ヘッダーの `account-chip` はドロワー開閉に関わらず常時マウントされているため、ドロワーを開いている間は同じログイン名テキストが DOM 上に 2 箇所（チップ内 + ドロワー内）同時に存在する。現状 `login.spec.ts` はドロワー未オープン時に `getByText(/e2e-user/)` を使っており実害はないが、`content/discussions/sidepanel-review/entries/r01_..._e2e_cov_claim.md` が提案する新規テスト群はドロワーを開いた状態でのアサーションを増やすため、`getByText` ベースのセレクタを安易に足すと Playwright strict-mode の "multiple elements" エラーに当たる。将来の実装者/テスト追加者への申し送り。

重大度: **minor**（現行コードにバグはないが、設計上のテスト作成トラップ）

---

### 検証済み・問題なし（念のため明記）
- Escape → `onClose` → `useEffect` の二重 close 回避: ブラウザがネイティブに先に閉じてから `close` イベントが発火するため、`!open && dialog.open` は既に `false` で再クローズは起きない。ループ/例外なし。
- backdrop クリック判定 `e.target === dialogRef.current`: `.side-drawer` は `padding:0`、`.side-drawer-body` は `min-height:100%` かつブロック要素で幅 100% を埋めるため、ドロワー内の空き領域クリックで `e.target` がダイアログ自身になることはない（誤発火なし）。close ボタン/リンク類も同様にバブリングで `e.target` は子要素になるため二重発火なし。

## ラウンド 2

### `a11y` — 反論
<sub>2026-07-19T20:00:54+09:00</sub>

# a11y round2: rebuttal / 統合分析

## (a) #1（フォーカス未復帰）は correctness ③（空ドロワー一瞬表示）と同一原因。提案修正で両方解消し、#5 は解消しない

HTML dialog の `close()` メソッド仕様を精査すると、フォーカス復帰チェック（`previously focused element` へ戻すかどうかの `insideDialog` 判定）は `close()` 実行時に **同期的に** 行われ、`open` 属性の除去（→ UA スタイルで即座に非表示）も同じ同期ステップ内で起きる。一方 `close` **イベント**の発火は別途キューされたタスクであり、`close()` 呼び出しから見て後発になる。

現行実装（× / backdrop）は `onClick={onClose}` で React state（`setMenuOpen(false)`）を直接更新 → 同期レンダーで `{open ? <body/> : null}` が children を先にアンマウント → その後 `useEffect`（passive effect、ペイント後）が `dialog.close()` を呼ぶ、という順序。この結果:
- フォーカス側（私の #1）: children アンマウント時に `document.activeElement` が `<body>` へ落ち、後発の `close()` 実行時点で `insideDialog=false` となり **ネイティブ復帰処理がスキップされる**。
- 表示側（correctness ③）: `dialog.open` 属性の除去（＝即時非表示）が `close()` 呼び出しまで遅延するため、children アンマウント後・`close()` 実行前の間、backdrop + 空の dialog シェルが `open` 属性付きのまま存在しうる（フリッカーの余地）。

→ **両者は「imperative `dialog.close()` を同期的に呼ばず、React state 更新→アンマウント→passive effect という非同期経路に置き換えてしまった」という単一の根本原因の異なる症状**であり、correctness ③ は私の #1 を独立した観点（コード経路の同期/非同期性）から補強している。結論は堅牢と判定する。

**提案修正の効果判定**: 「× / backdrop も `dialogRef.current?.close()` を直接呼び、`onClose`（state 更新）は `close` イベント経由に一本化」を適用した場合:
- `dialogRef.current.close()` 呼び出し時点では children はまだマウントされたまま（React state はまだ変わっていない）→ `document.activeElement`（× ボタン等）は dialog の子孫 → `insideDialog=true` → ネイティブがトリガーへ同期的にフォーカス復帰 **(#1 解消)**。
- 同じ `close()` 呼び出し内で `open` 属性が同期的に外れ即座に非表示化される。その後キューされた `close` イベントで React state が追随し children をアンマウントするが、その時点で dialog は既に非表示済みなので「空のドロワーが一瞬見える」フレームが原理的に発生しない **(correctness ③ 解消)**。
- Escape 経由と完全に同一の経路（ネイティブ close 先行 → `close` イベント → state 追随）になるため、3 導線（Escape / × / backdrop）の非対称性が解消される。

**#5（初回オープン時に × ボタンへフォーカス）への影響**: この修正は **close 経路のみ**を変更するもので、open 経路（`showModal()` 呼び出しタイミング・children の初回マウント順）には触れない。#5 は open 時の話であり、この修正では解消されない（そもそも #5 は仕様準拠の挙動で bug ではなく設計確認事項）。close 側の一本化と open 側の初期フォーカス位置は独立した論点として扱うべき。

## (b) 認証済みホームの h1: 視覚的に隠した h1 追加で severity 的には十分。ただし実装上の見落とし注意点が1つ

深刻度判定としては、視覚的に隠した（`sr-only` 等）`<h1>{t.home.title}</h1>` を `<main>` 内に追加すれば、見出しジャンプでのページ判別という実害は解消される。SR ユーザーにとって「ページの主題を示す h1 が存在する」ことが重要であり、視覚的な可視性は必須要件ではない（多くの本番プロダクトで採用される標準パターン）。major → 解消可能、追加の構造変更は不要。

ただし実装時の注意: 現状 `App.tsx:123-128` は `auth.status !== "authenticated"` の分岐内でのみ `<h1 className="hero-title">` を描画している。ここに単純に「認証済み用の新しい h1」を **別途** 追加すると、2 つの h1（非認証時の可視 hero-title と、常時レンダーの sr-only 版）が両方存在するケースが生まれないよう注意が要る（非認証時は元の hero 内 h1 のみが見えるべきで、sr-only 版と重複させない）。安全な実装は「`<h1>{t.home.title}</h1>` を分岐の外側で無条件に 1 つだけレンダーし、非認証時の hero 内は見出しではない要素（`hero-title` クラスを持つ `<p>`/`<div>` 等）に変更する」形で、常に h1 が 1 個だけ存在するようにするのが望ましい。単なる「if(authenticated) だけ sr-only h1 を足す」対症療法でも実害（h1 が 0 個の状態）は解消するが、上記の一本化のほうが将来の重複リスクを避けられる。

### `design_ux` — 譲歩
<sub>2026-07-19T20:00:59+09:00</sub>

## design_ux — round 2（自己指摘の更新 + correctness #2 への同意）

### (a) 自分の #1（言語切替等 0→2タップ）: severity 更新 major → minor、"実装で戻す" ではなく "PR 説明への記録" に格下げすることに同意
lead 指摘のとおり、設定のサイドパネル集約はユーザーが明示的に依頼した設計方針であり、D-1（キャプチャとトリアージの分離）・D-10（意図的ミニマリズム＝メインを起票フローに集中）の精神とも整合する意図的トレードオフ。実装を戻すべき欠陥ではない。
言語切替の常時表示化は **must ではなく nice**：
- 対象アプリの主用途は「思いついた瞬間の単発起票」であり、1 セッション内で言語を何度も切り替える利用シナリオ（バイリンガル起票頻度）を裏付ける利用データ・要件（`docs/project-mission.md`）は無い。多くの場合は端末/アカウントごとに 1 度設定すれば済む性質の項目。
- 一方、ショートカット管理・規約・プライバシーは起票フローに絡まない完全な二次機能であり、ドロワー集約は素直に妥当。
**更新後の推奨**: 実装変更は不要。PR 説明文の「設計意図・既知のトレードオフ」に一行「設定類（言語含む）は 0 タップ常時表示 → ドロワー集約へ変更、意図的」と記録すれば十分（`docs/rules/design-review-checklist.md` の「Warning を残す場合は理由明記」と同じ運用でよい）。severity: minor（記録漏れのみを指摘・実装は現状維持でよい）。

### (b) 自分の #2（右チップ→左ドロワーの空間的不整合）: severity 更新 major → minor、実装変更は不要と自己評価を更新
初稿時点で「本ガイドラインに直接規定する条文がなく実測データもない所見」と自己申告済みだった。round1 の他エントリ（e2e_cov・a11y・correctness）を踏まえて再評価すると、チップを「トリガーから外し純粋な状態表示にする」変更はむしろ悪化トレードオフになる:
- チップを非トリガー化すると、認証済みユーザーがアカウント関連操作（ログアウト・削除・プロフィール確認）へ到達する経路がハンバーガー 1 つに減り、発見可能性が下がる。
- チップ＝ハンバーガーと同じ開閉先を共有する設計は「エントリポイントを増やしつつ実装・a11y 表面を増やさない」という妥当なトレードオフであり、correctness #1（削除時キャッシュ消去漏れ）・a11y #1（フォーカス復帰）のような **実装変更を要する具体的バグ** とは性質が異なる主観的所見。
**更新後の推奨**: 実装変更なし（現状維持でよい）。将来的に UI 刷新の機会があれば軽量なユーザビリティ検証の候補として控えておく程度。severity: minor（design-review-checklist には計上しない所感レベル）。

### (c) correctness #2（削除後も stale アカウント情報が再表示される）: UX 観点でも同意（major 相当）
`src/App.tsx:93,98-100` と `src/nav/NavDrawer.tsx:78-94` の指摘どおり、`accountDeleted` は `<main>` の描画のみを切り替え、ハンバーガーとその先の `NavDrawer` 認証済み分岐は無条件で生き続ける。これは UX 原則としても看過できない:
- `docs/design/design-guidelines.md` §3.0 の「認可失敗・キャンセル時は…行き止まり画面を作らない」と同根の原則（エラー/異常系での一貫した状態管理）に反する。`AccountDeletionGuidance`（削除完了・連携解除案内）という「クリーンな終了状態」を提示しておきながら、同じ画面でハンバーガーを押すと削除済みユーザーの PII（アバター・ログイン名）と「もう一度削除する」ボタンが復活するのは、ユーザーに「本当に削除されたのか」という不信感を与える重大な整合性崩壊。
- 加えて再削除操作が 401 で失敗し「エラーが発生しました」的表示に落ちる点は、D-7（入力/操作結果の明示）が求める「原因 + 次アクションの明示」からも外れる（実際には初回削除は成功しているのに失敗して見える）。
UX レンズとしても severity: **major** に一票（correctness の評価に同意。実装修正は correctness 提案どおり `accountDeleted` を `NavDrawer`/ハンバーガーの認証済み分岐にも伝搬するのが妥当）。

### `correctness` — 譲歩
<sub>2026-07-19T20:01:07+09:00</sub>

## correctness round 2: a11y #1 との統合判定 + 自己指摘 #1/#2 の修正十分性

### (a) a11y #1（フォーカス復帰失敗）と correctness #3（backdrop/×の非同期フリッカー）は同一根本原因 — concede して統合

同一原因である。両方とも「backdrop クリック / × ボタンが `dialogRef.current?.close()` を呼ばず、`onClose()`（＝`setMenuOpen(false)`）だけを呼んでいる」ことに起因する:

1. click → `setMenuOpen(false)` → React 再レンダー → `{open ? <div className="side-drawer-body">…</div> : null}` により children が **即座に unmount**（この時点で `dialog.open` はまだ `true`、ネイティブ close はまだ呼ばれていない）。
2. unmount された children の中に、フォーカスされていた × ボタン自身（または他のフォーカス保持要素）が含まれる → ブラウザは focus を `<body>` へ移す。
3. 後続の `useEffect`（passive effect・ペイント後）でようやく `dialog.close()` を呼ぶ。この時点で HTML 標準の closing steps が `insideDialog`（現在の focus が dialog の子孫か）をチェックするが、step 2 で既に focus は `body` に移動済みのため `insideDialog=false` となり、**ネイティブのフォーカス復帰処理がスキップされる**（a11y #1 の直接原因）。同時に、この「children 消滅 → 実際のネイティブ close」の間の空白フレームが、私が #3 で指摘した視覚的フリッカー（backdrop/ドロワー枠は残ったまま中身だけ消える一瞬）の直接原因でもある。

推奨修正「backdrop ハンドラと × ボタンの `onClick` を `() => dialogRef.current?.close()` に変更し、`onClose`（state 更新）は常に dialog の `close` イベント経由の一本の経路に統一する」を適用した場合の効果を再検証:

- `dialogRef.current?.close()` を **click ハンドラ内で同期的に** 呼ぶ → この時点では React の `open` state はまだ `true` のまま・children はまだマウントされている → closing steps 実行時に `insideDialog=true` → **ネイティブが正しく `previouslyFocusedElement`（ハンバーガー/チップ）へフォーカスを復帰する**（a11y #1 解消）。
- `close()` は同時にダイアログを即座に非表示化（`[open]` 属性除去・top layer から除去）する。その後 `close` イベント→ `onClose` prop → `setMenuOpen(false)` → 再レンダーで children が unmount されるが、**その時点で dialog は既に非表示** なので、unmount は画面外で起きる → 空フレームのフリッカーは発生しない（correctness #3 解消）。
- Escape 経路と完全に同一の順序（ネイティブ close 先行 → React state 追従）になるため、3 導線（Escape/backdrop/×）が対称になる。

→ **判定: 単一修正で a11y #1・correctness #3・`{open?body:null}` の空フレーム問題が同時に解消する。** 3 つは独立した別バグではなく、同じ「close 経路の二重化（state 直接更新 vs ネイティブ close）」という 1 つの設計ミスの異なる症状。severity は a11y 側の critical（フォーカス喪失は WCAG 実害）を採用し、私の #3 は同一 issue の追加症状として統合すべき（concede: 自分の #3 を単独の medium 指摘として残さず、a11y #1 に一本化して修正 Issue を 1 件にすることを推奨）。

### (b) correctness #1（アカウント削除でキャッシュ消去欠落）は確定リグレッションか / `clearAllUserCaches()` 呼び出しで十分か

確定リグレッション。`git show ded3ac7:src/App.tsx`（リファクタ直前）の `AccountDeletion` `onDeleted` コールバックは `clearReposCache()` + `clearShortcutsCache()` を明示的に呼んでおり、現行 `App.tsx:165-169` の `onAccountDeleted` はこの 2 呼び出しを落として `setAccountDeleted(true)` だけになっている（コメント文言 「同一端末で別ユーザーが再ログインした際に古い一覧が残らないようにする（#101）」は両バージョンに残存＝コードと矛盾）。推測ではなく diff で確認済み。

修正十分性: `onAccountDeleted` 内で `clearAllUserCaches()`（`useAuthState.ts:18-22`、`clearReposCache + clearShortcutsCache + clearAllCachedLabels` の 3 点セット）を呼べば **十分**。`AccountDeletion.handleDelete()` は既に `clearAllCachedLabels()` を自前で呼んでいるため、`clearAllUserCaches()` 経由で二重に呼ばれる形になるが、`clearAllCachedLabels()` は idempotent（既に空の localStorage キーを再度 remove するだけ）なので実害なし。厳密にクリーンにするなら `AccountDeletion.tsx:17` 側の `clearAllCachedLabels()` 呼び出しを削除して `onAccountDeleted` 側の `clearAllUserCaches()` に一本化してもよいが、これは任意の重複排除であり修正の必須条件ではない。

### (c) correctness #2（削除後もハンバーガーで stale 認証セクション再表示）の推奨修正

3 案のうち、**App.tsx 側で `effectiveAuth` を導出して NavDrawer に渡す案**（案(i)の具体化）を推奨する:

```tsx
const effectiveAuth = accountDeleted ? { status: "anonymous" as const } : auth;
// ...
<NavDrawer auth={effectiveAuth} ... />
```

理由:
- 最小差分（App.tsx 1 行追加のみ、`NavDrawer.tsx`・`useAuthState.ts` は無改修）。
- 既存の `showAccountChip = auth.status === "authenticated" && !accountDeleted`（App.tsx:93）と同じ「`accountDeleted` でマスクする」パターンを踏襲しており一貫性がある。
- ハンバーガー自体を非活性/非表示にする案（(ii)）は却下: ドロワー内の言語切替・利用規約/プライバシーリンクはアカウント削除後も無害かつ有用（`AccountDeletionGuidance` 画面での言語切替ニーズはありうる）ため、トリガーごと殺すのはドロワー内の非アカウント機能まで道連れにする過剰対応。
- `useAuthState` 側で実際にサーバーセッション破棄と同期して `auth` を anonymous にリセットする案（(iii)、フックに `resetToAnonymous()` を追加）はより「正しい」が、フックの公開 API を変更する必要があり差分が大きい。今回のバグ修正としては (i) で十分かつ他の `auth` 消費箇所（`ShortcutList`/`RepoPicker` 等）は `accountDeleted` 時点で `<main>` から既に外れているため影響しない。

以上より (a) は a11y #1 に統合（concession）、(b) は確定リグレッション・`clearAllUserCaches()` で修正十分、(c) は `effectiveAuth` 導出案を推奨。

### `e2e_cov` — 譲歩
<sub>2026-07-19T20:01:50+09:00</sub>

## e2e_cov — round 2（correctness #4 / a11y #1 を受けた修正）

### (a) strict-mode 衝突の是正（correctness #4 を受諾。想定より実害が広い）

correctness #4 の指摘は「将来のテストトラップ」だが、実際には**私の提案⑧が現時点で strict-mode 違反を起こす**ことを確認した（自己発見・修正）:

- ⑧ 匿名時のドロワー内ログイン導線テスト: `App.tsx:132-144`（hero-cta のログインリンク）と `NavDrawer.tsx:66-75`（ドロワー内ログインリンク）は同じアクセシブル名 `/GitHub でログイン|Sign in with GitHub/` を持つ。匿名状態でドロワーを開くと**両方が同時に DOM に存在**し、`page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ })` は 2 件ヒットして strict-mode エラーになる。ユーザー名（correctness指摘）と全く同型のトラップが、私自身の提案に既に混入していた。

**是正方針（`.first()` は不採用）**: `.first()` は DOM 順序に依存する隠れた仕様（順序が変わると無言で別要素を掴む）ため使わない。**スコープ限定**（dialog 内 / dialog 外を明示）を採用する。

- ドロワー内の要素を検証する時は `page.getByRole("dialog")` を起点にする: `page.getByRole("dialog").getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ })`
- ドロワー外（トップバー）の要素を検証する時は `page.locator(".account-chip")` や `page.locator("header.app-bar")` で明示スコープする
- **修正版 ⑧**:
```ts
test("未ログイン時、ドロワー内にもログイン導線がある", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /メニューを開く|Open menu/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }),
  ).toBeVisible();
});
```
- **修正版 ②**（click 時点では drawer 閉で衝突なしだが、開後の検証を足す場合に備え明示）: クリック対象の `getByRole("button", { name: /e2e-user/ })` は drawer 閉状態でのみ実行するため click 自体は安全。ただし**開後にユーザー名を再確認する行を足さない**（足すなら `dialog.getByText(auth.me.login)` で明示スコープ）。
- ⑥⑦⑨⑩ も同様に、開状態でテキスト/ロール検索する箇所は全て `dialog.getByRole(...)`/`dialog.getByText(...)` に統一する（本ラウンドで見直し完了）。

汎用ルールとして提案: `e2e/nav-drawer.spec.ts` 冒頭に `const dialog = () => page.getByRole("dialog");` ヘルパーを置き、drawer 内アサーションは必ずこれを経由させる（既存 spec の `configureMockRepo` 的な共通ヘルパーパターンに合わせる）。

### (b) a11y #1（×/backdrop でのフォーカス復帰欠落）を受け、⑨ を分割・must に格上げ

a11y #1 の解析（React unmount が `dialog.close()` より先に走るため × / backdrop 経路だけ `insideDialog` 判定時にフォーカスが既に body に落ちている）が正しいなら、**私の元の ⑨ は Escape 経路のみを検証しており、これは a11y #1 曰く「壊れていない唯一の経路」**。つまり ⑨ は現状のバグを検出できない誤った安心材料になっている。これは重大な見落としで **concede** する。

**対応**: ⑨ を3ケースに分割し、全て must にする（元は1件 must だったが実質2件増える）。

```ts
test("Escape で閉じるとハンバーガーへフォーカスが戻る", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: /メニューを開く|Open menu/ });
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("×ボタンで閉じるとハンバーガーへフォーカスが戻る", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: /メニューを開く|Open menu/ });
  await trigger.click();
  await page.getByRole("dialog").getByRole("button", { name: /^×$|閉じる|^Close$/ }).click();
  await expect(trigger).toBeFocused(); // a11y #1 の修正前は失敗するはず（body にフォーカスが落ちる）
});

test("backdrop クリックで閉じるとハンバーガーへフォーカスが戻る", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: /メニューを開く|Open menu/ });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.click({ position: { x: 2, y: 2 } });
  await expect(trigger).toBeFocused(); // 同上
});
```

correctness #3（backdrop/× だけ close() を呼ばず setState 経由で二重パスになっている）と a11y #1 は**同一の根本原因**（close 経路の非対称性）を指しているため、修正は1箇所（`handleBackdropClick` と × ボタンの onClick を `dialogRef.current?.close()` に統一）で両方解消できる。上記3ケースはその単一修正の regression gate として機能する。

### (c) must 7件のうち、実装修正とセットで回帰防止に最も効く上位3件

正直な回答: 私の元の must 7件（①②③④⑤⑧⑨）は「close 経路統一」にしか噛み合わず、**「キャッシュ消去」「stale 認証」（correctness #1・#2）を直接ガードする項目は1つもなかった**。この点は concede する。close 経路統一に対する効き目で順位付けすると:

1. **⑨-× / ⑨-backdrop（新設・フォーカス復帰）**: (b) で示した通り、修正前は確実に red、修正後は green になる唯一の項目群。a11y #1 の contract を直接検証する最も感度の高いテスト。
2. **④ backdrop クリックで閉じる**: 元々 visibility のみだったが、correctness #3 のフリッカーバグ（アンマウント→close() の順序ズレ）を検出するには `toBeHidden()` だけでは弱い。`await expect(dialog).toBeHidden()` に加え、**閉時に一瞬 `.side-drawer-body` が空のまま可視になるフレームがないか**を screenshot diff や `page.locator(".side-drawer-body")` の存在チェックで補強すべき（現状案では検出力不足。優先度は高いが、correctness #3 の完全なガードにはテスト強化が要る、と付記）。
3. **⑤ ×ボタンで閉じる**: 同上（backdrop と対の経路）。

**キャッシュ消去・stale 認証は別レーンで新設が必要**（元の7件を差し替えるのではなく追加を提案）:
- correctness #1（cache clear 欠落）: `e2e/login.spec.ts` の既存アカウント削除テスト（L50-68）を拡張し、削除前に `localStorage` へ repos/shortcuts キャッシュキーを仕込んでおき、削除後に `page.evaluate(() => localStorage.getItem(...))` で null になっていることを検証する must 級の追加が必要。NavDrawer 単体の開閉スコープ外（アカウント削除の一連フロー）なので `login.spec.ts` 側に置くのが自然。
- correctness #2（stale 認証でハンバーガーが有効なまま）: `AccountDeletionGuidance` 表示後にハンバーガーをクリックし、`NavDrawer` が「ログイン中」表示（stale な `auth.me.login`）を出さないこと、または `menu-trigger` 自体が非表示/無効化されることを検証する must 級の追加が必要。同じく `login.spec.ts` のアカウント削除テストの延長に置くのが自然（`nav-drawer.spec.ts` 側では auth.status が生きた状態を前提にしているため）。

これらは元の10項目には含まれておらず、correctness の指摘がなければ見逃していた。テストスイート全体のリスクガードとしては ⑨-×/⑨-backdrop と同格の must として扱うべき。

## ラウンド 3

### `lead` — 合意
<sub>2026-07-19T20:05:05+09:00</sub>

## lead 合意（consensus）

### 実機検証（lead 計測・Chromium/Pixel 7）
- Escape / ×ボタン / backdrop（正しい暗転領域クリック）の **3 経路すべてで dialog は閉じ、フォーカスは `menu-trigger` に復帰**することを実測（`document.activeElement.className === "menu-trigger"`）。
- よって a11y#1「×/backdrop でフォーカスが body に落ちる（CRITICAL）」は **実機では再現せず**。理論（React unmount 先行 → close() 時 insideDialog=false）は筋が通るが、実 Chromium の dialog.close() は previouslyFocusedElement へ堅牢に復帰する。**CRITICAL → robustness 改善に格下げ。**
- e2e_cov のテスト案④（backdrop を `{x:2,y:2}` でクリック）は**ドロワー内側を叩いており閉じない**ことも実測で判明（backdrop は幅320px の右側の暗転領域）。追加テストの座標は要修正。

### 合意した対応
1. **[fix/major] キャッシュ消去欠落（correctness#1・確定回帰）**: `onAccountDeleted` に `clearAllUserCaches()` を追加。
2. **[fix/major] 削除後 stale 認証ドロワー（correctness#2・design_ux 同意）**: `effectiveAuth = accountDeleted ? anonymous : auth` を NavDrawer へ渡す（App.tsx 1 行導出・最小差分）。
3. **[fix/minor] 認証済みホームに h1 なし（a11y#2/#4）**: h1 を 1 つだけ常在（認証済みは sr-only、匿名は hero）。
4. **[fix/robustness] close 経路統一（a11y#1+correctness#3 を統合）**: ×/backdrop を `dialogRef.current?.close()` 直呼びに変更し Escape と同経路に（RepoPicker `.issue-sheet` と同型）。実機ではフォーカス復帰済みだが、将来堅牢性・理論フリッカー除去。回帰ガード e2e を併設。
5. **[fix/major] E2E カバレッジ（e2e_cov + correctness#4）**: `e2e/nav-drawer.spec.ts` 新設（開閉3経路+フォーカス復帰+リンク遷移+匿名導線、**dialog スコープ限定セレクタ**で strict-mode 衝突回避）。`login.spec.ts` にキャッシュ消去・stale 認証の検証を追加。ドロワー開状態の axe/タップターゲットも補強。
6. **[document/minor] 設定 0→2 タップ（design_ux#1→concede）**: ユーザー明示依頼の意図的集約。PR 説明に記録、実装維持。
7. **[keep/minor] 右チップ→左ドロワー（design_ux#2→concede）**: 所感レベル。発見可能性優先で維持。
8. **[fix/minor] 遷移アフォーダンス（design_ux#3）**: drawer-nav-link に `›` を付与。

### `lead` — 判定
<sub>2026-07-19T20:05:05+09:00</sub>

{
  "topic": "sidepanel-review",
  "empirical_ground_truth": "Escape/×/backdrop の3経路すべてで dialog は閉じ focus は menu-trigger へ復帰（実機Chromium/Pixel7・lead計測）。a11y#1 のフォーカス喪失は非再現。",
  "actions": [
    {"id": "cache-clear-regression", "severity": "major", "status": "confirmed", "do": "fix", "how": "onAccountDeleted に clearAllUserCaches() 追加", "src": "correctness#1"},
    {"id": "stale-auth-after-delete", "severity": "major", "status": "confirmed", "do": "fix", "how": "effectiveAuth=accountDeleted?anonymous:auth を NavDrawer へ", "src": "correctness#2,design_ux(c)"},
    {"id": "missing-h1-authed", "severity": "minor", "status": "confirmed", "do": "fix", "how": "h1 を常在1個（認証済みsr-only/匿名hero）", "src": "a11y#2,#4"},
    {"id": "close-path-unify", "severity": "robustness", "status": "not_reproduced_empirically", "do": "fix", "how": "×/backdrop を dialogRef.close() 直呼び統一+回帰e2e", "src": "a11y#1,correctness#3"},
    {"id": "e2e-coverage", "severity": "major", "status": "confirmed", "do": "fix", "how": "nav-drawer.spec.ts新設(dialogスコープ)+login.spec拡張(cache/stale)+drawer axe", "src": "e2e_cov,correctness#4"},
    {"id": "lang-legal-tap", "severity": "minor", "status": "intentional_tradeoff", "do": "document", "how": "PR説明に記録・実装維持", "src": "design_ux#1"},
    {"id": "chip-left-drawer", "severity": "minor", "status": "keep", "do": "none", "how": "維持", "src": "design_ux#2"},
    {"id": "nav-link-affordance", "severity": "minor", "status": "optional", "do": "fix", "how": "drawer-nav-link に › 付与", "src": "design_ux#3"}
  ],
  "critical_remaining": []
}
