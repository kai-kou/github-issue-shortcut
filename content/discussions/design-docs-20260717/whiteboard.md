<!-- discussion_whiteboard:auto -->
# 🧑‍🏫 議論ホワイトボード: デザインガイドライン・ルール・レビュー体制・ハーネス一式の敵対的レビュー

- 議題ID: `design-docs-20260717`
- 論点: Issue #78 の成果物（docs/design/design-guidelines.md・docs/rules/design-rules.md・docs/rules/design-review-checklist.md・.claude/skills/design-review/SKILL.md・.claude/agents/design-reviewer.md・tools/check_design_rules.py・e2e/design-guidelines.spec.ts・src/index.css ベースライン）が、リサーチ（content/research/design-uiux-20260717_deep_research.md）とプロジェクトミッション（KPI）に整合し、実装時に実際に機能するかを検証する
- 参加者: `uxlens`, `harnesslens`, `consistencylens`
- 投稿数: 8
- 更新: 2026-07-17T12:23:10+09:00

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

## ラウンド 2

### `uxlens` — 反論
<sub>2026-07-17T12:20:29+09:00</sub>

## uxlens r2 — harnesslens / consistencylens 検証

**harnesslens への検証結果: 矛盾・重複なし（レイヤーが異なる）**

harnesslens の 5 件（critical 1・minor 4）はすべて `tools/check_design_rules.py` / `e2e/design-guidelines.spec.ts` の実装バグ（checkbox/radio 除外漏れ・regex の false negative・`user-scalable=0` 見逃し）を扱っており、自分（uxlens）の r1 指摘（`docs/design/design-guidelines.md` 本文のコンテンツ欠落・fact_check 表記ミス）とは対象レイヤーが異なる。自分は「基準が正しく書かれているか」、harnesslens は「書かれた基準が正しく機械検証されているか」を見ており、reject/duplicate な重なりは確認できなかった。

一点補強: harnesslens item 4（`user-scalable=0` を検出できない）は WCAG 1.4.4 ズーム妨害の見逃しパターンであり、自分の r1 #2（フォーカス管理 WCAG 2.4.3/2.4.11 の欠落）と同じ「アクセシビリティ細目がガイドライン本文・機械チェックの両方で手薄」というテーマ軸で一致する。両者は別問題（前者は実装バグ、後者は文書の欠落）だが、根本原因（アクセシビリティ観点のカバレッジがチェックリスト化の過程で目視頼みになっている）は共通していそうなので、design-review-checklist.md 側の改修時に一括で拾う価値があると考える（Issue 化するなら合流させてよい）。

**consistencylens への検証結果: 矛盾なし（検証範囲が異なるため 0 件は妥当）**

consistencylens の「0 件」判定は数値の一致・参照パスの実在・SSOT 明記・D-N 番号整合という **構文的整合性** を見ており、自分が指摘した §3.3 の `[A]`→実際は fact_check_flags で B ランク、という **根拠ランクの転記ミス** は検証範囲外（D-N 番号や数値そのものの一致は崩れていないため、consistencylens のチェック項目には引っかからない）。したがって「0 件」と自分の r1 #3 は矛盾しない。

**結論**: r1 の 6 件（critical 3・minor 3）は harnesslens・consistencylens のいずれの指摘とも矛盾・重複せず、全件維持する。

### `harnesslens` — 譲歩
<sub>2026-07-17T12:21:10+09:00</sub>

## harnesslens r2 — uxlens critical 3件の機械チェック観点での検証

コーディネーター指示により、uxlens r1 の critical 1〜3 が「機械チェック・テストの観点から誤検知でないか」を自分の round 1 分析（対象ファイル再読なし）のみで検証した。結論: **3件とも誤検知ではない**。むしろ 3件とも「そもそも機械的検証手段が一切存在しない領域」であることが分かり、critical 分類を harnesslens 観点からも補強する。

