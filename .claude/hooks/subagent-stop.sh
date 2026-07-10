#!/usr/bin/env bash
# subagent-stop.sh — SubagentStop フック（P-11）
#
# サブエージェントが終了したとき、その状態をキャプチャして
# additionalContext で自己修正フィードバックをオーケストレータに注入する。
#
# 目的:
#   - エラー終了・非正常終了したサブエージェントの原因を可視化し、再試行・代替手段の選択を促す
#   - 正常終了（end_turn + is_error=false）の場合は何も出力せず即終了する（低ノイズ設計）
#
# 入力 (stdin JSON):
#   {
#     "stop_reason":  "end_turn" | "max_tokens" | "error" | ...,
#     "is_error":     boolean,
#     "result":       string,   // サブエージェントの最終テキスト出力
#     "usage":        {...}     // optional: token usage
#   }
#
# 出力 (stdout JSON):
#   { "additionalContext": "..." }   ← オーケストレータのコンテキストに注入される
#   空文字でもよい（フィードバック不要時）
#
# 注記:
#   /usage コマンドは headless(-p)モードでは動作しないため、本フックでは使用しない（P-11・#2672）。

set -euo pipefail

INPUT=$(cat 2>/dev/null || true)
if [[ -z "$INPUT" ]]; then
  exit 0
fi

# jq が使える環境では JSON をパース、なければ python3 で代替
# grep -oP は macOS 互換がないため使用しない（Gemini レビュー指摘・P-11）
if command -v jq &>/dev/null; then
  IS_ERROR=$(echo "$INPUT" | jq -r '.is_error // false')
  STOP_REASON=$(echo "$INPUT" | jq -r '.stop_reason // "unknown"')
  RESULT_TAIL=$(echo "$INPUT" | jq -r '.result // ""' | tail -c 500)
elif command -v python3 &>/dev/null; then
  IS_ERROR=$(echo "$INPUT" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(str(d.get('is_error', False)).lower())
" 2>/dev/null || echo "false")
  STOP_REASON=$(echo "$INPUT" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d.get('stop_reason', 'unknown'))
" 2>/dev/null || echo "unknown")
  RESULT_TAIL=$(echo "$INPUT" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d.get('result', '')[-500:])
" 2>/dev/null || echo "")
else
  # jq も python3 もない環境: フィードバックなしで終了
  exit 0
fi

# 正常終了（is_error=false かつ stop_reason=end_turn）は additionalContext 不要
if [[ "$IS_ERROR" == "false" && "$STOP_REASON" == "end_turn" ]]; then
  exit 0
fi

# エラー・非正常終了の場合のみフィードバックを生成
FEEDBACK=$(cat <<EOF
サブエージェントが正常に完了しませんでした（stop_reason: ${STOP_REASON}, is_error: ${IS_ERROR}）。

最終出力（末尾）:
${RESULT_TAIL}

推奨アクション:
$(if [[ "$STOP_REASON" == "max_tokens" ]]; then
  echo "- トークン上限超過: プロンプトを分割するか --max-tokens を増やしてください"
elif [[ "$IS_ERROR" == "true" ]]; then
  echo "- エラー終了: 上記の出力を確認し、根本原因を特定してください（L-077: problem-investigation-protocol.md を参照）"
else
  echo "- 想定外の停止理由です。サブエージェントの出力を確認してください"
fi)
EOF
)

# JSON 出力: jq or python3 で安全にシリアライズ（手動エスケープは改行崩れのリスクがある）
if command -v jq &>/dev/null; then
  printf '%s' "$FEEDBACK" | jq -Rs '{"additionalContext": .}'
else
  printf '%s' "$FEEDBACK" | python3 -c "
import json, sys
print(json.dumps({'additionalContext': sys.stdin.read()}))
"
fi
