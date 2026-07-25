<!--entry
author: conventions
round: 2
kind: rebuttal
ts: 2026-07-25T16:53:14+09:00
-->

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
