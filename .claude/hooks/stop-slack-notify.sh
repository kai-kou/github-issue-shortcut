#!/bin/bash
# Stop hook: WIP自動コミット + Slackセッション終了通知
# セッション終了時に未コミット変更を自動保存し、Slackに通知する
set -euo pipefail

input=$(cat)

# 再帰防止（jq 失敗時は "false" にフォールバック）
stop_hook_active=$(echo "$input" | jq -r '.stop_hook_active // "false"' 2>/dev/null || echo "false")
if [[ "$stop_hook_active" == "true" ]]; then exit 0; fi

# git リポジトリでなければスキップ
if ! git rev-parse --git-dir >/dev/null 2>&1; then exit 0; fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# ── 日次コスト集計（#1213・#95・#106）──────────────────────────────────
# 月次レポート（content/analytics/cost_monthly/YYYY-MM.json）は git 追跡対象だが、
# 高頻度で自動更新されるテレメトリを feature ブランチの WIP 自動コミットに相乗りさせると、
# 全 feature PR に churn が混入し、レビューセッションが「無関係 churn」と判定して破棄する
# 不健全なループに陥る（根本原因・#106）。そのため永続化経路を分離する:
#   - 本フックでは cost_log.jsonl への追記と月次 JSON のローカル更新（flush）のみ行う。
#   - 月次 JSON は下記 WIP 自動コミットの git add から「除外」する（feature PR を汚さない）。
#   - main への永続化は commit_cost_telemetry.py が「1 日 1 回の専用 PR」で行う（後述ブロック）。
#
# 2 ステップ呼び出し:
#   1. --summary-only: 当セッションのコストを cost_log.jsonl に O_APPEND 追記
#   2. --flush --rotate: 追記済み cost_log.jsonl から月次 JSON を生成・古い行を削除
# ※ --summary-only を --flush に置換すると early return でセッションデータが欠落するため禁止。
_calc_script="${REPO_ROOT}/tools/calc_daily_cost.py"
if [[ -f "$_calc_script" ]] && command -v python3 &>/dev/null; then
  timeout 15s python3 "$_calc_script" --summary-only <<< "$input" >/dev/null 2>&1 || true
  timeout 15s python3 "$_calc_script" --flush --rotate >/dev/null 2>&1 || true
fi
unset _calc_script

# ── 月次コスト集計の永続化（feature ブランチから分離・1 日 1 回の専用 PR・#106）──
# 作業中のチェックアウトに触れず、origin/main ベースの使い捨て worktree で cost_monthly
# のみを専用ブランチ → PR → squash マージする。--gate-daily で JST 当日 1 回に収束する
# （外部スケジューラ非依存。実データ差分が無ければ no-op で PR を作らない）。
# 上の flush 直後・WIP コミットの前に置き、最新の月次 JSON をローカルから読ませる。
_tele_script="${REPO_ROOT}/tools/commit_cost_telemetry.py"
if [[ "${CLAUDE_CODE_REMOTE:-}" = "true" ]] && [[ -f "$_tele_script" ]] && command -v python3 &>/dev/null; then
  timeout 90s python3 "$_tele_script" --gate-daily >/dev/null 2>&1 || true
fi
unset _tele_script

# ──────────────────────────────────────────
# 未コミット変更の自動保存（セッション終了時のファイルリセット防止）
# 問題: セッション終了後に新セッションが起動すると SessionStart フックが
#       git reset/checkout/clean を実行し未コミット変更が全て消える。
#       停止直前に自動コミット&プッシュすることで作業内容を保護する。
# 対象: クラウド環境（CLAUDE_CODE_REMOTE=true）かつ main/master 以外のブランチのみ
# ──────────────────────────────────────────
if [[ "${CLAUDE_CODE_REMOTE:-}" = "true" ]]; then
  _branch=$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo "")
  if [ -n "$_branch" ] && [ "$_branch" != "main" ] && [ "$_branch" != "master" ]; then
    if [ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null || true)" ]; then
      _timestamp=$(TZ='Asia/Tokyo' date '+%Y-%m-%d %H:%M' 2>/dev/null || date '+%Y-%m-%d %H:%M')
      # 月次コストテレメトリ（cost_monthly）は feature ブランチに混入させない（#106）。
      # 専用 PR（commit_cost_telemetry.py）が main へ永続化するため、ここでは除外する。
      git -C "$REPO_ROOT" add -A -- . ':(exclude)content/analytics/cost_monthly/' 2>/dev/null || true
      # cost_monthly 以外に変更が無ければ何もコミットしない（空コミットを避ける）
      if ! git -C "$REPO_ROOT" diff --cached --quiet 2>/dev/null && \
         git -C "$REPO_ROOT" commit -m "[wip] セッション終了前自動コミット（${_timestamp}）"; then
        # push 失敗時はリトライ（指数バックオフ: 2s, 4s, 8s）
        _pushed=false
        for _wait in 0 2 4 8; do
          [ "$_wait" -gt 0 ] && sleep "$_wait"
          if git -C "$REPO_ROOT" push -u origin "$_branch" 2>/dev/null; then
            _pushed=true
            break
          fi
        done
        if [ "$_pushed" = false ]; then
          echo "Warning: Stop-hook push failed after retries. Commit is local-only." >&2
        fi
        unset _pushed _wait
      fi
    fi
  fi
  unset _branch _timestamp
fi

# ──────────────────────────────────────────
# Slack 通知（session-stop）は廃止した（Issue #2597）
# ──────────────────────────────────────────
# セッション単位の開始/終了通知が通知氾濫の主因（約64通/日・全体の75〜85%）だったため、
# 「半日アウトカムサマリー」（tools/half_day_summary.py・07:00/19:00 発火）に集約した。
# 本フックに残る役割は「WIP 自動コミット」と「cost_log.jsonl へのコスト追記」のみ。
# （cost_log.jsonl は half_day_summary.py の稼働集計データソースになる）
exit 0
