<!--entry
author: conventions
round: 1
kind: claim
ts: 2026-07-25T16:49:26+09:00
-->

# PR #151 規約観点レビュー（conventions）

## スコープ確認

**対象 Issue**:
- Issue #91: オフラインキュー 24 時間 TTL（自動再送停止）と手動確認フロー
- Issue #128: RepoPicker / ShortcutHelperPage の pushAccess 判定ドリフト防止（共通関数化）
- Issue #133: gh 非依存の PR 確認（hook 強化）

**変更ファイル** （15 ファイル・スコープ内）:
- ✅ `.claude/hooks/stop-pr-check.sh`: Issue #133 対応（gh 非依存経路追加）
- ✅ `docs/requirements/00-requirements.md`: OQ-8 決定反映・下書き復帰案の却下理由を明記
- ✅ `src/i18n/translations.ts`: 新規キー日英対応（queueExpired 等）
- ✅ `src/issues/offlineQueue.ts`: TTL 定数と期限切れ判定関数
- ✅ `src/repos/pushAccess.ts`: Issue #128 共通関数（新規作成）
- ✅ `src/repos/RepoPicker.tsx`: 共通関数を使用（#128）
- ✅ `src/shortcuts/ShortcutHelperPage.tsx`: 共通関数を使用（#128）
- ✅ `e2e/offline-queue.spec.ts`: TTL 超過ケース検証（#91）
- ✅ その他 e2e：スコープ内

**「ついで」の混入**: なし。全て対象 Issue に紐づいている。

---

## 要件と実装の整合性

### 要件書 OQ-8（2026-07-25 決定）vs 実装

| 項目 | 要件 | 実装 | 整合性 |
|------|------|------|--------|
| TTL 値 | 24 時間 | `OFFLINE_QUEUE_TTL_MS = 24 * 60 * 60 * 1000` | ✅ |
| サーバー窓 | 26 時間 | コメント「サーバー窓より短く取ることで重複回避」と明記 | ✅ |
| TTL 超過の扱い | 自動再送停止 → 手動確認へ | `expireStaleEntries()` で status を "failed"・errorCode を "queue_expired" へ | ✅ |
| エラーメッセージ | "queue_expired" 用メッセージ | i18n に `error.submitError.queueExpired` / `queueExpired` 両キー | ✅ |
| 再送時の確認 | 重複起票の可能性を明示 | i18n `offlineQueueResendConfirmMessage` に「既に作成済みの場合、重複される」と明記 | ✅ |
| E2E テスト | TTL 超過時に自動再送されないことを検証 | e2e/offline-queue.spec.ts に新規テスト「期限切れは自動再送されず、期限切れとして手動確認へ回る（#91）」 | ✅ |

### 要件書 FR-24 vs オフラインキュー再送

- FR-24 の「オフラインキュー再送との整合」: 「M3 で対応済み（`client_request_id` の 26 時間窓照合 + クライアント側 24 時間 TTL・OQ-8 決定済み）」と更新 ✅

### 要件書 §7.2 vs 実装

- 既出の「下書きへ戻す案」から「失敗一覧に残す」へ変更
- 理由：「既に起票済みの可能性を利用者へ明示せずに再入力させると重複起票を誘発する」と明記（本差分で追加）✅

---

## hook 変更と CLAUDE.md の整合性

### `.claude/hooks/stop-pr-check.sh` の変更

| 変更内容 | CLAUDE.md 記載 | 矛盾 |
|---------|----------------|------|
| gh 非依存経路追加（git diff / ls-remote） | 行 222: `stop-pr-check.sh`: 「push 済み未 PR ブランチ検知」（変更前後とも） | ✅ 抽象度は一致（詳細追加だが説明に矛盾なし） |
| gh usable 判定強化（シムと実バイナリの区別） | 記載なし（詳細実装） | ✅ OK |
| エラーメッセージ改善（MCP 誘導） | 記載なし | ✅ OK |

L-114 / L-133 への参照も適切。

---

## i18n 新規キー（日英対応チェック）

### 新規キー一覧

| キー | 日本語 | 英語 | 対応状況 |
|------|--------|------|----------|
| `offlineQueueResendConfirmMessage` | ✅ | ✅ | 対応済み（日英ペア） |
| `offlineQueueResendConfirmButton` | ✅ | ✅ | 対応済み（日英ペア） |
| `error.submitError.queueExpired` | ✅ | ✅ | 対応済み（日英ペア） |

### 既存キー変更（既に存在）

- `placementGuideBody`: 既存（M2）のテキスト拡張。日英両方更新。✅
- `placementGuideNote`: 既存。変更なし。✅

**CJK 強調前後の半角スペース** 確認:
- `errors.submitError.queueExpired`: 「自動再送を停止」が **太字** → 「を停止」で句点直前のため不要。✅
- `offlineQueueResendConfirmMessage`: 「既に作成済み**だった**場合」の **だった** は太字でなく通常（コード例の一部）。✅
- `placementGuideBody`: 「（待たずに反映させたい場合は」の **待たずに** が強調でなく通常テキスト。✅

---

## Issue #128（pushAccess 共通化）確認

### `pushAccess.ts` 新規ファイル

- コメント: 「RepoPicker と ShortcutHelperPage で判定基準がドリフトしないよう共通化（#128）」と明記
- 実装: リポジトリ未選択や存在しない fullName のときは false（安全側）
- 呼び出し側（RepoPicker・ShortcutHelperPage）: 両方で新しい共通関数を使用

**ドリフト防止の有効性**: ✅ 判定ロジックが 1 箇所に集約済み

---

## 実装間の SSOT / ドリフト検出

### offlineQueue.ts と i18n

- TTL 定数 `OFFLINE_QUEUE_TTL_MS` が 24 時間で、コメント「サーバー窓より短く」と明記
- i18n の `queueExpired` メッセージでも「24 時間以上」と同じ値を示唆
- E2E テストも `25 * 60 * 60 * 1000`（25 時間戻す = TTL 超過）で検証

**値の一貫性**: ✅

### hook と requirements

- requirements.md に「issue_log」と「client_request_id」の 26 時間窓が明記
- hook はクライアント側の 24 時間 TTL と git 非依存経路のみ担当（正しい関心分離）

**関心分離**: ✅

---

## 指摘事項

### 1. i18n 「24 時間以上」の浮動小数点型精度

**場所**: `offlineQueueResendConfirmMessage` / `queueExpired`

**内容**: メッセージで「24 時間以上」と述べているが、実装は `24 * 60 * 60 * 1000` ミリ秒の固定値。

**判定**: ✅ 妥当。ユーザー向けには「24 時間」の粒度で十分。

---

## 結論

- ✅ 全変更が Issue #91・#128・#133 のスコープ内に収まっている
- ✅ 要件書（OQ-8）と実装（offlineQueue.ts / i18n）が整合している
- ✅ Hook 変更は CLAUDE.md・L-114 の記述と矛盾しない
- ✅ i18n 新規キーが日英ペアで完備されている
- ✅ 共通関数化（pushAccess）でドリフト防止が機能している
- ✅ E2E テストで TTL 超過ケースを検証している

**規約観点での問題**: なし。高水準を維持できている。
