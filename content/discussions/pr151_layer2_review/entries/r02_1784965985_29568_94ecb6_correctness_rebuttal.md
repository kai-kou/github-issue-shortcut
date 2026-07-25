<!--entry
author: correctness
round: 2
kind: rebuttal
ts: 2026-07-25T16:53:04+09:00
-->

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
