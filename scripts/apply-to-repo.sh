#!/usr/bin/env bash
# apply-to-repo.sh — kai-kou/claude-code-base のルール・スキル定義・ハーネスを
# 「任意の既存リポジトリ」へワンコマンドで適用（または最新へ同期）する。
#
# これまで他リポジトリで毎回手動指示していた
#   「gh で kai-kou/claude-code-base を参照し、ルール・スキル・ハーネスを全部適用して」
# を 1 コマンドに置き換えるためのスクリプト。
#
# 使い方（対象リポジトリのルートで実行）:
#   # A. リモートから直接（最も手軽。git だけで動く）
#   curl -fsSL https://raw.githubusercontent.com/kai-kou/claude-code-base/main/scripts/apply-to-repo.sh | bash
#
#   # B. ローカルに置いて実行（オプション付き）
#   bash scripts/apply-to-repo.sh [options]
#
# 主なオプション:
#   --base owner/repo       ベースリポジトリ（既定: kai-kou/claude-code-base）
#   --ref  <branch|tag|sha> 取得する ref（既定: main）
#   --repo owner/repo       対象リポジトリ slug（既定: git remote origin から自動判定）
#   --name "Project Name"   プロジェクト名（プレースホルダ置換用・既定: リポジトリ名）
#   --desc "説明"           プロジェクト説明（既定: プロジェクト名）
#   --tz   Asia/Tokyo       タイムゾーン
#   --prune                 modules.yaml で enabled:false のモジュール資産を除去
#   --overwrite-project     CLAUDE.md / docs/project-mission.md も上書きする（既定: 既存があれば保護）
#   --keep-settings         .claude/settings.json を上書きしない（既定: バックアップしてから導入）
#   --dry-run               実際にはコピーせず、適用対象を表示するだけ
#   -h | --help             ヘルプ表示
#
# 設計方針:
#   - 既存リポジトリのプロジェクト固有ファイル（CLAUDE.md / docs/project-mission.md）は
#     既定では上書きしない（look before overwrite）。--overwrite-project で明示的に上書き可能。
#   - .claude/settings.json はハーネス本体のため導入するが、既存があれば .bak に退避する。
#   - 何度でも再実行でき、最新のルール・スキル・ハーネスへ同期できる（idempotent）。
set -euo pipefail

BASE_REPO="kai-kou/claude-code-base"
REF="main"
TARGET_SLUG=""
PROJECT_NAME=""
PROJECT_DESC=""
PROJECT_TZ=""
PRUNE=false
OVERWRITE_PROJECT=false
KEEP_SETTINGS=false
DRY_RUN=false
TARGET="$(pwd)"

log() { echo "[apply] $*"; }
die() { echo "[apply][ERROR] $*" >&2; exit 1; }

# 値を取る引数で値が省略された場合（set -u 下で $2 未定義クラッシュ）を防ぐ
need_arg() { [ "$1" -ge 2 ] || die "$2 には引数が必要です"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --base) need_arg "$#" "--base"; BASE_REPO="$2"; shift 2;;
    --ref)  need_arg "$#" "--ref";  REF="$2"; shift 2;;
    --repo) need_arg "$#" "--repo"; TARGET_SLUG="$2"; shift 2;;
    --name) need_arg "$#" "--name"; PROJECT_NAME="$2"; shift 2;;
    --desc) need_arg "$#" "--desc"; PROJECT_DESC="$2"; shift 2;;
    --tz)   need_arg "$#" "--tz";   PROJECT_TZ="$2"; shift 2;;
    --prune) PRUNE=true; shift;;
    --overwrite-project) OVERWRITE_PROJECT=true; shift;;
    --keep-settings) KEEP_SETTINGS=true; shift;;
    --dry-run) DRY_RUN=true; shift;;
    -h|--help)
      sed -n '2,40p' "$0" 2>/dev/null || echo "apply-to-repo.sh: see header for usage"
      exit 0;;
    *) echo "Unknown arg: $1" >&2; exit 1;;
  esac
done

# --- 0. 対象リポジトリの検証 ---
# git は必須（clone・slug 判定・symlink 同期で多用する）
if ! command -v git >/dev/null 2>&1; then
  die "git がインストールされていません。本スクリプトの実行には git が必須です"
fi
# worktree / submodule では .git がファイルのため、rev-parse で堅牢に判定する
if ! git -C "$TARGET" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  die "カレントディレクトリは git リポジトリではありません: $TARGET"
fi
# リポジトリのルートで実行することを強制する（サブディレクトリ実行を防ぐ）
if [ -n "$(git -C "$TARGET" rev-parse --show-cdup 2>/dev/null)" ]; then
  die "対象リポジトリのルートディレクトリで実行してください: $TARGET"
