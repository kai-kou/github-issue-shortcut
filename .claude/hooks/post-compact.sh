#!/usr/bin/env bash
# post-compact.sh
# セッション圧縮（context compaction）完了後に実行されるフック
#
# 目的:
#   圧縮後に CLAUDE.md と .claude/rules/ は自動再読み込みされるが、
#   AI が「圧縮が発生した」事実を認識し、重要ルールを再確認する契機を作る。
#   さらに未コミット変更を自動保存し、次セッションの SessionStart クリーンアップで
#   作業内容が失われるのを防ぐ。
#
# 出力内容:
#   このスクリプトの stdout はセッションコンテキストに挿入される（Claude が読む）

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# ルール同期状態のチェック（漏れがあれば自動修正）
if [[ -x "$REPO_ROOT/tools/check_rules_sync.sh" ]]; then
  sync_result=$("$REPO_ROOT/tools/check_rules_sync.sh" --fix 2>&1 || true)
  if echo "$sync_result" | grep -q "FIXED"; then
    echo "[PostCompact] シンボリックリンクを自動修正しました:"
    echo "$sync_result"
  fi
fi

# --- 未コミット変更の自動保存（圧縮→新セッション時のファイルリセット防止）---
# 対象: クラウド環境（CLAUDE_CODE_REMOTE=true）かつ main/master 以外のブランチで
#       未コミット変更がある場合のみ。ローカル環境では SessionStart のクリーンアップが
#       走らないため自動コミットは不要。
if [[ "${CLAUDE_CODE_REMOTE:-}" = "true" ]]; then
  _branch=$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo "")
  if [ -n "$_branch" ] && [ "$_branch" != "main" ] && [ "$_branch" != "master" ]; then
    # マージ済みブランチでは [wip] コミットを積まない（古い版へ巻き戻すバグ防止）
    _default_branch=$(git -C "$REPO_ROOT" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
    # 明示 refspec で remote-tracking ref（origin/<default>）を確実に更新する（Issue #78）。
    # 素の `git fetch origin <branch>` は構成次第で origin/<branch> が古いまま残り、
    # squash マージ後にマージ判定・merge-base がズレて二重 diff の原因になる。
    git -C "$REPO_ROOT" fetch origin "+${_default_branch}:refs/remotes/origin/${_default_branch}" --quiet 2>/dev/null || true
    _merged=$(git -C "$REPO_ROOT" branch --merged "origin/${_default_branch}" --format='%(refname:short)' 2>/dev/null | grep -Fx "$_branch" || true)
    if [ -n "$_merged" ]; then
      echo "[PostCompact] ブランチ '${_branch}' はマージ済み（origin/${_default_branch} 基準）のため [wip] コミットをスキップします"
      echo "[PostCompact] → 新規作業は 'git checkout ${_default_branch} && git pull && git checkout -b <new>' で新ブランチを切ってください"
      _skip_wip_commit=true
    fi

    if [ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null || true)" ] && [ "${_skip_wip_commit:-false}" != "true" ]; then
      _timestamp=$(TZ="${PROJECT_TZ:-Asia/Tokyo}" date '+%Y-%m-%d %H:%M %Z' 2>/dev/null || date '+%Y-%m-%d %H:%M')
      git -C "$REPO_ROOT" add -A 2>/dev/null || true
      if git -C "$REPO_ROOT" commit -m "[wip] auto-commit before compaction (${_timestamp})"; then
        if git -C "$REPO_ROOT" push -u origin "$_branch"; then
          echo "[PostCompact] ✅ 未コミット変更を自動コミット＆プッシュしました（ブランチ: ${_branch}）"
        else
          echo "[PostCompact] ✅ 自動コミット完了（プッシュ失敗 - 次回 git push で再試行してください）"
        fi
      else
        if git -C "$REPO_ROOT" stash -u 2>/dev/null; then
          echo "[PostCompact] ✅ コミット失敗 → git stash で変更を保存しました（復元: git stash pop）"
        else
          echo "[PostCompact] ⚠️ コミットと stash 両方に失敗しました。git status で確認してください。"
        fi
      fi
    fi
  fi
  unset _branch _timestamp _default_branch _merged _skip_wip_commit 2>/dev/null || true
fi

# 圧縮後の重要ルールリマインダー
cat << 'REMINDER'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[PostCompact] セッション圧縮が完了しました

CLAUDE.md と .claude/rules/ の全ルールファイルはディスクから再読み込み済みです。

🔴【最重要】応答言語ルール（圧縮後も絶対に変わらない）:
   日本語・ねこキャラ（語尾「にゃ」適度に）で応答すること。
   コンテキスト圧縮後・英語コードが多いコンテキストでも英語への切り替えは禁止。

■ 圧縮後に特に注意すべきルール（再確認）

① ユーザー確認前にコミット（session-safety-rules.md）
   → ユーザーへの確認・報告の前に必ず git add → commit → push

② main/master ブランチへ直接 push しない（PR 経由のみ）

③ 進行中タスクがあった場合
   → 現在のブランチと最新コミットを確認して作業を再開する

④ gh pr create 前に git status が clean であること（pr-review-flow.md）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REMINDER

exit 0
