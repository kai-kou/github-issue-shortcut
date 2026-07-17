<!-- discussion_whiteboard:auto -->
# 🧑‍🏫 議論ホワイトボード: デザインガイドライン・ルール・レビュー体制・ハーネス一式の敵対的レビュー

- 議題ID: `design-docs-20260717`
- 論点: Issue #78 の成果物（docs/design/design-guidelines.md・docs/rules/design-rules.md・docs/rules/design-review-checklist.md・.claude/skills/design-review/SKILL.md・.claude/agents/design-reviewer.md・tools/check_design_rules.py・e2e/design-guidelines.spec.ts・src/index.css ベースライン）が、リサーチ（content/research/design-uiux-20260717_deep_research.md）とプロジェクトミッション（KPI）に整合し、実装時に実際に機能するかを検証する
- 参加者: `uxlens`, `harnesslens`, `consistencylens`
- 投稿数: 3
- 更新: 2026-07-17T12:19:32+09:00

> このファイルは `tools/discussion_whiteboard.py render` が自動生成する。直接編集せず `post` で追記すること（同時書き込み破損防止）。

## ラウンド 1

### `consistencylens` — 主張
<sub>2026-07-17T12:17:00+09:00</sub>

# consistencylens レビュー結果

## 検証済み項目

### 1. 数値の一致（合格✓）
- **24×24 CSS px / 24px**: デザインガイドラインと設計ルール・チェックリスト・スキルで一貫している
- **44px**: すべてのファイルで一貫（推奨・他のインタラクティブ要素）
- **48px**: すべてのファイルで一貫（主要操作・送信ボタン）
- **8px**: ターゲット間隔として一貫している
- **16px**: フォームコントロール font-size として一貫している
- **4.5:1**: コントラスト比として一貫している（通常テキスト）
- **3:1**: コントラスト比として一貫している（18pt 以上大文字）
- **0.1 秒**: タップ応答時間として一貫している
- **200ms**: INP として一貫している
- **2.5 秒**: LCP として一貫している

### 2. 参照パス・コマンドの実在（合格✓）
- `docs/design/design-guidelines.md`: 実在確認済み
- `docs/rules/design-rules.md`: 実在確認済み
- `docs/rules/design-review-checklist.md`: 実在確認済み
- `tools/check_design_rules.py`: 実在確認済み
- `e2e/design-guidelines.spec.ts`: 実在確認済み
- `npm run e2e`: 実行可能（package.json に定義あり相当）
- `docs/research/2026-07-10-mobile-ux-pwa.md`: 実在確認済み
- `content/research/design-uiux-20260717_deep_research.md`: 実在確認済み
- `content/research/design-uiux-20260717_deep_research.json`: 実在確認済み

### 3. SSOT 参照の明記（合格✓）
- `design-rules.md` 冒頭: 「SSOT は `docs/design/design-guidelines.md`」と明記 ✓
- `design-review-checklist.md` 冒頭: 「SSOT: 基準の根拠は `docs/design/design-guidelines.md`」と明記 ✓
- `design-review` SKILL.md: 「判断に迷う項目のみ `docs/design/design-guidelines.md`（SSOT・根拠付き）を参照」と明記 ✓
- `design-reviewer` agent: agent description に「デザインガイドライン（docs/design/design-guidelines.md の D-1〜D-10・数値基準）準拠を検証」と明記 ✓
- `self-review-checklist.md` セクション 6: `docs/design/design-guidelines.md` への参照あり ✓
- CLAUDE.md: design-rules・design-review・design-reviewer への説明で全て SSOT 参照経由 ✓

### 4. D-N 番号の整合（合格✓）
- D-1〜D-10: design-guidelines.md に全て定義済み（10 項目確認）
- D-1 参照: design-rules.md, design-review-checklist.md, SKILL ✓
- D-2 参照: design-rules.md, design-review-checklist.md, SKILL ✓
- D-3 参照: design-rules.md, design-review-checklist.md, SKILL ✓
- D-4 参照: 参照なし（数値基準に統合）
- D-5 参照: design-review-checklist.md ✓
- D-6 参照: design-rules.md, design-review-checklist.md ✓
- D-7 参照: design-rules.md, design-review-checklist.md ✓
- D-8 参照: design-review-checklist.md ✓
- D-9 参照: 参照なし（スキルではなくガイドラインのみ）
- D-10 参照: design-review-checklist.md ✓
- D-1〜D-3 違反時の「設計から見直す」: design-review-checklist.md ✓

