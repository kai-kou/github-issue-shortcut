#!/usr/bin/env python3
"""generate_project_context.py（汎用ベース）

プロジェクトの現状スナップショットを生成し content/context/project_state.md に保存する。
SessionStart フックがこの出力を stdout でセッションコンテキストに注入し、
セッション開始時の現状把握コスト（gh issue list 等の手動実行）を削減する。

収集内容（gh CLI 経由・GH_TOKEN 必須）:
  - status:in-progress の Issue
  - status:waiting-claude の Issue（上位 N 件）
  - status:waiting-user の Issue
  - オープン PR
  - 直近のコミット

リポジトリは環境変数 PROJECT_REPO（未設定時は kai-kou/github-issue-shortcut）で解決する。
"""
from __future__ import annotations
import json
import os
import subprocess
from datetime import datetime, timezone, timedelta

# 日時は JST 統一（datetime-rules.md）。日本は DST がないため固定オフセットで正確。
JST = timezone(timedelta(hours=9))
from pathlib import Path

REPO = os.environ.get("PROJECT_REPO", "kai-kou/github-issue-shortcut")
REPO_ROOT = Path(__file__).resolve().parent.parent
# 出力先は PROJECT_CONTEXT_OUT で上書き可能（既定の content/ は制作系の慣習のため）。
# 相対パスは CWD 依存で出力が迷子になるのを防ぐため REPO_ROOT 基準に正規化（+ ~ 展開）する。
def _anchored_out() -> Path:
    raw = os.environ.get("PROJECT_CONTEXT_OUT")
    if not raw:
        return REPO_ROOT / "content" / "context" / "project_state.md"
    p = Path(raw).expanduser()
    return p if p.is_absolute() else (REPO_ROOT / p)


OUT = _anchored_out()
WAITING_LIMIT = int(os.environ.get("PROJECT_CONTEXT_WAITING_LIMIT", "15"))


def gh_json(args: list[str], default):
    """gh を実行して JSON を返す。取得失敗（クラウド 403 等）は None を返し「0 件」と区別する。

    クラウドでは gh issue/pr list が egress プロキシに 403 でブロックされる（L-114・Issue #133）。
    失敗を default（空リスト）に縮退させるとスナップショットが「（なし）」と誤表示され、
    現状把握を静かに壊すため、None（取得失敗）をセンチネルとして呼び出し元へ伝える。
    """
    try:
        out = subprocess.run(
            ["gh", *args], capture_output=True, text=True, timeout=20
        )
        if out.returncode != 0:
            return None
        return json.loads(out.stdout or "null") or default
    except Exception:
        return None


def issues(label: str, limit: int):
    return gh_json(
        [
            "issue", "list", "-R", REPO, "--state", "open",
            "--label", label, "--limit", str(limit),
            "--json", "number,title,updatedAt",
        ],
        [],
    )


def open_prs():
    return gh_json(
        [
            "pr", "list", "-R", REPO, "--state", "open", "--limit", "30",
            "--json", "number,title,updatedAt,isDraft",
        ],
        [],
    )


FETCH_FAILED = (
    "⚠ 取得失敗（gh 403/エラー）。0 件と混同しないこと。"
    "クラウドでは `mcp__github__list_issues` / `list_pull_requests` で直接確認する（L-114）\n"
)


def recent_commits():
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "log", "--oneline", "-8"],
            capture_output=True, text=True, timeout=10,
        )
        return out.stdout.strip().splitlines() if out.returncode == 0 else []
    except Exception:
        return []


def fmt(items, empty="（なし）"):
    if items is None:
        return FETCH_FAILED
    if not items:
        return empty + "\n"
    lines = []
    for it in items:
        title = (it.get("title") or "")[:70]
        lines.append(f"- #{it.get('number')}: {title}")
    return "\n".join(lines) + "\n"


def main():
    now = datetime.now(JST).strftime("%Y-%m-%d %H:%M JST")
    in_progress = issues("status:in-progress", 20)
    waiting_claude = issues("status:waiting-claude", WAITING_LIMIT)
    waiting_user = issues("status:waiting-user", 20)
    prs = open_prs()
    commits = recent_commits()

    md = []
    md.append(f"# プロジェクト状態スナップショット（{now} 更新）\n")
    md.append("> SessionStart フックが自動注入。最新化は `python3 tools/generate_project_context.py`。\n")
    md.append("\n## 作業中 Issue（status:in-progress）\n")
    md.append(fmt(in_progress))
    md.append(f"\n## Claude 対応待ち Issue（status:waiting-claude・上位 {WAITING_LIMIT}）\n")
    md.append(fmt(waiting_claude))
    md.append("\n## ユーザー対応待ち Issue（status:waiting-user）\n")
    md.append(fmt(waiting_user))
    md.append("\n## オープン PR\n")
    if prs is None:
        md.append(FETCH_FAILED)
    elif prs:
        pr_lines = []
        for p in prs:
            draft = "（draft）" if p.get("isDraft") else ""
            pr_lines.append(f"- PR #{p.get('number')}: {(p.get('title') or '')[:70]} {draft}")
        md.append("\n".join(pr_lines) + "\n")
    else:
        md.append("（なし）\n")
    md.append("\n## 直近のコミット\n")
    md.append(("\n".join(f"- {c}" for c in commits) + "\n") if commits else "（なし）\n")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("".join(md), encoding="utf-8")
    print(f"[project-context] wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
