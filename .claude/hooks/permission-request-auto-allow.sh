#!/bin/bash
set -euo pipefail
# PermissionRequest hook: .claude/ 配下のファイル操作を自動承認
#
# 背景: settings.json の Edit(.claude)/Write(.claude) ルールは相対パスマッチのみ。
# Claude Code がツールに絶対パスを渡した場合にマッチしないため、
# このフックで相対・絶対パス両方を確実にカバーする。
#
# ガードレール設計方針:
#   - .claude/ 配下の操作は自動承認（ハーネス定義のブラッシュアップを妨げない）
#   - PRレビュー・AIレビューをガードレールとして機能させる
#
# 出力スキーマ（公式仕様・E-D #19 で裏取り・https://code.claude.com/docs/en/hooks）:
#   PermissionRequest は hookSpecificOutput.decision.behavior（"allow" / "deny"）を使う。
#   PreToolUse の hookSpecificOutput.permissionDecision（"allow"/"deny"/"ask"/"defer"）とは別スキーマ。
#   本フックは PermissionRequest イベントに登録されているため decision.behavior が正しい。

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // ""')
file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""')

# 対象ツール: Read / Write / Edit のみ
case "$tool_name" in
  Read|Write|Edit|NotebookEdit) ;;
  *) exit 0 ;;
esac

# .claude/ を含むパスを自動承認（相対パス・絶対パス両方に対応）
# 例: .claude/settings.json, /home/user/project/.claude/hooks/foo.sh
if echo "$file_path" | grep -qE '(^|/)\.claude(/|$)'; then
  jq -n '{
    "hookSpecificOutput": {
      "hookEventName": "PermissionRequest",
      "decision": {
        "behavior": "allow"
      }
    }
  }'
fi

exit 0
