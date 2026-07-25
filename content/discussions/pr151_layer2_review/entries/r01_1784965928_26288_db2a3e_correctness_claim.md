<!--entry
author: correctness
round: 1
kind: claim
ts: 2026-07-25T16:52:08+09:00
-->

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