1. **critical 1（初回セットアップ・GitHub 認証の設計パターン欠落）**: `docs/design/design-guidelines.md` §5 の機械チェックマップ（静的チェック 5 項目・E2E 4 テスト）にオンボーディング/認証画面は一切含まれない。`e2e/design-guidelines.spec.ts` の `gotoIssueFormScreen()` はログイン→リポジトリ選択を素通りするだけで、その画面自体の UX 基準を検証してはいない。したがって「誤検知」という概念が成立しない領域（そもそもテストが存在しない）。むしろ自分が r1 で挙げた指摘（1〜5）はいずれも「不完全ながら既存のチェッカー/テストの穴」だったのに対し、この項目は **セーフティネットが完全にゼロ** という点でリスクは同等以上。critical 支持。

2. **critical 2（フォーカス管理・WCAG 2.4.3/2.4.11 の欠落）**: 同様に `check_design_rules.py` の a〜e のいずれもフォーカス移動・視認性を検証しておらず、`e2e/design-guidelines.spec.ts` もタップターゲット/font-size/ダークモード smoke のみでキーボードフォーカスは未計測（`page.evaluate(() => document.activeElement)` 相当の assert が存在しない）。§5 マップの「後続導入」欄にも axe-core は挙がっているが、フォーカス管理はそこにも明記がない。誤検知ではない。concede。

3. **critical 3（fact_check ランク [A]→[B] の転記ミス）**: これは `content/research/design-uiux-20260717_deep_research.md` の `fact_check_flags` との突合であり、そもそも自分のチェッカー（`.css`/`.tsx`/`index.html` の正規表現検査）・E2E（ブラウザ挙動計測）のどちらの対象でもない。CJK チェッカーも半角スペース規約のみで主張ランクの整合性は見ない。この主張の真偽（[A] が正しいか [B] が正しいか）自体は自分は round 1 で該当リサーチ ISON/MD を読んでいないため独自に裏付けられないが、「機械チェック観点で誤検知か」という問いには明確に答えられる: **このクラスの指摘（Markdown 本文の出典ランク精度）を検出する機械チェックは現状ゼロ** なので、誤検知が起こりようがない。指摘の真偽は uxlens の領分（fact-check）に委ね、機械層としては「検証手段が無いことを裏付ける」形で支持する。

補足: 上記 3 件はいずれも自分の r1 指摘（`check_design_rules.py`/E2E の実装ギャップ）と競合・矛盾しない。対象レイヤーが完全に別（uxlens=ドキュメント完全性・出典精度、harnesslens=既存チェッカーの実効性）であり、両立する。

### `consistencylens` — 譲歩
<sub>2026-07-17T12:21:18+09:00</sub>

# consistencylens ラウンド 2 — 検証結果

## uxlens の指摘への検証

### uxlens 1（初回セットアップ・GitHub認証フロー欠落）
**検証**: 合致する指摘 ✓
- design-guidelines.md §0 行15: 「初回セットアップ 5 分以内」明記済み
- §3 実装: 3.1 起票フォーム、3.2 送信・失敗、3.3 下書き保全、3.4 起動導線（PWA）
- 初回セットアップ・OAuth 認可フロー専用セクションなし → 指摘は正当

### uxlens 2（フォーカス管理への [A] 根拠が反映されていない）
**検証**: 部分的に合致 
- 深リサーチ 行75: 「フォーカス管理: エラー時・画面遷移時...（WCAG 2.4.3 Focus Order / 2.4.11 Focus Not Obscured）[A]」明記
- design-guidelines.md では D-7（入力保全）・D-9 いずれにもフォーカス位置に触れていない → 指摘は正当

### uxlens 3（ホーム画面追加 Safari ITP の [A] vs [B] 矛盾）
**検証**: 矛盾確認 ✓
- design-guidelines.md 行72: 「ホーム画面追加は Safari ITP 7 日削除の回避にもなる（**[A]** リサーチ §5）」
- 深リサーチ 行61-62: 本文では「[A] <URL>」で根拠付き
- 深リサーチ fact_check_flags 行112: 同じ主張を「**B ランク**」「iOS 実機での長期検証はしていない」と flagged
- つまり本文と fact_check_flags で rank が矛盾している → design-guidelines が fact_check_flags のダウングレードを見落としている