fi

# --- 1. 対象リポジトリ slug の自動判定 ---
if [ -z "$TARGET_SLUG" ]; then
  remote_url="$(git -C "$TARGET" remote get-url origin 2>/dev/null || true)"
  if [ -n "$remote_url" ]; then
    # https / ssh / プロキシ形式すべてから末尾の owner/repo を抽出（.git 除去）
    TARGET_SLUG="$(printf '%s' "$remote_url" \
      | sed -E 's#\.git$##' \
      | sed -E 's#^.*[/:]([^/]+/[^/]+)$#\1#')"
  fi
fi
[ -n "$TARGET_SLUG" ] || die "対象リポジトリの slug を判定できません。--repo owner/repo を指定してください"
TARGET_NAME="${TARGET_SLUG##*/}"
PROJECT_NAME="${PROJECT_NAME:-$TARGET_NAME}"

log "ベース   : $BASE_REPO@$REF"
log "対象     : $TARGET_SLUG ($TARGET)"
log "name     : $PROJECT_NAME"
$DRY_RUN && log "*** DRY-RUN モード（コピーは行いません）***"

# --- 2. ベースの取得（gh があれば利用、無ければ git）---
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CLONE_DIR="$TMP/base"

fetch_base() {
  if command -v gh >/dev/null 2>&1; then
    log "gh でベースを取得します"
    if gh repo clone "$BASE_REPO" "$CLONE_DIR" -- --depth 1 --branch "$REF" >/dev/null 2>&1; then
      return 0
    fi
    # branch 指定 clone が ref（タグ/SHA）で失敗した場合のフォールバック。
    # fetch/checkout が失敗したら die する（silent に default ブランチを適用しない）
    if gh repo clone "$BASE_REPO" "$CLONE_DIR" -- --depth 1 >/dev/null 2>&1; then
      git -C "$CLONE_DIR" fetch --depth 1 origin "$REF" >/dev/null 2>&1 \
        || die "指定された ref ($REF) のフェッチに失敗しました"
      git -C "$CLONE_DIR" checkout -q FETCH_HEAD 2>/dev/null \
        || die "指定された ref ($REF) のチェックアウトに失敗しました"
      return 0
    fi
  fi
  log "git でベースを取得します"
  local url="https://github.com/${BASE_REPO}.git"
  if git clone --depth 1 --branch "$REF" "$url" "$CLONE_DIR" >/dev/null 2>&1; then
    return 0
  fi
  # ref がタグ/SHA でブランチ clone が失敗した場合。
  # fetch/checkout が失敗したら die する（意図しない default ブランチ適用を防ぐ）
  git clone --depth 1 "$url" "$CLONE_DIR" >/dev/null 2>&1 \
    || die "ベースの取得に失敗しました（$BASE_REPO@$REF）。認証（GH_TOKEN）と ref を確認してください"
  git -C "$CLONE_DIR" fetch --depth 1 origin "$REF" >/dev/null 2>&1 \
    || die "指定された ref ($REF) のフェッチに失敗しました"
  git -C "$CLONE_DIR" checkout -q FETCH_HEAD 2>/dev/null \
    || die "指定された ref ($REF) のチェックアウトに失敗しました"
}
fetch_base
[ -d "$CLONE_DIR/.claude" ] || die "取得したベースに .claude/ がありません。--base / --ref を確認してください"

# --- 3. 適用対象の定義 ---
# 常時同期（最新で上書き・更新）: ルール本体 / ハーネス / スキル / ツール / 設定雛形
SYNC_PATHS=(
  "docs/rules"
  ".claude/rules"
  ".claude/hooks"
  ".claude/skills"
  ".claude/agents"
  ".claude/output-styles"
  ".claude/commands"
  ".claude-plugin"
  "tools"
  "scripts"
  "modules.yaml"
  ".mcp.json"
  "requirements.txt"
)
# 既存があれば保護（プロジェクト固有・--overwrite-project で上書き）
PROTECT_PATHS=(
  "CLAUDE.md"
  "docs/project-mission.md"
)

copy_path() {
  local rel="$1"
  local src="$CLONE_DIR/$rel"
  local dst="$TARGET/$rel"
  if [ ! -e "$src" ]; then
    log "  - skip（ベースに無い）: $rel"
    return
  fi
  if $DRY_RUN; then
    log "  ~ would sync: $rel"
    return
  fi
  if [ -d "$src" ]; then
    mkdir -p "$dst"
    cp -a "$src/." "$dst/"
  else
    mkdir -p "$(dirname "$dst")"
    cp -a "$src" "$dst"
  fi
  log "  + $rel"
}

