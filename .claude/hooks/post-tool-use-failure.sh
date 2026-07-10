#!/bin/bash
set -euo pipefail
# PostToolUseFailure hook: プロキシ環境での gh CLI エラー検知・通知
#
# Bash ツールが失敗した時に実行し、gh CLI のプロキシ起因エラーを検出する。
# エラーを検出したら hookSpecificOutput.additionalContext で Claude に修正方法を伝える。
#
# 公式仕様（https://code.claude.com/docs/en/hooks・E-D #19 で裏取り）:
#   - PostToolUseFailure はブロック不可。additionalContext はツール結果の隣に挿入され Claude が読む。
#   - systemMessage は「ユーザー向け」警告であり Claude には届かないため使わない（自己修正させたいので additionalContext を使う）。
#   - exit 0 + JSON stdout で additionalContext を返す。
#
# 対象エラーパターン:
#   - "could not resolve remote" — gh pr create でリモートが検出できない
#   - "none of the git remotes" — git remote がプロキシ経由で解決不可
#   - "no remotes configured" — リモート未設定と誤検出される場合

input=$(cat)

# Bash ツール以外はスキップ
tool_name=$(echo "$input" | jq -r '.tool_name // ""')
if [ "$tool_name" != "Bash" ]; then exit 0; fi

# コマンドとエラー出力を取得
command=$(echo "$input" | jq -r '.tool_input.command // ""')
error_output=$(echo "$input" | jq -r '.tool_response // ""')

# gh コマンドでなければスキップ
if ! echo "$command" | grep -qE '^\s*gh '; then exit 0; fi

# --- egress プロキシの 403 ブロック検出（L-114・2026-07-02 実測でブロック範囲拡大） ---
# クラウドでは gh のほぼ全操作（repo REST・GraphQL・search・Actions パス）が 403 になる。
# リトライ・-R 付与では解決しないため、即 MCP へ切り替えるよう案内する。
if echo "$error_output" | grep -qE 'GraphQL proxying is not enabled|connect the Claude GitHub App|sessions are bound to their configured repositories|Access to this GitHub Actions path is not permitted'; then
  jq -n --arg cmd "$command" '{
    "hookSpecificOutput": {
      "hookEventName": "PostToolUseFailure",
      "additionalContext": ("[proxy-error-detector] クラウドの egress プロキシが gh を 403 でブロックしました（L-114）。リトライ・-R 付与・urllib 直叩きでは解決しません。\nコマンド: " + $cmd + "\n\n→ 公式 GitHub MCP（mcp__github__*）へ即切替してください（代替表 SSOT: docs/rules/github-mcp-fallback-patterns.md §2）:\n  - Issue/PR 一覧・作成・マージ: list_issues / list_pull_requests / issue_write / create_pull_request / merge_pull_request\n  - ファイル取得: get_file_contents / 検索: search_issues / search_code / search_pull_requests\n  - CI・Actions: actions_list / actions_get / get_job_logs\n  - gh variable/secret はクラウド代替なし（env は Claude.ai 環境設定 / secrets-broker・同 §2.4）")
    }
  }'
  exit 0
fi

# プロキシ起因エラーパターンを検出
if ! echo "$error_output" | grep -qE 'could not resolve remote|none of the git remotes configured|no remotes configured for this repository|does not point to a known GitHub host'; then
  exit 0
fi

# リポジトリ slug を動的導出（bootstrap 未実行でも実リポジトリを案内できるように）
REPO_SLUG="${GITHUB_REPOSITORY:-}"
if [ -z "$REPO_SLUG" ]; then
  REPO_SLUG=$(git config --get remote.origin.url 2>/dev/null \
    | sed -E 's#(git@|https?://)[^/:]+[/:]##; s#\.git$##' 2>/dev/null || true)
fi
[ -z "$REPO_SLUG" ] && REPO_SLUG="kai-kou/github-issue-shortcut"

# gh pr create のエラー
if echo "$command" | grep -q 'gh pr create'; then
  jq -n --arg repo "$REPO_SLUG" '{
    "hookSpecificOutput": {
      "hookEventName": "PostToolUseFailure",
      "additionalContext": ("[proxy-error-detector] gh pr create がプロキシ環境エラーで失敗しました。\n\n原因: プロキシ環境では git remote からリポジトリを自動検出できません。\n\n修正方法: 以下のフラグを追加してください\n  --head {現在のブランチ名} --base main\n\n修正例:\n  gh pr create --head claude/BRANCH_NAME --base main -R " + $repo + " ...\n\n→ CLAUDE.md の「### gh CLI」と .claude/skills/project-manager/SKILL.md に --head/--base 必須ルールを追記してください（未記載の場合）。")
    }
  }'
  exit 0
fi

# その他の gh コマンドのエラー
jq -n --arg cmd "$command" --arg repo "$REPO_SLUG" '{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUseFailure",
    "additionalContext": ("[proxy-error-detector] gh CLI コマンドがプロキシ環境エラーで失敗しました。\nコマンド: " + $cmd + "\n\n修正チェックリスト:\n1. -R " + $repo + " が付与されているか\n2. gh pr create の場合 --head {ブランチ名} --base main が付与されているか\n3. gh api の場合 repos/" + $repo + "/... のフルパスを使っているか\n\n→ 同じエラーが繰り返される場合、CLAUDE.md の「### gh CLI」に制約を追記してください。")
  }
}'

exit 0