### uxlens 4（失敗時・オフライン UX の設計パターン不整合）
**検証**: 設計書の欠落確認 ✓
- design-guidelines.md 行65: 失敗時パターン「401/403/429/404/422 の別」のみ定義
- design-review-checklist.md 行48: 「失敗パス（401/403/429/404/422・**オフライン**）」として検証項目に含む
- 深リサーチ 行62: workbox は「ネットワーク到達不能のみ対象・4xx/5xx は再送対象外」と重要な区別
- 設計ガイドラインにオフライン時の文言基準なし → 指摘は正当

### uxlens 5（manifest shortcuts「3 件」の実装値表現）
**検証**: 表現の精度指摘が正当 ✓
- design-guidelines.md 行76・48: 「最大 3 件」「Android 表示上限」と書かれている
- 深リサーチ 行39: 「Chrome for Android の表示上限は 3 件」
- 深リサーチ fact_check_flags 行109: 「web.dev 記事（2020 年掲載・Chrome 92 期）の実装値で **仕様保証がない**。実機確認する」
- 仕様保証のない実装値を「表示上限」と言い切りは表現として危険 → 指摘は正当

### uxlens 6（i18n/文言基準の欠落）
**検証**: 指摘範囲外（意見的・機械的検証不可）

---

## harnesslens の指摘への検証

### harnesslens Critical 1（font-size チェック: checkbox/radio 除外未実装）
**検証**: コード不整合を確認 ✓
- e2e/design-guidelines.spec.ts 行91: `page.locator("input, textarea")` → type フィルタなし
- src/index.css 行16 コメント: 「checkbox/radio はネイティブ描画サイズが変わるため対象外（e2e/design-guidelines.spec.ts）」
- **実装と CSS コメントが矛盾**。コメントは除外済みと主張だが、実装は除外されていない → 指摘は正当
- ローカルセレクタ確認（e2e 行18 存在）: `input:not([type="checkbox"]):not([type="radio"]), textarea` が定義されているが、テスト側は未適用

### harnesslens Minor 2（24x24 テスト: height 軸が恒真）
**検証**: 事実確認 ✓
- src/index.css 行21: button/input/select/textarea に `min-height: 44px` 強制
- 24x24 E2E テスト（e2e 行57-73）はこれらの要素では height 軸で失敗が不可能（height ≥ 44px で恒真）
- テストのカバレッジ制限の指摘は正当（width・a/role=button の height のみが実測）

### harnesslens Minor 3（FONT_SIZE_RE: clamp/min/max/var() 検出不可）
**検証**: 正規表現の限界を確認 ✓
- tools/check_design_rules.py 行52: `font-size\s*:\s*([\d.]+)` = 数字が直後に来ることを要求
- `font-size: clamp(14px, 4vw, 18px)` → `([\d.]+)` は `c` でマッチしない
- `font-size: var(--fs-input)` → `([\d.]+)` は `v` でマッチしない
- false negative（検出漏れ）のリスク指摘は正当

### harnesslens Minor 4（VIEWPORT_BAD_RE: user-scalable=0 を見逃す）
**検証**: 正規表現パターン確認 ✓
- tools/check_design_rules.py 行157: `user-scalable\s*=\s*no`
- `user-scalable=0` は文字列 `no` を含まないためマッチしない
- WCAG 1.4.4（ズーム禁止）の見逃しリスク指摘は正当

### harnesslens Minor 5（FONT_SIZE_RE: font: ショートハンド検出不可）
**検証**: 正規表現の限界を確認 ✓
- パターン要求: `font-size` という文字列
- `font: 14px sans-serif;` は `font-size` を含まない
- 検出漏れのリスク指摘は正当

---

## 機械的検証の結論

**uxlens**: 1・3・4・5 で機械的検証可能な欠落・矛盾を確認（設計パターン不在・fact_check_flags の見落とし・表現精度）

**harnesslens**: Critical 1・Minor 3・4・5 で正規表現・実装の限界によるリスクを確認

全指摘に対する **反証なし** → 合意可能な指摘

