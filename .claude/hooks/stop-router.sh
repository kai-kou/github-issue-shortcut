#!/bin/bash
# Stop ルーター: セッション終了時の3つのフックを1つに統合
# トークン最適化: 3つの Stop フック → 1つに統合（CC-BUG-16 対策）
#
# 各チェックスクリプトを順に実行する。
# 1つが exit 2（ブロック）を返した場合でも、残りは実行する（終了処理は全て完了させる）。
#
# 【L-050 修正】複数サブスクリプトが systemMessage JSON を個別に stdout 出力すると
# Claude Code が最初の1つしか解析しないリスクがある。
# → 各サブスクリプトの stdout を一時ファイルで収集し、最後に1つの JSON として出力する。

# stdin を保存して各サブスクリプトに渡す
INPUT=$(cat 2>/dev/null || true)

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
FINAL_EXIT=0

# 一時ファイルでメッセージを収集（改行を保持するため変数ではなくファイルを使用）
MSG_FILE=$(mktemp /tmp/stop-router-msgs-XXXXXX)
trap 'rm -f "$MSG_FILE"' EXIT

# サブスクリプトを実行し、systemMessage を MSG_FILE に追記する関数
run_hook() {
  local script="$1"
  local out exit_code

  # stdout をキャプチャしつつ exit code を取得（set -e 未使用のため $? は確実にサブスクリプトの終了コード）
  out=$(printf '%s\n' "$INPUT" | "$HOOK_DIR/$script" 2>/dev/null)
  exit_code=$?

  if [ "$exit_code" -eq 2 ]; then
    FINAL_EXIT=2
    # systemMessage を抽出して追記（jq で確実に文字列だけ取り出す）
    local msg
    msg=$(printf '%s' "$out" | jq -r '.systemMessage // empty' 2>/dev/null || true)
    # 既存メッセージがあれば区切り線を挿入
    if [[ -s "$MSG_FILE" ]]; then
      printf '\n\n---\n\n' >> "$MSG_FILE"
    fi
    if [[ -n "$msg" ]]; then
      printf -- '%s' "$msg" >> "$MSG_FILE"
    elif [[ -n "$out" ]]; then
      # jq 抽出失敗（JSON 形式でない等）: raw stdout を追記して警告が黙殺されないようにする
      printf -- '%s' "$out" >> "$MSG_FILE"
    else
      # stdout も空の場合: フォールバック文言を追記
      printf -- '%s が systemMessage を出力しませんでした（exit 2）' "$script" >> "$MSG_FILE"
    fi
  elif [ "$exit_code" -ne 0 ]; then
    # クラッシュ系（exit 1/127 等）も可視化してサイレントスキップを防ぐ（L-050 対策）
    FINAL_EXIT=2
    if [[ -s "$MSG_FILE" ]]; then
      printf '\n\n---\n\n' >> "$MSG_FILE"
    fi
    printf -- '%s が exit %s で失敗しました' "$script" "$exit_code" >> "$MSG_FILE"
  fi
}

# 1. Git 未コミットチェック
run_hook "stop-git-check.sh"

# 2. PR 存在チェック
run_hook "stop-pr-check.sh"

# 3. Slack 通知 + WIP 自動コミット
run_hook "stop-slack-notify.sh"

# 4. 完了報告フォーマットチェック（ご依頼再掲→アウトカム中心・completion-report-rules.md）
run_hook "stop-completion-report-check.sh"

# 収集したメッセージを1つの JSON として出力（L-050: 複数 JSON 問題を修正）
# jq -Rs（-n なし）: stdin を読み込むために -n を省略する（-n は stdin を無視するため）
# フォールバック: jq -Rs が失敗した場合、-n --arg で変数経由で渡す
if [[ -s "$MSG_FILE" ]]; then
  jq -Rs '{"systemMessage": .}' < "$MSG_FILE" 2>/dev/null \
    || jq -n --arg m "$(cat "$MSG_FILE")" '{"systemMessage": $m}'
fi

exit $FINAL_EXIT
