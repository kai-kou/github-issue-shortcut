#!/bin/bash
# Stop hook: PR作成フロー未実行チェック
# push済みブランチにPRがなければClaude に通知する
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/hook_block.sh
source "$HOOK_DIR/lib/hook_block.sh"

input=$(cat)

# 再帰防止
stop_hook_active=$(echo "$input" | jq -r '.stop_hook_active // "false"')
if [[ "$stop_hook_active" == "true" ]]; then exit 0; fi

# git リポジトリでなければスキップ
if ! git rev-parse --git-dir >/dev/null 2>&1; then exit 0; fi

current_branch=$(git branch --show-current)

# main / 空 はスキップ（slug 導出より前に判定し、main では slug 警告を出さない）
if [[ -z "$current_branch" ]] || [[ "$current_branch" == "main" ]]; then exit 0; fi

# 作業内容が既に origin/main へ取り込まれている（差分ゼロ）なら PR は完了済み、または PR にする
# 変更が無い。どちらの場合も「PR 未作成」警告は誤検知になるためスキップする（#133）。
# squash マージ直後は origin/main のツリーがブランチ先端と一致するため、この判定で拾える
# （マージコミットの祖先関係に依存しないので squash 運用でも機能する）。
timeout 10s git fetch --quiet origin main >/dev/null 2>&1 || true
if git rev-parse --verify --quiet origin/main >/dev/null 2>&1 && git diff --quiet origin/main HEAD 2>/dev/null; then
  exit 0
fi

# gh の解決。Stop フックは SessionStart が注入した PATH を継承しないことがあるため、リポジトリ同梱の
# gh シム（.claude/bin/gh）も明示的に探索する。さらにシムは実 gh バイナリを必要とし、無い環境では
# exit 127 になるため、`gh --version` で「実際に使えるか」まで確認する（#133）。
REPO_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
if [[ -x "$REPO_ROOT/.claude/bin/gh" ]] && ! command -v gh >/dev/null 2>&1; then
  PATH="$REPO_ROOT/.claude/bin:$PATH"
fi
gh_usable=false
if command -v gh >/dev/null 2>&1 && timeout 10s gh --version >/dev/null 2>&1; then
  gh_usable=true
fi

# リポジトリ slug（owner/repo）を動的に導出する。
# 雛形プレースホルダ kai-kou/github-issue-shortcut をハードコードすると、bootstrap で置換し忘れた
# プロジェクトで PR チェックが機能しない（実際に発生・L-103 再発の温床）。
# 優先順: GITHUB_REPOSITORY → gh repo view → origin URL パース。
REPO_SLUG="${GITHUB_REPOSITORY:-}"
# クラウドでは gh repo view が 403（GraphQL・L-114）のため試行せず origin URL パースへ進む
if [[ -z "$REPO_SLUG" ]] && [[ "${CLAUDE_CODE_REMOTE:-}" != "true" ]] && [[ "$gh_usable" == "true" ]]; then
  REPO_SLUG=$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo "")
fi
if [[ -z "$REPO_SLUG" ]]; then
  origin_url=$(git remote get-url origin 2>/dev/null || echo "")
  if [[ -n "$origin_url" ]]; then
    # http(s)://.../<owner>/<repo>(.git) / git@host:<owner>/<repo>(.git) の両形式に対応
    REPO_SLUG=$(printf '%s' "$origin_url" | sed -E 's#(\.git)?/?$##; s#.*[:/]([^/]+/[^/]+)$#\1#')
  fi