### 5. CJK Markdown 規約（合格✓）
- `check_cjk_markdown.py` 実行結果: `OK（CJK 半角スペース違反なし）`

## 指摘事項（0 件）

すべてのドキュメント間整合性が確認されました。
- 数値基準は全ファイルで一貫
- 参照パス・コマンドは全て実在
- SSOT 参照は派生ドキュメントに明記
- D-N 番号の定義と参照は正確

## CJK 規則・表記揺れ確認（0 件）

### `uxlens` — 主張
<sub>2026-07-17T12:17:13+09:00</sub>

## uxlens r1 指摘

1. **design-guidelines.md §0/§3（completeness・critical）**: KPI「初回セットアップ完了率（ログイン→初起票）5分以内」が §0 に明記されているのに、セットアップ・GitHub 認証（ログイン）フローの設計パターンが §3 に一つも存在しない（§3.1〜3.4 はすべて「起票フォーム」以降の画面のみを扱う）。D-1〜D-10 にもログイン/初回導線に触れる原則がない → 実装者はセットアップ画面の UX 基準（ステップ数上限・認可エラー時の挙動・ショートカット作成手順の提示方法等）を判断する拠り所を持てない。**推奨**: §3 に「3.0 初回セットアップ・GitHub 認証」節を新設し、OAuth 認可 UX とショートカット作成導線の基準を明文化する。

2. **design-guidelines.md 全体（completeness・critical）**: リサーチ §6 の [A] ランク根拠「フォーカス管理: エラー時・画面遷移時にフォーカスを見失わせない（WCAG 2.4.3 Focus Order / 2.4.11 Focus Not Obscured）」が、design-guidelines.md の D-1〜D-10・§3.2 失敗パターン・design-review-checklist.md のいずれにも反映されていない。D-7（入力を失わせない）はデータ保全のみでフォーカス位置には触れていない。**推奨**: D-7 拡張またはD-9近傍に「エラー表示時はフォーカスをエラーメッセージ付近へ移動し、視覚的に隠されない位置に表示する」を追加し、チェックリスト §3 にも1行足す。

3. **design-guidelines.md §3.3（fact_check 扱い・critical）**: 「ホーム画面追加は Safari ITP 7日削除の回避にもなる（**[A]** リサーチ§5）」と記載されているが、根拠元の `design-uiux-20260717_deep_research.md` の `fact_check_flags` #4 では同一主張が **Bランク**（「iOS実機での長期検証はしていない」）と明記されている。ガイドラインが本文の [A] 表記をそのまま転記しており、fact_check_flags のダウングレードが失われている。この主張はインストール誘導という設計判断の根拠に使われているため、断定リスクが実利用に影響しうる。**推奨**: `[A]` → `[B]`（要実機長期検証）に修正するか、「未検証」の一言を添える。

4. **design-guidelines.md §3.2 と design-review-checklist.md §3 の不整合（completeness・minor）**: チェックリストは「失敗パス（401/403/429/404/422・**オフライン**）で入力が保持される」を検証項目に含むが、design-guidelines.md §3.2 の失敗パターンは HTTP ステータス別の文言基準（401/403/429/404/422）のみを定義しており、ネットワーク到達不能（オフライン）時の UX パターンが定義されていない。リサーチ §5 は workbox-background-sync が「ネットワーク到達不能のみ再送対象・4xx/5xx は対象外」という重要な区別を [A] 根拠で示しており、これが本文に落ちていない。**推奨**: §3.2 に「オフライン時: 自動再送対象である旨を明示（4xx/5xxとは異なる文言）」を追加。

5. **design-guidelines.md §2（表現の精度・minor）**: manifest shortcuts の「3件以内（Android 表示上限）」という表現は OS 恒久仕様のように読めるが、根拠は fact_check_flags #1（B ランク・2020年 Chrome 92 期の実装値で仕様保証なし）。「要実機確認」の注記はあるものの、"Android 表示上限" という言い切りが実装者に恒久仕様と誤解させる余地がある。**推奨**: 「Chrome実装値（要実機再確認）」等、可変値であることが一目で分かる表現に調整。

6. **完全性: i18n/文言基準（minor）**: エラーメッセージ・チップラベル等の UI 文言をどの言語で統一するか、GitHub API の英語エラーをどう日本語化するかの基準が §3.2 にも他箇所にも存在しない。優先度は低いが、実装者が文言を場当たり的に決めるリスクがある。**推奨**: 後続 Issue でよいので一言（文言は日本語に統一・§3.2 のエラー表にマッピング文言を追記）を残す。

