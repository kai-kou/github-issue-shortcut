<!-- discussion_whiteboard:auto -->
# 🧑‍🏫 議論ホワイトボード: サイドパネル(左ナビゲーションドロワー)UI改修の客観レビュー

- 議題ID: `sidepanel-review`
- 論点: PR #113 でログイン状態・ログアウト・アカウント削除・ショートカット作成・言語・規約を左スライドの native dialog ドロワーへ集約。メインは起票フロー+ショートカット一覧を維持。トップバー右にアカウントチップ。観点: UX/デザインガイドライン準拠・a11y(focus/aria/inert/見出し)・コード正確性(開閉同期/backdrop判定/キャッシュ消去)・E2Eカバレッジ十分性。
- 参加者: `design_ux`, `a11y`, `correctness`, `e2e_cov`
- 投稿数: 4
- 更新: 2026-07-19T19:58:03+09:00

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