fi
# owner/repo 形式に解決できなければ、断定せず「判定不能」警告で明示停止する（不正 API パス
# repos//pulls を組み立てない・サイレント素通りも防ぐ）。
# owner にドットを含むものも弾く（GitHub の owner 名にドットは不可。`host/repo` の単一セグメント
# URL を `github.com/single` 等と誤パースした場合を検知する）。
if [[ -z "$REPO_SLUG" || "$REPO_SLUG" != */* || "${REPO_SLUG%%/*}" == *.* ]]; then
  hook_block "⚠️ PR確認できません: リポジトリ名（owner/repo）を自動検出できませんでした（GITHUB_REPOSITORY 未設定・gh 未導入・origin 不正のいずれか）。\`gh pr list --head ${current_branch} --state all\` を手動実行して PR が作成されているか確認してください。"
fi
REPO_OWNER="${REPO_SLUG%%/*}"

# 検証手段の案内文を環境で切り替える。クラウド（CLAUDE_CODE_REMOTE=true）では gh の repo スコープ
# 操作が egress プロキシに 403 でブロックされるため、`gh pr list` を案内しても機能しない（L-114）。
# 公式 MCP（mcp__github__list_pull_requests）を案内する。
if [[ "${CLAUDE_CODE_REMOTE:-}" == "true" ]]; then
  VERIFY_HINT="mcp__github__list_pull_requests(owner=\"${REPO_OWNER}\", repo=\"${REPO_SLUG#*/}\", head=\"${REPO_OWNER}:${current_branch}\", state=\"all\") で PR を確認してください（クラウドでは gh の repo 操作が 403 でブロックされます・L-114）"
else
  VERIFY_HINT="\`gh pr list --head ${current_branch} --state all -R ${REPO_SLUG}\` を手動実行して PR が作成されているか確認してください"
fi

# リモートブランチの存在確認
# branch_check_status: "exists" | "not_found" | "unknown"
# "unknown" = timeout/認証/ネットワーク等で判定不能 → PR チェックに進む（サイレントスキップしない）
branch_check_status="unknown"

git_ls_exit=0
timeout 10s git ls-remote --exit-code --heads origin -- "$current_branch" >/dev/null 2>&1 \
  || git_ls_exit=$?

if [[ $git_ls_exit -eq 0 ]]; then
  branch_check_status="exists"
elif [[ $git_ls_exit -eq 2 ]]; then
  # --exit-code: exit 2 = マッチする ref なし = ブランチが存在しない（ネットワークは正常）
  branch_check_status="not_found"
else
  # 判定不能（timeout/認証/ネットワーク等） → gh api フォールバック
  # ブランチ名に / を含む場合のためURL エンコードを適用
  # クラウドでも repo スコープ REST は 2026-07-14 実測で許可（プロキシ挙動変化・Issue #254）。
  # 403 に回帰した場合は空が返り unknown のまま PR チェックへ進む（安全側）。
  if [[ "$gh_usable" == "true" ]]; then
    branch_api_result=$(timeout 10s gh api \
      "repos/${REPO_SLUG}/branches/$(printf -- '%s' "$current_branch" | jq -Rr @uri)" \
      --jq '.name' 2>/dev/null || echo "")
    if [[ "$branch_api_result" == "$current_branch" ]]; then
      branch_check_status="exists"
    fi
  fi
  # gh 未導入・gh api が空を返した場合（404/timeout/認証エラー）→ unknown のまま
  # PR チェック側に判断を委ねる
fi

# ブランチが存在しないことが確定した場合のみスキップ
# unknown（両方失敗）はサイレントスキップせず PR チェックに進む（L-050 対策）
if [[ "$branch_check_status" == "not_found" ]]; then exit 0; fi

# PR存在チェック: gh api で確認（timeout付き・リトライ付き）
# --method GET を明示指定（-f フラグ使用時のデフォルト POST を回避）
# state=all + jq フィルタ: open PR と merged PR のみカウント（closed/abandoned PR は除外）

# gh が使えない環境（未導入、または gh シムのみで実 gh バイナリが無い）では gh を案内しても
# 機能しないため、クラウドの一次経路（MCP）での確認へ誘導する（#133・L-114）。
if [[ "$gh_usable" != "true" ]]; then
  hook_block "⚠️ PR確認できません: この環境では gh CLI が利用できません（未導入、または gh シムのみで実 gh バイナリが無い）。${VERIFY_HINT}。作成されていない場合は pr-review-flow.md に従い PR を作成してください（GitHub UI: https://github.com/${REPO_SLUG}/pulls）。"
fi

total="unknown"
# repo スコープ REST はクラウドでも 2026-07-14 実測で許可（プロキシ挙動変化・Issue #254）。
# クラウド・ローカルとも gh api で実確認する。403 に回帰した場合は結果が空になり
# unknown 分岐（MCP 検証への誘導）へ落ちる（サイレント素通りしない・従来の安全側維持）。
for attempt in 1 2; do
  gh_err=$(mktemp)
  result=$(timeout 15s gh api --method GET "repos/${REPO_SLUG}/pulls" \
    -f head="${REPO_OWNER}:${current_branch}" -f state=all -f per_page=100 \
    --jq '[.[] | select(.state == "open" or .merged_at != null)] | length' 2>"$gh_err" || echo "")
  if [[ "$result" =~ ^[0-9]+$ ]]; then
    rm -f "$gh_err"
    total="$result"
    break
  fi
  # 4xx（プロキシ 403 回帰・権限不足等）は決定的失敗なのでリトライしない（即 unknown 分岐へ）
  if grep -qE 'HTTP 4[0-9][0-9]' "$gh_err" 2>/dev/null; then
    rm -f "$gh_err"
    break
  fi
  rm -f "$gh_err"
  [[ $attempt -lt 2 ]] && sleep 2
done

if [[ "$total" == "0" ]]; then
  if [[ "$branch_check_status" == "exists" ]]; then
    # ブランチの存在が確定している場合のみ "push済み" と断定する
    hook_block "⚠️ PR未作成警告: ブランチ ${current_branch} はリモートにpush済みですが、PRがまだ作成されていません。pr-review-flow.md に従い、セルフレビュー → PR作成 → AIレビュー依頼 → レビュー監視を実行してください。

【根本原因対策 L-050】PR作成を報告する前に必ずPR URLを確認してください。"
  else
    # branch_check_status == "unknown": ブランチpush状態が確認できないため断定を避ける
    hook_block "⚠️ PR確認できません: ブランチ ${current_branch} のブランチ存在確認でエラー（timeout/認証/ネットワーク等）が発生したため、PR未作成かどうか断定できません。${VERIFY_HINT}。作成されていない場合はpr-review-flow.mdに従いPRを作成してください。"
  fi
elif [[ "$total" == "unknown" ]]; then
  # 判定不能時（timeout/認証/レート制限/ネットワーク等）はサイレントスキップせず警告を出す（L-050 対策）
  # クラウドでは gh の repo 操作が常に 403 になるため、ここは MCP 検証（VERIFY_HINT）へ誘導する（L-114）
  hook_block "⚠️ PR確認できません: ブランチ ${current_branch} のPR存在確認でエラー（クラウドでは gh の repo 操作が 403／ローカルでは timeout/認証/レート制限等）が発生しました。${VERIFY_HINT}。作成されていない場合はpr-review-flow.mdに従いPRを作成してください。"
fi

exit 0
