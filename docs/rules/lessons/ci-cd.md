# Warm 層 教訓 — CI / CD・フック

CI / CD・フック運用に関するカテゴリ別教訓（タスク依存で Read）。

---

## L-118: モック/機能 E2E が green ≠ 本番が動く（検証スコープの過大報告）（2026-07-14）

**パターン**: モック IdP + ローカルランタイム + テスト値注入 + マイグレーション済みローカル D1 に対する機能 E2E が green になったことを「本番で動作する（担保できた）」と報告した。実際は本番の設定・プロビジョニング（secret 妥当性・非 secret var の存在・remote D1 マイグレーション・実 IdP 連携）を一切検証しておらず、実機検証で本番が 3 連続 500 になった（`TOKEN_ENCRYPTION_KEY` 不正・`GITHUB_CLIENT_ID` 欠落・remote D1 未マイグレーション）。

**根本原因**: 機能テスト（コードロジックの検証）と、実環境に対する受け入れ/スモークテストを混同した。モック E2E は PR ゲート用に実 IdP・実インフラを **意図的に除外** する設計であり、「green」は「コードが正しく構成された環境で動く」以上を意味しない。NFR-15 の「実 E2E」の意図をモック E2E で代替し、観測していない本番動作を断定した（L-113 の姉妹）。

**対策**:
- **報告規律**: テストの green を報告するときは環境とモックを明示し、モックベースのテストを本番保証として報告しない。「E2E で担保」は **実環境での観測が伴うときだけ** 言う。
- **本番スモークテスト**: デプロイ後に本番エンドポイントの実経路を検証する（`tools/smoke_prod.sh`・`/api/health`・`/api/ready`・`/auth/login` 302+client_id）。`.github/workflows/smoke.yml` でスケジュール実行し本番デグレを早期検知する。
- **設定の自己診断**: `/api/ready` が鍵妥当性・必須 var・D1 テーブル存在を検査し、設定不良を汎用 500 でなく可視化する。
- **プロビジョニング自動化**: remote D1 マイグレーションをデプロイで自動適用（#55）。非 secret 設定は wrangler.jsonc に置きデプロイ消去を防ぐ（#54）。

**判定基準**: 「この green は、実際に本番（実環境）で観測したか？ モック/ローカルか？」モック/ローカルなら「本番動作」を主張しない。**保持理由**: 検証スコープの過大報告は L-113 と並ぶ信頼性破壊で、本番デグレを実ユーザーが先に踏む事態を招く（Warm・テスト/デプロイ文脈依存）。

---

## L-023: CI 失敗は自律修正する・フックを `--no-verify` で bypass しない（2026-06-13）

**パターン**: ① GitHub Actions / CI が失敗したとき、ログを読まずユーザーに「直してよいか」と確認に回す。
② コミットが Lv3 フック（pre-commit / pre-push）でブロックされた際、`git commit --no-verify` /
`git push --no-verify` でフックを **bypass** して回避する。

**根本原因**: CI 失敗・フックブロックを「ユーザー判断が必要な障害」と誤分類している（実際は
Claude が自律修正すべき作業）。フック bypass は品質ゲートの無効化であり、ハードコンストレイント
（Lv3）の意味を失わせる。

**対策**:
- CI 失敗時はログを読んで根本原因を特定し **自律修正** する（ユーザー確認不要・CP-1 / `core-principles-detail.md` 自律実行表）
- フックブロックは正規の手順で解消する。`--no-verify` での bypass は **禁止**

**禁止 → 推奨**:
```
❌ git commit --no-verify / git push --no-verify でフックを回避
❌ CI 失敗を理由にユーザー確認へ丸投げ
✅ フックの指摘を解消してから再コミット
✅ CI ログ → 根本原因特定 → 修正 → 再実行（自律）
```

---

## L-024: MCP 経由 PR 作成が PreToolUse ゲートを素通りする（2026-06-26）

**症状**: クラウドセッションで作成した PR で、Layer 0 機械ゲート（`self_review_check.py`）と
Layer 1 セルフレビュー（FAIR・全PR必須）が **発火せずスキップ** される。未コミット検出も働かない。

**根本原因**: `pre-pr-create-check.sh`（PR 作成前ゲート）は `PreToolUse` フックだが、
`.claude/settings.json` の matcher が `Bash` のみで、`mcp__github__create_pull_request` を
捕捉していなかった。クラウド環境では `gh pr create` が proxy の GraphQL 403 で失敗するため
PR 作成は **MCP ツールが主経路** になるが、その経路が matcher 外だったため Layer 0 ゲート・
未コミットチェック・Layer 1 リマインダーを **完全素通り** していた。`gh pr create` 前提のガードが
クラウドの実経路（MCP）とズレていた（L-094 型 desync）。

**対策（実装済み）**:
- `settings.json` の `PreToolUse` matcher に `mcp__github__create_pull_request` を追加
- `pre-tool-use-router.sh` が MCP PR 作成を `pre-pr-create-check.sh` へ委譲
- `pre-pr-create-check.sh` が Bash `gh pr create` と MCP PR 作成の両方でゲート（git-clean +
  `self_review_check.py` + Layer 1 リマインダー）を実行

**禁止 → 推奨**:
```
❌ PR 作成前ガードを Bash の gh pr create だけ前提にする（クラウドは MCP が主経路）
✅ PR 作成の全経路（Bash gh pr create / mcp__github__create_pull_request）を matcher・router で捕捉する
```

**判定基準**: 「クラウドで動く実経路（MCP）と、ローカル前提のガード（Bash）がズレていないか」を
新しいガードを足すたびに確認する。
