---
description: 次にやるべきタスクを優先度順に自律判定して実行する（PR レビュー対応 → 進行中 Issue 再開 → waiting-claude Issue → プロジェクト固有バックログ）
---

# /next — 次にやるべきタスクを特定

優先度順に次のアクションを自律判定して実行するコマンドにゃ。

## 判断フロー

以下の順序でチェックし、最初に該当したものを実行する。

> 🔴 クラウドでは repo スコープの `gh` が 403 になる（L-114）ため、以下は GitHub MCP（`mcp__github__*`）を
> 一次経路とする。複数ラベル指定は OR・`issue_write` の `labels` は全置換・`perPage` 既定は 100 件までなど
> の gotcha は SSOT: `docs/rules/github-mcp-fallback-patterns.md`（§2.1〜2.3）を参照。

### 1. レビュー待ち PR のチェック（最優先）

```bash
python3 tools/check_pending_pr_reviews.py --actionable-only --json
```

- `ready_to_merge` → 即マージ
- `needs_response` → 指摘対応再開
- `needs_prompt` → 催促コメント投稿
- `awaiting_review` → subscribe_pr_activity で待機継続
- ⚠️ クラウドで `gh pr list` 自体が失敗した場合、本スクリプトは `NO_PENDING_PRS`（exit 0）を返さず
  **exit code 3** で終了する（Issue #130）。exit code が 3 の場合は「0 件」と解釈せず、
  `mcp__github__list_pull_requests(owner, repo, state="open")` + `mcp__github__pull_request_read`
  で直接オープン PR を確認する（詳細: `docs/rules/github-mcp-fallback-patterns.md` §4）。

### 2. 進行中 Issue の確認

```
mcp__github__list_issues(owner="{OWNER}", repo="{REPO}", state="OPEN", labels=["status:in-progress"])
```

- [wip] コミットがあれば前回の停止箇所を確認して再開
- Issue コメントの「次回再開ステップ」を参照（`mcp__github__issue_read(method="get_comments")`）

### 3. Claude 待ち Issue の実行

```
mcp__github__list_issues(owner="{OWNER}", repo="{REPO}", state="OPEN", labels=["status:waiting-claude"])
```

- `status:in-progress` ラベルを先付けしてから作業開始（CP-4）。`issue_write` の `labels` は全置換のため、
  現在のラベル一覧から `status:waiting-claude` を除き `status:in-progress` を加えたフルリストを渡す
- パイプライン系 Issue は対応するスキルの SKILL.md を Read してから実行

### 4. 何もない場合

- プロジェクト固有のバックログ（refinement・スケジュールタスク等）を確認する
- 該当がなければ no-op として理由を 1 行記録して終了する

## 出力フォーマット

```
## 次のアクション

**優先度1（PR レビュー対応）**: PR #N - {タイトル}
→ {具体的なアクション}

**優先度2（進行中 Issue 再開）**: Issue #N - {タイトル}
→ {停止箇所と次のステップ}
...
```
