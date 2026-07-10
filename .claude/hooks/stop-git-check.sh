#!/bin/bash
set -euo pipefail

# Stop hook: 未コミット・未push チェック + 残留ファイル判別
#
# 前セッションの残留ファイル（既に origin/main にマージ済みの変更）を検出し、
# 「コミットしてください」ではなく「クリーンアップしてください」と案内する。
# これにより、main と重複するコミットの誤生成を防止する。

input=$(cat)

# Check if stop hook is already active (recursion prevention)
stop_hook_active=$(echo "$input" | jq -r '.stop_hook_active')
if [[ "$stop_hook_active" = "true" ]]; then
  exit 0
fi

# Check if we're in a git repository - bail if not
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

# --- 未追跡ファイルを事前取得（関数とメインチェックの両方で再利用） ---
_untracked_files=$(git ls-files --others --exclude-standard 2>/dev/null)

# --- 残留ファイル判別関数 ---
# ワーキングディレクトリの変更が origin/main に既に存在するかチェックする。
# 戻り値: 0 = 全て残留ファイル（mainと同一）, 1 = 新規変更あり
check_residual_files() {
  # origin/main が存在しなければ判別不可
  if ! git rev-parse origin/main >/dev/null 2>&1; then
    return 1
  fi

  local has_new_changes=false

  # 変更されたファイル（追跡済み）: mainとの差分で判別
  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    # ワーキングツリー + インデックス の両方を origin/main と比較
    # --quiet の終了コードで判定（grep パースより堅牢）
    if ! git diff --quiet origin/main -- . 2>/dev/null || ! git diff --cached --quiet origin/main -- . 2>/dev/null; then
      has_new_changes=true
    fi
  fi

  # 未追跡ファイル: main に同一内容で存在するかチェック
  if [[ -n "$_untracked_files" ]]; then
    while IFS= read -r file; do
      # main にこのファイルが存在するか
      if ! git cat-file -e "origin/main:$file" 2>/dev/null; then
        # main に存在しない = 新規ファイル
        has_new_changes=true
        break
      fi
      # main に存在する場合、内容が同一か比較
      local main_hash working_hash
      main_hash=$(git rev-parse "origin/main:$file" 2>/dev/null || echo "")
      working_hash=$(git hash-object "$file" 2>/dev/null || echo "none")
      if [[ "$main_hash" != "$working_hash" ]]; then
        has_new_changes=true
        break
      fi
    done <<< "$_untracked_files"
  fi

  if [[ "$has_new_changes" = true ]]; then
    return 1
  fi
  return 0
}

# --- メインチェック ---

# Check for uncommitted changes (both staged and unstaged)
has_uncommitted=false
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  has_uncommitted=true
fi

# Check for untracked files that might be important
has_untracked=false
if [[ -n "$_untracked_files" ]]; then
  has_untracked=true
fi

# 未コミット変更 or 未追跡ファイルがある場合
if [[ "$has_uncommitted" = true ]] || [[ "$has_untracked" = true ]]; then
  if check_residual_files; then
    # 残留ファイル: mainと同一内容なのでクリーンアップを案内
    jq -n '{"systemMessage": "ワーキングディレクトリに前セッションの残留ファイルがあります（origin/main と同一内容のためコミット不要）。以下のコマンドでクリーンアップしてください:\n\n  git reset\n  GIT_LFS_SKIP_SMUDGE=1 git checkout -- .\n  git clean -fd\n\n注意: これらのファイルは既に main にマージ済みです。コミットすると重複コミットになります。また、ステージ済みの変更も含めて元に戻すために git reset を実行しています。"}'
    exit 2
  else
    # 新規変更: has_uncommitted / has_untracked に応じて案内を分岐
    if [[ "$has_uncommitted" = true ]] && [[ "$has_untracked" = true ]]; then
      jq -n '{"systemMessage": "There are uncommitted changes and untracked files in the repository. Please commit and push the tracked changes, and either add, commit, remove, or ignore the untracked files as appropriate."}'
    elif [[ "$has_uncommitted" = true ]]; then
      jq -n '{"systemMessage": "There are uncommitted changes in the repository. Please commit and push these changes to the remote branch."}'
    else
      # has_untracked のみ true
      jq -n '{"systemMessage": "There are untracked files in the working directory. If these files should be version-controlled, add, commit, and push them. Otherwise, remove them or add them to .gitignore."}'
    fi
    exit 2
  fi
fi

# Check for unpushed commits
current_branch=$(git branch --show-current)
if [[ -n "$current_branch" ]]; then
  if git rev-parse "origin/$current_branch" >/dev/null 2>&1; then
    # Branch exists on remote - compare against it
    unpushed=$(git rev-list "origin/$current_branch..HEAD" --count 2>/dev/null) || unpushed=0
    if [[ "$unpushed" -gt 0 ]]; then
      jq -n --arg n "$unpushed" --arg b "$current_branch" \
        '{"systemMessage": "There are \($n) unpushed commit(s) on branch \($b). Please push these changes to the remote repository."}'
      exit 2
    fi
  else
    # Branch doesn't exist on remote - compare against default branch
    unpushed=$(git rev-list "origin/HEAD..HEAD" --count 2>/dev/null) || unpushed=0
    if [[ "$unpushed" -gt 0 ]]; then
      jq -n --arg n "$unpushed" --arg b "$current_branch" \
        '{"systemMessage": "Branch \($b) has \($n) unpushed commit(s) and no remote branch. Please push these changes to the remote repository."}'
      exit 2
    fi
  fi
fi

exit 0
