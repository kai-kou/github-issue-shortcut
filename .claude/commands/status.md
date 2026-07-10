---
description: プロジェクト現状（進行中/waiting Issue・オープンPR・レビュー待ち・直近コミット）を素早く把握して報告する
---

# /status — プロジェクト現状確認

プロジェクトの現在の状態を素早く把握するコマンドにゃ。

## 実行手順

> 🔴 クラウドでは repo スコープの `gh` が 403 になる（L-114）ため、以下は GitHub MCP（`mcp__github__*`）を
> 一次経路とする。`perPage` 既定は 100 件までなど詳細は SSOT: `docs/rules/github-mcp-fallback-patterns.md`
> （§2.1〜2.3）を参照。

以下を取得してまとめて報告する:

```
# 1. 進行中 Issue
mcp__github__list_issues(owner="{OWNER}", repo="{REPO}", state="OPEN", labels=["status:in-progress"])

# 2. Claude 待ち Issue
mcp__github__list_issues(owner="{OWNER}", repo="{REPO}", state="OPEN", labels=["status:waiting-claude"])

# 3. ユーザー待ち Issue
mcp__github__list_issues(owner="{OWNER}", repo="{REPO}", state="OPEN", labels=["status:waiting-user"])

# 4. オープン PR
mcp__github__list_pull_requests(owner="{OWNER}", repo="{REPO}", state="open")

# 5. レビュー待ち PR（actionable）
python3 tools/check_pending_pr_reviews.py --actionable-only --json
# ⚠️ exit code 3 は gh 取得失敗（0件ではない・Issue #130）。その場合は手順 4 の結果を使う。

# 6. 最新コミット（git 操作はクラウドでも生存する）
git log --oneline -5
```

## 出力フォーマット

```
## プロジェクト現状 (YYYY-MM-DD HH:MM JST)

### 制作パイプライン
| 動画 | フェーズ | ステータス |
...

### Issue 状態
- 🔴 in-progress: N件
- 🟡 waiting-claude: N件
- 🔵 waiting-user: N件

### PR 状態
- オープン: N件（レビュー待ち: N件）

### 直近コミット
...
```
