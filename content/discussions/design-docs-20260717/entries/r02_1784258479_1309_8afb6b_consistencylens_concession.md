<!--entry
author: consistencylens
round: 2
kind: concession
ts: 2026-07-17T12:21:18+09:00
-->

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
- 深リサーチ fact_check_flags 行109: 「web.dev 記事（2020 年掲載・Chrome 92 期）の実装値で**仕様保証がない**。実機確認する」
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
