---
name: design-review
description: フロントエンド（src/・index.html・PWA manifest・CSS）変更のデザインレビューを実行するスキル。デザインガイドライン（docs/design/design-guidelines.md）準拠を静的チェック・E2E・チェックリスト目視の 3 層で検証する。「デザインレビューして」「UI をレビューして」「デザイン準拠を確認して」「/design-review」と依頼された時、または self-reviewer / pr-review-watcher がフロントエンド差分を検出した時に使用する。コード品質・バグは /code-review（Layer 1）の担当で、本スキルは UX・デザイン原則準拠のみを見る。
effort: medium
---

# design-review スキル

フロントエンド変更 PR に対する **デザイン準拠レビュー** を自律実行する。
`/code-review`（コード品質・Layer 1）とは観点が異なり、本スキルは
**デザインガイドライン（D-1〜D-10・数値基準）への準拠** を検証する。

## トリガー条件

- PR / 作業ツリーの差分に `src/**`・`index.html`・`vite.config.ts`（manifest）・`*.css` が含まれる
- ユーザーが「デザインレビューして」等と依頼した
- self-reviewer スキルの Step 2（観点別セルフレビュー）でフロントエンド差分を検出した

## 必読ドキュメント（Step 0 で Read）

1. `docs/rules/design-rules.md` — 実装ルール要約（鉄則 4 つ + 数値基準）
2. `docs/rules/design-review-checklist.md` — レビュー観点（フロー影響・入力・タップターゲット・失敗時・PWA）
3. 判断に迷う項目のみ `docs/design/design-guidelines.md`（SSOT・根拠付き）を参照

## 実行フロー

### Step 1: 差分スコープ確認

```bash
git diff origin/main...HEAD --name-only | grep -E '^(src/|index\.html|vite\.config\.ts)' || echo "フロントエンド差分なし（本スキル対象外）"
```

対象差分がなければ「対象外」と 1 行報告して終了する。

### Step 2: 機械チェック（3 層の 1・2 層目）

```bash
python3 tools/check_design_rules.py          # 静的チェック（Warning 一覧）
npm run e2e                                   # design-guidelines.spec.ts 含む E2E（CI と同等）
```

- E2E 失敗 = ブロッキング。原因を特定して修正する（数値基準の底上げは `src/index.css` のベースライン CSS を優先）
- 静的 Warning = 修正するか、意図的に残す理由を PR 説明文「## 設計意図・既知の警告」に記録する

### Step 3: チェックリスト目視（3 層目）

`design-review-checklist.md` の表を差分該当範囲だけ確認する。特に **セクション 0（フロー影響）は全 PR 必須**:

- 起票フロー（起動 → 入力 → 送信）にタップ・画面・待ちが増えていないか（D-3）
- 必須入力が増えていないか（D-2）
- キャプチャ外機能の持ち込みがないか（D-1）

D-1〜D-3 違反を検出したら **修正ではなく設計の見直し** を提案する（機能を既定オフにする・別画面に逃がす等）。

### Step 4: 結果の記録

- PR レビューとして実行した場合: 指摘を PR スレッドに記録（対応/スキップ + Resolve は pr-review-flow-summary.md の運用に従う）
- セルフレビューとして実行した場合: 検出 → 修正まで行い、残した Warning のみ PR 説明文に記録
- チャットへの逐次報告はしない（L-102 サイレント原則）。ブロッキング違反（E2E 失敗・D-1〜D-3 違反）のみ結果報告に含める

## 出力テンプレート（結果報告）

```markdown
## 🎨 design-review 結果
- 静的チェック: {Warning N 件（対応 M・記録残し K）}
- E2E: {pass/fail}
- フロー影響（D-1〜D-3）: {影響なし / 指摘あり → 内容}
- 目視観点: {確認したセクションと結果 1〜3 行}
```

## 禁止事項

- 数値基準の独自変更（変更は SSOT `docs/design/design-guidelines.md` §2 を先に更新する PR で行う）
- コード品質・バグ指摘への深入り（/code-review の担当。見つけたら code-review に委ねる）
- レビューを口実にした要求外のリファクタリング提案