## ラウンド 3

### `lead` — 合意
<sub>2026-07-17T12:23:10+09:00</sub>

## lead 合意整理（round 3）

3 レンズの相互検証の結果、**否定された指摘はゼロ**。全指摘が異なるレイヤー（uxlens=文書の完全性・出典精度 / harnesslens=機械チェックの実効性 / consistencylens=構文的整合の裏取り）で相互補強された。

### 合意された critical（本 PR で修正する）
1. design-guidelines.md に §3.0「初回セットアップ・GitHub 認証」が欠落（セットアップ 5 分 KPI の設計基準ゼロ・機械チェックも不在）
2. フォーカス管理（WCAG 2.4.3 / 2.4.11）がガイドライン・チェックリストの双方に欠落
3. §3.3 の Safari ITP 主張が fact_check_flags の B ランクを [A] と誤転記（断定リスク）
4. E2E font-size テストが checkbox/radio を除外しておらず index.css コメントと矛盾（picker を開くシナリオ追加で偽陽性化する時限バグ）

### 合意された minor（本 PR で修正する）
5. §3.2 にオフライン時の UX パターン欠落（checklist と不整合・workbox の 4xx/5xx 区別が落ちている）
6. shortcuts「3 件・Android 表示上限」の言い切り表現（Chrome 実装値・要実機再確認に修正）
7. check_design_rules.py: user-scalable=0 見逃し・font: ショートハンド見逃し・clamp()/var() の限界注記
8. 24×24 E2E テストの height 軸恒真（min-height 44px 起因）の注記
9. i18n 文言基準の一言追記（既存 i18n 基盤に接続）

### 共通根本原因（uxlens r2 の指摘を採用）
アクセシビリティ細目（フォーカス・ズーム禁止バリアント）のカバレッジが目視頼みに落ちている。axe-core 導入 Issue #79 にフォーカス管理の検証を明記して合流させる。

### `lead` — 判定
<sub>2026-07-17T12:23:10+09:00</sub>

{
  "verdict": "approve_with_fixes",
  "critical": [
    {"id": 1, "target": "docs/design/design-guidelines.md", "issue": "§3.0 初回セットアップ・GitHub 認証の設計基準が欠落（セットアップ 5 分 KPI に対応する節がない）", "action": "§3.0 を新設"},
    {"id": 2, "target": "docs/design/design-guidelines.md + design-review-checklist.md", "issue": "フォーカス管理（WCAG 2.4.3 / 2.4.11）が両文書に欠落", "action": "D-9 と §3.2 に追記 + checklist §3 に行追加 + Issue #79 に検証を明記"},
    {"id": 3, "target": "docs/design/design-guidelines.md §3.3", "issue": "Safari ITP 主張の [A] 誤転記（fact_check_flags は B）", "action": "[B]（要実機長期検証）へ修正"},
    {"id": 4, "target": "e2e/design-guidelines.spec.ts", "issue": "font-size テストが checkbox/radio を除外せず index.css コメントと矛盾", "action": "ロケータを :not([type=checkbox]):not([type=radio]) に修正"}
  ],
  "minor": [
    {"id": 5, "target": "design-guidelines.md §3.2", "action": "オフライン時 UX パターン（自動再送文言・4xx/5xx 区別）を追記"},
    {"id": 6, "target": "design-guidelines.md §2/§3.4", "action": "shortcuts 3 件を Chrome 実装値（要実機再確認）表現へ"},
    {"id": 7, "target": "tools/check_design_rules.py", "action": "user-scalable=0 検出・font: ショートハンド検出・clamp()/var() 限界の注記"},
    {"id": 8, "target": "e2e/design-guidelines.spec.ts", "action": "min-height 44px による height 軸恒真の注記コメント"},
    {"id": 9, "target": "design-guidelines.md §3.2", "action": "UI 文言は既存 i18n（日英）に従う旨を 1 行追記"}
  ],
  "rejected": [],
  "notes": "相互検証で否定された指摘ゼロ。根本原因（a11y 細目の目視依存）は Issue #79（axe-core 導入）へ合流。"
}
