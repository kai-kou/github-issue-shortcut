<!-- discussion_whiteboard:auto -->
# 🧑‍🏫 議論ホワイトボード: PR #151 Layer 2 議論型レビュー（オフラインキュー TTL の重複起票防止設計 / stop-pr-check の PR 存在判定）

- 議題ID: `pr151_layer2_review`
- 論点: あなた方は対象 PR の実装経緯を知らない外部レビュアーである。差分そのものを唯一の根拠として欠陥を探す。焦点は (1) オフラインキュー TTL（クライアント 24h < サーバー重複防止窓 26h）+ 期限切れ手動再送の確認ステップで、重複起票が本当に防げているか (2) stop-pr-check.sh の PR 存在判定（refs/pull/*/head の SHA 照合 + origin/main との差分ゼロ判定）が誤検知・見逃しを起こさないか。ラウンド2で互いの指摘を批判検証し、議論を経ても残る真の欠陥だけを critical にする。
- 参加者: `correctness`, `security`, `simplicity`, `conventions`
- 投稿数: 3
- 更新: 2026-07-25T16:50:50+09:00

> このファイルは `tools/discussion_whiteboard.py render` が自動生成する。直接編集せず `post` で追記すること（同時書き込み破損防止）。

## ラウンド 1

### `simplicity` — 主張
<sub>2026-07-25T16:48:17+09:00</sub>

# Simplicity レビュー PR#151・Layer 2（観点別並列）

## 1. TTL 関数 3 段構成（`src/issues/offlineQueue.ts` L83-112）

**評価**: ✅ 適切な設計

- `isOfflineQueueEntryExpired` (L84-86): TTL 超過判定・純関数・テスト対象
- `expireStaleEntries` (L91-102): 全キューへ適用・純関数・戻り値が構造化（`{ queue, expiredIds }`）
- `expireStaleOfflineQueue` (L105-112): storage 層（loadOfflineQueue + expireStaleEntries + persist）

責任が明確：純ロジック → 永続化。複雑性は不要ではない。削除判定。


## 2. 確認ステップ 2 種（`src/issues/OfflineQueueList.tsx` L51-84）

**評価**: ⚠️ 見た目重複だが本質は異なる

状態管理:
- `confirmingDiscardId`: いつでも削除可
- `confirmingResendId`: TTL 期限切れのみ確認必須（L35-39 の `requestResend` で条件分岐）

最適化案（未実装で可）: 単一 state に union 型を使い `{type: "discard"|"resend-expired", id}` へ統一すれば状態変数 1 個に。ただし現状コードは読みやすく、実益は小さい。

削除判定。既読性 > 機械的なコンソリデーション。


## 3. Stop hook のリモートアクセスコスト（`.claude/hooks/stop-pr-check.sh`）

**評価**: ⚠️ 毎セッション終了時コストが高い

問題点:

1. **L28** `git fetch --quiet origin main` → **L99-100** `git ls-remote --heads origin` 重複
   - fetch は履歴取得（重い）、ls-remote は refs 一覧のみ（軽い）
   - 削除対象: L28 を `git ls-remote origin main` のみに変更

2. **リトライ・タイムアウト積算** (L142-159)
   - `gh api` 2 回リトライ × timeout 15秒 = 最悪 30 秒
   - クラウド環境（CLAUDE_CODE_REMOTE=true）では 403 が決定的失敗（L152-155 で already 認識）なのに、**その直後も `gh api` を 2 回目試行** 
   - 改善: クラウド環境では 4xx で即 unknown 分岐へ（リトライしない）

3. **`git fetch` + `git ls-remote` の動作重複** (L28, L99-100)
   - 同じ目的（リモート確認）を 2 ツールで実施
   - 実装: refs を 1 回取得して、複数の判定で再利用

改善で削減可能なコスト:
- `git fetch` 除去 → ~5 秒
- リトライ簡略化（クラウド 403 即断定） → ~15 秒（1 回目試行のみ）
- 総計 ~20 秒のセッション終了時レイテンシ削減可能

推奨：優先度は **L28 の git fetch 削除** から始める。明確な重複。


## サマリー

| 領域 | 評価 | 指摘 |
|------|------|------|
| TTL 3 段関数 | ✅ 適切 | 層分けが明確。責任分離 OK |
| 確認ステップ | ⚠️ 最適化可（実益小） | UI テンプレート統一可・現状で十分読みやすい |
| stop-pr-check.sh リモート | ⚠️ コスト削減余地 | 毎セッション終了時 ~20 秒短縮可（git fetch 削除 + リトライ簡略化） |

### `security` — 主張
<sub>2026-07-25T16:48:40+09:00</sub>

## セキュリティレビュー（レンズ: security）

対象: `git diff origin/main...HEAD`（PR #151 相当）

### 1. `.claude/hooks/stop-pr-check.sh`

- **`git ls-remote origin 'refs/pull/*/head'` → grep への取り込み**: `head_sha` はローカル `git rev-parse HEAD` 由来（16進のみ）で、リモート由来の `pr_refs` はパターン文字列としてではなく `printf '%s\n' "$pr_refs" | grep -q "^${head_sha}[[:space:]]"` の **入力側**（grep が検索する対象データ）として使われている。`head_sha` はコマンドインジェクション／正規表現メタ文字の混入経路にならない（自分のコミットハッシュのみ・外部入力ではない）。injection なし。
- **`timeout 10s git fetch --quiet origin main` / `git diff --quiet origin/main HEAD`**: 標準的な fetch/diff。`set -euo pipefail` 下でも `if` 条件内のため意図しない early-exit は起きない。問題なし。
- **PATH への `.claude/bin` 追加**（`PATH="$REPO_ROOT/.claude/bin:$PATH"`、`.claude/bin/gh` が実行可能かつ実 `gh` が PATH に無い場合のみ）: リポジトリに同梱された `gh` シム（`tools/gh_shim.py` 相当）を優先実行する経路を Stop フックにも拡張している。これは **リポジトリ管理下のファイルを自動実行する** パターンで、`session-start.sh` に既存の同種パターンを Stop フックへ複製したもの。フック自体が repo に checkout されたシェルスクリプトとして無条件に実行される設計（Claude Code のフック機構自体が repo 内容を信頼する前提）である以上、本差分単体で新たな信頼境界の突破を生んではいない（差分固有の再現可能な脆弱性ではなく、既存設計の前提を追認しただけ）。ただし念のため記録: 外部コントリビューターが送った未マージ PR ブランチをこの Stop フックが動くセッションで checkout した場合、そのブランチの `.claude/bin/gh` 改変版が次回セッション終了時に自動実行され得る（フック自体も同じブランチ内にあるため、フックコード自体の改変と同レベルのリスクであり、本差分が新規に開けた穴ではない）。critical 化はしない（既存の「hooks は repo 信頼済み」という前提の範囲内・本差分に起因する新規の再現可能な脆弱性ではないため）。
- `gh --version` 実行は固定引数・timeout 付きで問題なし。

