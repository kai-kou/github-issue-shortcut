<!--entry
author: simplicity
round: 2
kind: rebuttal
ts: 2026-07-25T16:53:14+09:00
-->

# Simplicity ラウンド 2: 批判検証 / 譲歩

## Security への所見

### localStorage 改変リスク（L94-98）への譲歩

**security の指摘**: `entry.queuedAt` は devtools で改変可能。TTL 判定を回避可→重複起票可

**評価**: ✅ **指摘妥当・影響度も正確**

- 自分の round 1 では offlineQueue TTL の設計複雑性を見たが、**ローカル改変による TTL 回避リスク** は security が正しく指摘している
- security の結論「信頼境界の指摘として妥当だが、影響は自傷的重複のみ（critical でない）」に **同意**
- 付加: 実装が `QUEUE_EXPIRED_ERROR_CODE` 経由で再送時に確認ダイアログを挟んでいる点も防御層として機能している（security が言及済み）

**critical 評価**: security の「low/informational」が適切。

---

## Conventions への所見

### スコープ / 要件整合性（全節）への同意

**conventions の指摘**: 全変更が Issue #91/128/133 に紐づいている。要件書 OQ-8 と実装が整合

**評価**: ✅ **スコープ確認として完全**

- 自分の round 1 は「効率・複雑性」焦点のため、スコープ・規約・要件整合は conventions の領分
- 確認事項（i18n 日英ペア / pushAccess 共通化 / CJK 記法前後スペース）はすべて conventions が検証済み
- 自分のレビュー対象（stop-pr-check.sh コスト・TTL 関数設計）はいずれも **Issue #91 / #133 のスコープ内であり、conventions の判定に抵触しない**

**defer 判定**: conventions の要件整合チェックに defer。自分の stop-pr-check.sh 指摘は別軸（効率コスト）。

---

## 自分の指摘の再検証（round 1 で出した 3 領域）

### 1. stop-pr-check.sh の git fetch 重複（L28 + L99-100）

**追加検証**: conventions が「gh 非依存経路追加（git diff / ls-remote）」と確認している

- L28 の `git fetch` と L99-100 の `git ls-remote --heads origin` は **異なる目的ではなく実質重複**
- `git fetch` が常時実行されるため、その後の `git ls-remote` の結果は fetch が latest である前提で動作
- 削減案（L28→ `git ls-remote origin main` に置換）は **実装に矛盾しない**（gh 非依存経路の主旨は「refs 確認」であり、fetch の必要はない）

**critical 化**: いいえ。**ただし削減優先度は実装者判断**。毎セッション終了時 ~5 秒のコスト削減は小さい収益だが、重複排除の簡潔さでは価値。

### 2. 確認ステップ重複（confirmingDiscardId / confirmingResendId）

**conventions から追加情報**: 新規キー対応が完備・i18n ペアが完全

- 自分の「UI テンプレート統一可だが実益小」という評価は **変わらず**
- conventions の新キー検証（日英対応・CJK スペース）が完備 → **削減実装は後日 tech-debt として良い**

**critical 化**: いいえ。既読性優先の判定が適切。

### 3. stop-pr-check.sh リトライ・タイムアウト（L142-159）

**security からのコメント**: 「PATH への `.claude/bin` 追加（L50-53）」の安全性を検証済み → 本体は safe

- リトライ 30 秒の問題は **`gh api` 自体の仕様** ではなく **実装的なリトライ戦略** の問題
- クラウド環境（CLAUDE_CODE_REMOTE=true）では 403 が決定的失敗（L152-155 で既認識）なのに、なぜリトライするのか → **実装意図を確認が必要**
- ただし毎セッション終了時のコストなので、削減価値は **L28 git fetch 削除** ほどは大きくない

**critical 化**: いいえ。ただしリトライ戦略を見直す tech-debt 価値はある。

---

## 議論を経て残る真の欠陥？

### Critical に該当する指摘（本体のバグ・安全性致命的欠陥）

- ❌ なし

### Significant（機能は動くが、設計 / 効率 / リスクに欠点）

| 指摘元 | 領域 | 内容 | 優先度 |
|--------|------|------|--------|
| security | offlineQueue | localStorage 改変で TTL 回避可（ただし自傷的） | low |
| simplicity | stop-pr-check.sh | git fetch + ls-remote 重複 | low（コスト小） |
| simplicity | stop-pr-check.sh | gh api リトライ 30 秒 | low（ただし改善可） |
| simplicity | OfflineQueueList | 確認ステップ UI テンプレート統一可 | tech-debt（実装後日） |

### 実装の完成度

- ✅ 要件（OQ-8）完全実装
- ✅ 規約遵守（スコープ内・i18n 完備）
- ✅ セキュリティ critical なし
- ✅ 機能テスト（E2E）検証済み
- ⚠️ 効率・複雑性は「小さな削減余地」あり（非緊急）

---

## 結論

本 PR は **機能・安全性とも完成度高く、critical 欠陥なし**。

効率・簡潔化観点で「削減可能」な箇所（git fetch・リトライ・UI テンプレート）は存在するが、いずれも **tech-debt として記録し、後日改善** で足りる。現状の実装で機能上の問題はない。

**ラウンド 2 推奨**: "all-good-low-debt" 判定で合意できるか、各レビュアーに確認。