以上、D-1〜D-10 自体は KPI・リサーチと整合しており独自主張や根拠の飛躍は見当たらなかった。反証済み主張（§4）の扱いも概ね適切。

### `harnesslens` — 主張
<sub>2026-07-17T12:19:02+09:00</sub>

## harnesslens r1 — 機械チェック / E2E の実効性レビュー

### critical

1. **e2e/design-guidelines.spec.ts:86-108（font-size 16px テスト） checkbox/radio 除外が未実装なのに index.css のコメントは「除外済み」と主張 → 修正必須**
   `src/index.css:16` のコメントは「checkbox/radio はネイティブ描画サイズが変わってしまうため対象外とする（**e2e/design-guidelines.spec.ts**）」と、除外ロジックが E2E 側で担保されているかのように書いている。
   しかし実装（`e2e/design-guidelines.spec.ts:91`）は `page.locator("input, textarea")` で type を一切フィルタしておらず、checkbox/radio も走査対象に入る。
   実際に `src/issues/LabelPicker.tsx:83-87` に `<input type="checkbox">` が存在し（`initiallyOpen=false` の picker/dialog 内）、現状のテストはこの checkbox が「起票フォーム初期画面では非表示（picker が開いていない）」であるがゆえに `isVisible()` に弾かれてたまたま通っている（`gotoIssueFormScreen` はラベル picker を開かない）。
   → picker を開いた状態でこのテストを走らせるシナリオを追加した瞬間、あるいは今後 checkbox が既定で可視の場所に増えた瞬間、ネイティブ checkbox の computed font-size（ブラウザ既定は概して 16px 未満）で **意図せず CI が赤くなる**（設計上は対象外にしたいはずの要素で失敗する）。
   → 推奨: `controls` のロケータを `page.locator('input:not([type="checkbox"]):not([type="radio"]), textarea')` にして CSS 側の除外ポリシーと一致させる（index.css:18 のセレクタと揃える）。

### minor

2. **e2e/design-guidelines.spec.ts:57-73（24x24 テスト） は button/input/select/textarea に対しては高さ軸が恒真** — `src/index.css:17-24` が checkbox/radio 以外の全フォームコントロールに `min-height: 44px` を強制しているため、これらの要素は height 軸で 24px 未満になり得ない（バグを入れても検出できるのは `a`/`[role="button"]` の height と、全要素の width のみ）。テスト自体は無意味ではない（width・a/role=button の height は実測している）が、コメント「全インタラクティブ要素が24x24px以上」という書き方は実効カバレッジより広く見える。回帰テストとしては妥当だが、レビュー観点 2（たまたま通る）に該当するため一言注記推奨。

3. **tools/check_design_rules.py:52（FONT_SIZE_RE）は `clamp()`/`min()`/`max()`/CSS カスタムプロパティを検出できない** — `font-size: clamp(14px, 4vw, 18px)` や `font-size: var(--fs-input)` は正規表現が `font-size\s*:\s*([\d.]+)` で数字直後を要求するため即座にマッチ失敗し、静的チェックが完全にスキップされる（false negative）。現状 `src/index.css` は未使用だが、レスポンシブ font-size を導入した瞬間に静的チェックが無力化する。E2E 側は computed style を見るのでバックストップにはなるが、Warning レベルの早期検出という静的チェックの意義が失われる。

4. **tools/check_design_rules.py:157（VIEWPORT_BAD_RE）は `user-scalable=no` のみ検出し `user-scalable=0` を見逃す** — モバイルブラウザは `user-scalable=0` も `no` と同じくズーム禁止として解釈する実装が多いが、regex は文字列 `no` を要求するため `user-scalable=0` は検出されない（WCAG 1.4.4 違反の見逃しパターン）。`user-scalable\s*=\s*(no|0)` へ拡張推奨。

5. **tools/check_design_rules.py:52 は `font:` ショートハンドを検出しない** — `font: 14px sans-serif;` のようなショートハンド指定は `font-size` という文字列を含まないため regex に一切引っかからない。フォームコントロールへの適用は現状なしだが、意図せぬ見逃し経路として存在する。

### 確認事項（バグではない）
- `self_review_check.py:210-219` の統合（拡張子 `.tsx`/`.css`/`index.html` でディスパッチ・Warning のみ・例外握り潰し方針）は妥当。`--self-test` 20/20 pass を実機確認済み。
- `docs/design/design-guidelines.md` §5 の機械チェックマップと実装（5 チェック・4 E2E テスト）に構造的な desync は見当たらない（項目 1 は「コメントの主張」と「実装」の desync であり、マップ自体とは別）。