log "── ルール・スキル・ハーネスを同期 ──"
for p in "${SYNC_PATHS[@]}"; do
  copy_path "$p"
done

# --- 4. .claude/settings.json（ハーネス本体）の導入 ---
SETTINGS_SRC="$CLONE_DIR/.claude/settings.json"
SETTINGS_DST="$TARGET/.claude/settings.json"
if [ -f "$SETTINGS_SRC" ]; then
  if $KEEP_SETTINGS && [ -f "$SETTINGS_DST" ]; then
    log "  - settings.json は既存を維持（--keep-settings）"
  elif $DRY_RUN; then
    log "  ~ would install: .claude/settings.json"
  else
    # 既存 .bak は上書きしない（再実行でオリジナル設定のバックアップを失わないため）
    if [ -f "$SETTINGS_DST" ] && [ ! -f "$SETTINGS_DST.pre-base.bak" ]; then
      cp -a "$SETTINGS_DST" "$SETTINGS_DST.pre-base.bak"
      log "  ! 既存 settings.json を退避: .claude/settings.json.pre-base.bak"
    fi
    mkdir -p "$(dirname "$SETTINGS_DST")"
    cp -a "$SETTINGS_SRC" "$SETTINGS_DST"
    log "  + .claude/settings.json"
  fi
fi

# --- 5. プロジェクト固有ファイル（既存は保護）---
log "── プロジェクト固有ファイル ──"
for p in "${PROTECT_PATHS[@]}"; do
  src="$CLONE_DIR/$p"; dst="$TARGET/$p"
  [ -e "$src" ] || continue
  if [ -e "$dst" ] && ! $OVERWRITE_PROJECT; then
    if $DRY_RUN; then
      log "  ~ would keep existing, save template as $p.base: $p"
    else
      mkdir -p "$(dirname "$dst")"
      cp -a "$src" "$dst.base"
      log "  = 既存を維持・雛形を $p.base として配置: $p"
    fi
  else
    if $DRY_RUN; then
      log "  ~ would install: $p"
    else
      mkdir -p "$(dirname "$dst")"
      cp -a "$src" "$dst"
      log "  + $p"
    fi
  fi
done

if $DRY_RUN; then
  log "DRY-RUN 完了。--dry-run を外すと実際に適用します。"
  exit 0
fi

# --- 6. bootstrap で仕上げ（プレースホルダ置換 + symlink 同期 + 任意 prune）---
log "── 仕上げ（プレースホルダ置換 + symlink 同期）──"
BOOTSTRAP="$TARGET/scripts/bootstrap.sh"
if [ -f "$BOOTSTRAP" ]; then
  args=(--repo "$TARGET_SLUG" --name "$PROJECT_NAME")
  [ -n "$PROJECT_DESC" ] && args+=(--desc "$PROJECT_DESC")
  [ -n "$PROJECT_TZ" ] && args+=(--tz "$PROJECT_TZ")
  $PRUNE && args+=(--prune)
  bash "$BOOTSTRAP" "${args[@]}" || log "bootstrap でエラー（プレースホルダ置換は部分的かもしれません）"
else
  # bootstrap が無い場合でも最低限 symlink 同期はする
  [ -x "$TARGET/tools/check_rules_sync.sh" ] && bash "$TARGET/tools/check_rules_sync.sh" --fix || true
fi

# --- 7. 完了サマリー ---
echo ""
log "✅ 適用完了: $TARGET_SLUG"
echo "  - ルール     : docs/rules/ + .claude/rules/（symlink）"
echo "  - スキル     : .claude/skills/"
echo "  - ハーネス   : .claude/hooks/ + .claude/settings.json"
echo "  - エージェント: .claude/agents/ / コマンド: .claude/commands/"
echo ""
echo "次のステップ:"
echo "  1. docs/project-mission.md にミッション・KPI を記入（.base 雛形があれば参照）"
echo "  2. CLAUDE.md の応答スタイル / PR 自律化方針を確認（.base 雛形があれば差分を取り込む）"
echo "  3. 不要モジュールは modules.yaml を編集して再実行（--prune）"
echo "  4. クラウド実行する場合は GH_TOKEN を環境変数に設定"
echo ""
echo "最新へ同期したいときは、同じコマンドを再実行してください（idempotent）。"
