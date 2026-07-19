<!--entry
author: correctness
round: 2
kind: concession
ts: 2026-07-19T20:01:07+09:00
-->

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