→ このファイルに critical な脆弱性なし。

### 2. オフラインキュー TTL（`src/issues/offlineQueue.ts` ほか）

- `isOfflineQueueEntryExpired` / `expireStaleEntries` は `entry.queuedAt`（`localStorage` に永続化されたクライアント制御データ）と `Date.now()` を比較する。`localStorage` は利用者本人が devtools 等で自由に書き換え可能な **信頼境界の外側** のデータであり、この値を書き換えれば TTL 判定（24h）を意図的に回避・偽装できる（E2E テスト `e2e/offline-queue.spec.ts` の新規ケースが `page.evaluate` で `queuedAt -= 25h` して実証済み＝再現可能）。
- ただし実害を評価すると: TTL の目的はサーバー側 dedupe window（26h・`client_request_id` ベース、サーバー側実装でこの diff の対象外）が切れた後の **重複 Issue 作成の抑止**。ローカルで `queuedAt` を偽装できても、影響範囲は「自分の GitHub アカウント・自分が push 権限を持つリポジトリに、自分の意図で重複 Issue を作成する」に留まり、他者への権限昇格・情報漏洩・第三者リポジトリへの不正操作には繋がらない（本人が既に持つ Issue 作成権限の範囲内の自傷的重複のみ）。加えて実装は手動再送時にも `QUEUE_EXPIRED_ERROR_CODE` 経由で確認ダイアログ（「重複して作成されます」）を挟んでおり、ワンタップでの重複送信も抑制している。
- 結論: **信頼境界の指摘としては妥当**（クライアント制御データに business-logic 判定を委ねている）が、影響が自分自身の重複起票に限定されるため **critical には該当しない**。low/informational として記録する。

### `conventions` — 主張
<sub>2026-07-25T16:49:26+09:00</sub>

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
- `offlineQueueResendConfirmMessage`: 「既に作成済み **だった** 場合」の **だった** は太字でなく通常（コード例の一部）。✅
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
