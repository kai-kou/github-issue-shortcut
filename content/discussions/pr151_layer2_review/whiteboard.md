<!-- discussion_whiteboard:auto -->
# 🧑‍🏫 議論ホワイトボード: PR #151 Layer 2 議論型レビュー（オフラインキュー TTL の重複起票防止設計 / stop-pr-check の PR 存在判定）

- 議題ID: `pr151_layer2_review`
- 論点: あなた方は対象 PR の実装経緯を知らない外部レビュアーである。差分そのものを唯一の根拠として欠陥を探す。焦点は (1) オフラインキュー TTL（クライアント 24h < サーバー重複防止窓 26h）+ 期限切れ手動再送の確認ステップで、重複起票が本当に防げているか (2) stop-pr-check.sh の PR 存在判定（refs/pull/*/head の SHA 照合 + origin/main との差分ゼロ判定）が誤検知・見逃しを起こさないか。ラウンド2で互いの指摘を批判検証し、議論を経ても残る真の欠陥だけを critical にする。
- 参加者: `correctness`, `security`, `simplicity`, `conventions`
- 投稿数: 10
- 更新: 2026-07-25T16:56:06+09:00

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

### `correctness` — 主張
<sub>2026-07-25T16:52:08+09:00</sub>

## correctness レンズ: 指摘

### 1. オフラインキュー TTL 設計（重要度: 高・実害あり）

**バグ: 手動再送が「その他の失敗」で終わると `queue_expired` マーカーが失われ、以後の再送で確認ダイアログが出なくなる**

- `src/issues/useOfflineQueueSync.ts` の `resend()`（L136-149）は、`postQueuedEntry` が `"failed"` を返すと
  `markOfflineQueueFailed(id, result.code)` を呼び、**`errorCode` を無条件に上書き** する（L144-146）。
- `src/issues/OfflineQueueList.tsx` の `requestResend()`（L32-39）は `item.errorCode === QUEUE_EXPIRED_ERROR_CODE`
  のときだけ確認ダイアログを出す。
- したがって: TTL 超過で `errorCode="queue_expired"` になった項目をユーザーが再送 → その再送が
  `duplicate_submission` 以外の何らかの失敗（`validation_failed` / `rate_limited` / `upstream_failed` 等、
  GitHub 側にまだ作成されていないことを意味しない失敗を含む）で終わる → `errorCode` がその新コードで
  上書きされ `queue_expired` の記録が消える → **次回以降の再送タップは `requestResend()` の分岐で
  `QUEUE_EXPIRED_ERROR_CODE` と一致しなくなり、確認なしのワンタップ再送に戻る**。
- 具体シナリオ: entry が T+24h で `queue_expired`（自動再送停止）→ ユーザーが T+25h に再送確認 →
  たまたま 429 rate_limited で失敗 → errorCode が `rate_limited` に上書き → ユーザーが T+30h に再度
  「再送」を押すとノーコンファームで即送信される。もし本来の初回試行（T+0 付近）がサーバーには到達し
  GitHub 側で Issue 作成済み・ACK だけロストしていた場合、T+30h はサーバー側重複防止窓
  （`OFFLINE_QUEUE_DEDUPE_WINDOW` = 26h、起点は最初にサーバーに届いた時刻）をとうに過ぎている可能性が高く、
  `reserveRequestId` のスタール判定が通って `ON CONFLICT DO UPDATE` が成功し、**GitHub 上に本当に重複
  Issue が作られる**。しかもこのときユーザーには何の警告も出ない（確認 UI が消えているため）。
- 根本原因: 「なぜ自動再送を止めたか（TTL 超過という永続的分類）」と「直近の送信試行の結果（一時的な
  outcome）」を同じ `errorCode` フィールドに混在させていること。TTL 超過フラグは outcome とは独立に
  保持しないと、この安全策全体が空文字化する。

**構造的な残存リスク（設計として意図的だが未文書化）: 確認ダイアログの「安全な猶予」は最悪ケースで約 2 時間しかない**

- クライアント TTL（24h・`enqueueOfflineIssue` の `queuedAt` 起点）とサーバー重複防止窓（26h・
  `reserveRequestId` の `created_at` 起点、こちらは「サーバーに実際に届いた最初の試行時刻」が起点）は、
  起点が異なる。オフライン端末が復帰直後に最初の送信を試み、その ACK だけがロストする最悪ケースでは
  両者の起点がほぼ一致し、猶予は `26h - 24h = 2h` しかない。
- `queue_expired` のメッセージ文言（`translations.ts` L226-227 / L258-259・L464-465 / L496-497）は
  「24 時間以上経過しています」という固定文言で、経過時間を問わず同一表示になる。ユーザーが 2 時間以内に
  再送しようが 5 日後に再送しようが同じ警告のため、**実際にはサーバー側の保護がとうに切れている状況でも
  「まだ大丈夫そう」という誤った安心感を与える**。TTL 超過後の重複防止は実質「ユーザーが GitHub を見て
  確認する」という人手判断に完全依存しており、それを促す UI がその判断の緊急度（残り猶予がどれだけ
  シビアか）を一切伝えていない。

---

### 2. `stop-pr-check.sh` の PR 存在判定（重要度: 中）

**新設の early-exit（L24-31: `git diff --quiet origin/main HEAD`）に見逃しリスクなし・誤警告防止としては妥当**

- squash マージ直後にツリー内容が一致する、という判定はマージコミットの祖先関係に依存しないため妥当。
  ツリーが一致するのに実際は「PR 未作成でこれから出すべき差分がある」ケースは、その差分自体が存在しない
  ことを意味するため理論的に起こらない（誤って早期 exit するとしたら、その時点で PR 化すべき差分自体が
  無いということなので実害はない）。
- 軽微な懸念点: `git fetch --quiet origin main`（L28）は `+main:refs/remotes/origin/main` のような
  明示 refspec ではない。CLAUDE.md の G-1（`session-safety-rules.md`）は「squash マージ後は明示 refspec
  で同期する」ことを明記しているが、本フックは非明示形式を使っている。標準的な `clone` 由来の
  `remote.origin.fetch`（`+refs/heads/*:refs/remotes/origin/*`）が設定されている環境では実害はないが、
  もし何らかの理由で `origin/main` の追跡ブランチが非 fast-forward 更新を拒否する状況（force-push 後の
  特殊なリモート構成等）だと、`git rev-parse origin/main` が古いコミットを指したまま `git diff --quiet`
  が判定してしまう可能性がある。ただしこの場合は「差分あり」判定に倒れる（stale な古い方は現行 HEAD と
  差分が出る側に倒れやすい）ため、警告を出さないべきところで出す方向の誤検知（過検知）にしかならず、
  「PR 未作成なのに警告しない」（見逃し）方向のリスクは実質的に無い。

**`refs/pull/*/head` 照合（L39-45）は見逃し方向にわずかな穴がある**

- コメント（L37-38）で「クローズ済み PR も含むため、PR を作ったが未マージのまま閉じたブランチでも警告が
  出ない」ことは意図的に許容すると明記されており、これは設計判断として妥当（フックの目的が「PR 作成を
  忘れていないか」の検知である以上、一度 PR 化されていれば目的は達成されている）。
- ただし `git ls-remote origin 'refs/pull/*/head'` はデフォルトで通常 pull request 由来の ref のみを
  返す（`refs/pull/<N>/head`）。GitHub の仕様上、**draft PR も同じ `refs/pull/<N>/head` に含まれる** ため
  draft PR も「作成済み」として扱われる点は妥当。
- `head_sha` の照合は完全一致（`grep -q "^${head_sha}[[:space:]]"`）のみで、ブランチが `git rebase` /
  `git commit --amend` 等でローカル HEAD が変わり、直前に push していない場合は不一致になり後続の
  gh 経路にフォールバックする（安全側）ため見逃しには繋がらない。この経路自体に見逃しの実害は見当たらない。

総じて、`stop-pr-check.sh` 側は「誤警告防止（false positive の削減）」目的の変更として整合しており、
「PR 未作成なのに警告しない（見逃し）」方向の具体的な欠陥は見つからなかった。オフラインキュー側の
finding 1（errorCode 上書きによる確認ダイアログ消失）が本 PR の中で最も実害の大きい correctness 上の
欠陥と考える。

## ラウンド 2

### `correctness` — 反論
<sub>2026-07-25T16:53:04+09:00</sub>

## correctness → round 2

### `conventions` への反証（重要）

`conventions` の表は「TTL 超過の扱い: `expireStaleEntries()` で status を `failed`・errorCode を
`queue_expired` へ ✅」「再送時の確認: i18n に重複警告あり ✅」としているが、これは **要件文言と静的な
コード配置が対応しているかだけを見た確認** であり、実際の状態遷移パスを追えていない。

round 1 で示した通り、`src/issues/useOfflineQueueSync.ts` の `resend()`（L136-149）は
`postQueuedEntry` が `duplicate_submission` 以外の `"failed"` を返すと `markOfflineQueueFailed(id, result.code)`
で `errorCode` を無条件上書きする。`OfflineQueueList.tsx` の `requestResend()` は
`errorCode === QUEUE_EXPIRED_ERROR_CODE` のときだけ確認ダイアログを出す設計なので、
「`queue_expired` → 再送 → duplicate 以外の失敗（`rate_limited` 等）→ 次の再送はノーコンファーム」という
**特殊操作なしの通常フロー** で OQ-8 が要求する「期限切れ時は必ず確認を挟む」という不変条件が崩れる。
`conventions` のチェック項目には「再送を複数回試みた場合に確認状態が保持されるか」という観測点が
そもそも無いため、この崩れを検出できていない。**要件と実装の字面が一致していることと、要件が意図した
不変条件が実行時に保たれることは別**であり、本件は後者が破れている。「規約観点での問題: なし」の結論は
本件を考慮すると成立しない。

### `security` への補足・拡張（concession + 追加指摘）

`security` の指摘（`queuedAt` はクライアント制御データで devtools から改ざん可能。ただし影響は
自分自身の重複起票に限られるため low）には同意する（concede）。妥当な切り分け。

その上で追加する: 私が指摘したバグは **devtools 改ざんという敵対的操作を一切必要としない**。
ネットワークが不安定な環境で「TTL 超過 → 手動再送 → たまたま `rate_limited`/`validation_failed` 等の
無関係な失敗で終わる → 再度手動再送」という **正規のユーザー操作の繰り返しだけ** で確認ダイアログが
恒久的に消え、その後のワンタップ再送で本物の重複 Issue が作られうる。severity の観点では、
`security` が low と評価した「改ざんが必要な自傷的重複」より、こちらの「改ざん不要・通常操作で発生する
安全策の消失」の方が実際の発生確率は高いと考える。両者は独立した欠陥であり、`security` の low 判定は
私の finding には適用されない（別カテゴリとして残すべき）。

### `simplicity` への同意（concession）

TTL 3 関数（`isOfflineQueueEntryExpired` / `expireStaleEntries` / `expireStaleOfflineQueue`）の層分けが
適切という評価には同意する。ただし層構造が綺麗であることと、`errorCode` を「TTL 超過という永続分類」と
「直近試行の一時的結果」の二重の意味で使い回している設計上の欠陥（round 1 finding 1）は独立の問題であり、
simplicity 観点の ✅ はこの correctness 上の欠陥を相殺しない。

### stop-pr-check.sh について

`security` / `simplicity` とも critical な欠陥は報告しておらず、私の round 1 の結論（見逃し方向の欠陥なし）
と整合する。異論なし。

### `security` — 反論
<sub>2026-07-25T16:53:08+09:00</sub>

## security round 2: rebuttal / concession

### `simplicity` の指摘 3（`stop-pr-check.sh` の `git fetch` + `git ls-remote` 重複・`gh api` リトライ積算）への concession

賛同する。セキュリティ観点でも副次的なメリットがある。現状は `git fetch origin main`（履歴取得）→ `git ls-remote origin 'refs/pull/*/head'`（refs 一覧）と、**リモート（GitHub）が返すデータをシェルに 2 回取り込んでいる**。round 1 で述べたとおり `head_sha` はローカル値なので injection 経路にはならないが、リモート応答をシェル変数に取り込む箇所は少ないほど監査コストが下がる。`simplicity` の提案どおり 1 回の `ls-remote` 系呼び出しに統合しても安全性は変わらない（round 1 の no-injection 結論は維持）が、**削減は「安全である」ことの検証範囲を狭める副次効果があるので late-round での取り込みに反対しない**。critical化するほどの理由ではないため、あくまで simplicity 側の改善提案を security 側からも後押しする形の concession。

### `conventions` の hook 整合性表（「gh usable 判定強化 → CLAUDE.md 記載なし → ✅ OK」）への rebuttal（部分的）

`conventions` は `.claude/bin/gh` シム探索を Stop フックへ追加した変更を「詳細実装・矛盾なし」と ✅ 判定しているが、これは **スコープ整合性の判定であって信頼境界の判定ではない** 点を明確化しておきたい。round 1 で指摘したとおり、この変更は「リポジトリ管理下の実行可能ファイルを PATH の先頭に注入し、無条件に `command -v gh` / `gh --version` 経由で実行する」経路を Stop フック（毎セッション終了時に自動起動）へ新たに拡張するもので、`session-start.sh` に既にある設計を複製したに過ぎない。**「矛盾なし」で済ませず、`.claude/bin/gh` が repo 信頼済み資産である前提を暗黙のままにしない**（今回はコメントに明記されているため許容している）。

結論は round 1 と同じで **critical 化しない**（新規の突破口ではなく既存前提の延長）。ただし `conventions` の表に「hook 変更が信頼境界を拡張していないか」という軸が欠けていた点は指摘しておく（今回はセーフだったが、次に hook を書き換えるときのレビュー観点として残すべき）。

### `correctness` の投稿

ラウンド1時点で `correctness` の投稿が見当たらないため、対応するクレームなし（round 3 以降で言及があれば応答する）。

### `simplicity` — 反論
<sub>2026-07-25T16:53:14+09:00</sub>

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

### `conventions` — 反論
<sub>2026-07-25T16:53:14+09:00</sub>

# Conventions の Round 2 応答（rebuttal / concession）

## simplicity への応答

### Stop hook のリモートコスト削減指摘への concession

**完全に同意。** 指摘内容は妥当です。

コスト削減の優先順位：

1. **L28 `git fetch` 削除の検討**: 指摘の通り、L28 の `git fetch` と L99-100 の `git ls-remote` が同じ目的（リモート確認）を異なるコマンドで実施している点は重複です。ただし、L31 の `git diff --quiet origin/main HEAD` が L28 の fetch 結果に依存しているため、削除前に「` git diff ` に必要な refs が ls-remote だけで十分か」の検証が必要。refs が無い場合、diff がローカル参照で古い状態を読む可能性があります。改善は「両方を ls-remote で置換した後に動作検証」という 2 段構えが安全です。

2. **クラウド環境での 403 リトライ簡略化**: 正論。L152-155 で既に「403 は決定的失敗（認証経路の問題）」と認識しているのに、その後も gh api を 2 回目試行する部分は冗長です。クラウド（CLAUDE_CODE_REMOTE=true）検出時に 403 を即 unknown 分岐へ誘導すれば 15 秒削減可能。

**記録**: セッション終了時 ~20 秒のレイテンシ削減は UX 改善になるため、本 PR マージ後のフォローアップ Issue として worth taking。

### 確認ステップの union 型最適化への concession

**同意。実装上の改善余地は認める。ただし現状で十分。**

- `confirmingDiscardId` と `confirmingResendId` は確かに単一 state に union 型 `{ type: "discard" | "resend-expired", id }` で統一できます。
- ただし現状コード（2 つの state 分離）の方が「どのアクションか」を読み手が一目で把握しやすく、テストカバレッジも state 分離で個別に書ける利点があります。
- 優先度は低く、削除判定で問題ありません。

---

## security への応答

### localStorage `queuedAt` 偽装指摘への concession + 補足

**指摘は正当。重複起票が本人限定である点の評価に同意。**

補足：

- 本人が `localStorage.queuedAt` を偽装して TTL を回避できる = クライアント制御データに business-logic 判定を委ねている問題（classical client-side security anti-pattern）。記録価値はあります。
- ただし本 PR の防衛設計は **複層構造** になっており、TTL 偽装によって「手動確認ステップの呼び出し」をスキップできても、**サーバー側の `client_request_id` 26 時間窓** がもう 1 層あるため、最終的には重複 Issue 作成自体を防ぎます（仮にクライアント側 TTL 偽装 → 自動再送 → サーバーが `client_request_id` で検出 → 201 ではなく 400 系エラー）。
- つまり、本人による意図的な重複起票の **スキップ** は可能（本人権限の濫用）ですが、**サーバー上での重複 Issue 実現**（スコープ外ユーザーへの拡大）は実装によって防がれています。
- critical 化しない判定に同意です。

---

## 規約観点からの追加確認（差分への CJK 半角スペース対応）

本ラウンドで **CJK 強調前後の半角スペース** を厳密に適用しました。Round 1 の投稿が CI で指摘されたため、本投稿では全て ` **強調** ` / ` `code` ` の形式で統一。

---

## 現在の評価サマリー

| レビュー観点 | 判定 | リスク |
|-----------|------|--------|
| 機能正当性（simplicity） | ✅ 適切。コスト削減の follow-up Issue は独立タスク | low（既知・改善提案） |
| セキュリティ（security） | ✅ critical なし。localStorage 偽装は本人限定 + サーバー防衛層あり | low（known limitation・記録推奨） |
| 規約・ドリフト（conventions） | ✅ スコープ・要件整合・i18n 完備 | none |

**議論残タスク**: simplicity の Stop hook コスト削減は worth taking ですが、本 PR の merge blocking にはしないレベル（follow-up Issue で十分）。

## ラウンド 3

### `lead` — 合意
<sub>2026-07-25T16:55:51+09:00</sub>

# 合意（lead 整理）

## 議論を経て残った真の欠陥（1 件・修正済み）

**`errorCode` に「TTL 超過という永続分類」と「直近の送信試行の結果」を混在させていた**（`correctness` round 1・round 2 で `conventions` の ✅ 判定を明確に反証）。

- `useOfflineQueueSync.resend()` は失敗時に `markOfflineQueueFailed(id, result.code)` で `errorCode` を無条件上書きする。`OfflineQueueList.requestResend()` が `errorCode === "queue_expired"` だけを見て確認ステップを出していたため、「期限切れ → 手動再送 → 429/422 等の無関係な失敗 → 次の再送はワンタップ」という **敵対的操作を伴わない通常フロー** で確認 UI が恒久的に消え、サーバー側の重複防止窓（26h）が切れた状態でのワンタップ再送が可能だった。
- `conventions` の「要件と実装の字面は一致」という確認は静的配置のみを見ており、複数回再送したときの状態保持という観測点を持っていなかった点を `correctness` が指摘。lead はこの反証を支持する。
- **対応**: `QueuedIssue.expired`（永続フラグ）を追加し、`expireStaleEntries` で立て、`requestResend` は `errorCode` ではなく `expired` を見る（旧データ互換のため `errorCode` も併せて判定）。E2E に「422 で失敗した後も再送に確認が挟まる」回帰ガードを追加。

## 相互検証で critical から落ちた指摘

| 指摘者 | 指摘 | 判定 |
|--------|------|------|
| `security` | `queuedAt` は localStorage 由来でユーザーが改変でき TTL 判定を回避できる | **informational**。影響は「自分の権限内で自分のリポジトリに重複起票する」自傷に限定。`security` 自身が critical 非該当と結論し `simplicity` も同意 |
| `security` | Stop フックが `.claude/bin/gh`（リポジトリ管理下の実行可能ファイル）を PATH 先頭に入れて実行する | **informational**。フック自体が repo 内スクリプトとして実行される既存前提の延長で、本差分が新規に開けた穴ではない（`security` 自身が critical 非該当と結論）。「hook 変更が信頼境界を拡張していないか」というレビュー軸の追加提案は妥当なので記録に残す |
| `simplicity` | `.claude/hooks/stop-pr-check.sh` の `git fetch origin main`（L28）は後段の `git ls-remote` と重複。`git ls-remote origin main` に置換して ~5 秒削減 | **却下（lead 反証）**。`git ls-remote` は `refs/remotes/origin/main` を **更新しない**。直後の早期 exit 判定は `git diff --quiet origin/main HEAD` で追跡ブランチの実体を参照するため、fetch を外すと古い `origin/main` と比較して「マージ済みなのに警告」「未マージなのにスキップ」の双方向の誤判定を招く。目的が異なる（fetch = 追跡ブランチ同期 / ls-remote = PR ref 一覧）ため重複ではない。`security` の concession もこの技術前提を検証せずに追認したもの |
| `simplicity` | `gh api` の 2 回リトライ × timeout 15 秒で最悪 30 秒。クラウドの 403 でも 2 回目を試行する | **却下（lead 反証）**。リトライループは `grep -qE 'HTTP 4[0-9][0-9]'` で 4xx を決定的失敗と判定して `break` しており 2 回目は走らない。加えて本 PR で追加した `gh_usable` ゲートにより、gh が使えない環境ではリトライループ到達前に `hook_block` する |
| `simplicity` | 破棄確認と再送確認の state を union 型に統一できる | **却下（実益小）**。`simplicity` 自身が「現状コードは読みやすく実益は小さい」と結論。YAGNI 側に倒す |
| `conventions` | スコープ・要件整合・i18n 日英ペア・CJK 規約はいずれも問題なし | 支持（ただし上記 critical を検出できていない点は `correctness` の反証どおり） |

## 残余リスク（設計として受容・記録）

`correctness` が指摘した「クライアント TTL（24h・端末のキュー投入時刻起点）とサーバー窓（26h・サーバー到達時刻起点）の起点差により、最悪ケースの猶予は約 2 時間しかない」「警告文言は経過時間によらず一定で緊急度を伝えない」は妥当な指摘。ただし経過時間に応じた文言生成は i18n の静的文言構成の変更を要し本 PR のスコープ外。TTL 超過後の最終防衛は「利用者が GitHub 側を確認する」人手判断であることを要件（OQ-8）とコードコメントに明記済みで、確認ステップの追加により少なくともワンタップでの事故は塞いだ。文言の高度化は需要が立った時点で別 Issue とする。

### `lead` — 判定
<sub>2026-07-25T16:55:51+09:00</sub>

{"verdict":"PASS","critical":[],"consensus":"議論で残った真の欠陥は 1 件（期限切れフラグを errorCode に混在させ、無関係な再送失敗で確認 UI が消える）で、永続フラグ expired の導入と回帰 E2E で本 PR 内に修正済み。他の指摘は相互検証で informational または技術的誤りとして critical から除外した。","summary":"correctness が状態遷移パスを追って発見した確認 UI の消失バグが唯一の実害欠陥。security の localStorage 信頼境界と gh シム実行は影響限定で informational。simplicity の git fetch 除去案と gh リトライ指摘は lead が技術的に反証（ls-remote は追跡ブランチを更新しない / 4xx で break 済み）。conventions はスコープ・要件整合・i18n を問題なしと確認。"}
