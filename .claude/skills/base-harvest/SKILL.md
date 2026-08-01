---
name: base-harvest
description: 下流リポジトリ（`apply-base` でこのベースを導入したプロジェクト）で生まれた汎用的なルール・スキル・ハーネス改善を kai-kou/claude-code-base 側へ還流（harvest）する。「{リポジトリ名} の改善をベースに還流して」「{リポジトリ名} の汎用改善をベースに反映して」「base-harvest して」等と依頼された時に使用する。`apply-base`（ベース → 下流の一方向同期）と対になる逆方向の同期スキルで、下流リポジトリのクロスリポ取得を伴う（`add_repo` が使えないタスク実行モードでは非対応・L-117）。
---

> 🔴 **GitHub 操作の経路（必読・L-114）**: クラウド実行環境では `gh` は当てにせず、
> `mcp__github__*` と `git clone/fetch` を一次経路にする（`docs/rules/github-mcp-fallback-patterns.md`）。
> 🔴 **クロスリポジトリ制約（必読・L-117）**: GitHub Issue/PR 起動の自動タスク実行モードでは
> `mcp__Claude_Code_Remote__add_repo` 自体がツールリストに存在せず、スコープ外リポジトリへの
> `git clone`/`git ls-remote` は 403 になる。本スキルは **対話型 `claude.ai/code` セッション**
> （`add_repo` が使えるセッション）での実行を前提とする。実行前に `add_repo` の有無を確認し、
> 無ければ §1 の案内でユーザーへその旨を伝えて中断する。

# base-harvest スキル（下流 → ベースの汎用改善還流）

`apply-base` が一方向に配布した設定を、下流リポジトリで実際に運用する中で生まれた
**汎用的な** 改善（バグ修正・堅牢化・新しい運用パターンの明文化等）だけを選び、
`kai-kou/claude-code-base` 側へ還流する。プロジェクト固有の記述（ミッション・KPI・
ドメイン用語・外部サービス名など）は還流しない。

## 0. 前提と方針

- 実行はベースリポジトリ（`kai-kou/claude-code-base`）のカレントセッションで行う。
  下流リポジトリは `add_repo` で読み取りアクセスを追加し、`git clone` で取得する。
- 対象ディレクトリは `docs/rules/`・`.claude/`（`rules`/`skills`/`hooks`/`agents`）・`tools/` の
  **ハーネス系資産のみ**。`CLAUDE.md`・`docs/project-mission.md`・`content/` 配下等の
  プロジェクト固有ファイルは対象外（`apply-base` §0 の保護方針と対称）。
- **差分の基準点は下流の同期マーカー**（`.claude/base-sync-state.json`、下流が前回 `apply-base` を <!-- refcheck:ignore -->
  適用したベース側 SHA を記録している）。このマーカーが指す SHA 時点のベース内容と、下流の
  現在の内容を比較することで、「元々ベースにあった内容」と「下流が独自に生み出した改善」を
  区別できる（マーカーが無い下流リポジトリは全文比較にフォールバックし、範囲が広がる分だけ
  分類（§3）を丁寧に行う）。
- 冪等ではない（人間の判断＝汎用/固有の分類を伴う一括還流のため、`apply-base` のような
  無人再同期は想定しない）。

## 1. 事前チェック（自律実行）

```
0. 現在のセッションが kai-kou/claude-code-base 自身（git remote get-url origin がベースを指す）で
   あることを確認する。下流リポジトリ側のセッションで本スキルのトリガー文言が発話された場合
   （役割が逆転しているケース）は、ここで自動判定・自動続行せず「base-harvest はベース側の
   セッションで実行する設計です。kai-kou/claude-code-base のセッションで実行し直してほしい」と
   案内して終了する（§0 の前提を無条件に信じて処理を進めない）。
1. add_repo が ToolSearch でヒットするか確認する（"add_repo" で検索）。
   ヒットしない → L-117 のケース。「このタスク実行モードでは下流リポジトリへ到達できないため
   base-harvest は非対応。通常の claude.ai/code セッションで再実行してほしい」と案内して終了する
   （A-6 ではなく Anthropic 側の機能制約として報告する）。
2. ヒットする → mcp__Claude_Code_Remote__add_repo(owner, repo, access:"read") で対象下流リポジトリを追加。
   クローン手順はツール結果が案内する（register_repo_root を忘れずに実行し、CLAUDE.md 等を読み込ませる）。
3. 対象リポジトリのルートで .claude/base-sync-state.json を読み、前回適用ベース SHA を取得する <!-- refcheck:ignore -->
   （無ければ手順4を全文比較モードで行う）。
```

## 2. 差分抽出

```bash
# 例: 下流リポジトリのクローン先を $downstream、ベース側のワークツリーを $base_root、
# 手順1-3で取得した前回適用SHAを $PREV_SHA とする（山括弧のまま埋め込むと bash のリダイレクトと
# 衝突するため、必ずシェル変数に入れてから渡す）。
if [ -n "$PREV_SHA" ]; then
  # 同期マーカーがある場合: そのマーカーが指す SHA 時点のベース内容を一時 worktree で再現して比較する
  git -C "$base_root" worktree add /tmp/base-at-marker "$PREV_SHA"
  diff -rq /tmp/base-at-marker/docs/rules "$downstream/docs/rules"
  diff -rq /tmp/base-at-marker/.claude/skills "$downstream/.claude/skills"
  diff -rq /tmp/base-at-marker/.claude/hooks "$downstream/.claude/hooks"
  diff -rq /tmp/base-at-marker/.claude/agents "$downstream/.claude/agents"
  diff -rq /tmp/base-at-marker/tools "$downstream/tools"
  git -C "$base_root" worktree remove /tmp/base-at-marker
else
  # 同期マーカーが無い場合: ベース HEAD とそのまま比較（範囲が広くなる分 §3 の分類を厳密に行う）
  diff -rq "$base_root/docs/rules" "$downstream/docs/rules"
  diff -rq "$base_root/.claude/skills" "$downstream/.claude/skills"
  diff -rq "$base_root/.claude/hooks" "$downstream/.claude/hooks"
  diff -rq "$base_root/.claude/agents" "$downstream/.claude/agents"
  diff -rq "$base_root/tools" "$downstream/tools"
fi
```

- 差分のうち「下流にのみ存在」「下流側が更新」しているファイル・箇所を候補リストにする。
- 「ベースにのみ存在（下流が追従していないだけ）」は還流対象外（それは `apply-base` 側の役割）。

## 3. 分類（汎用 vs プロジェクト固有）

各候補差分を判定する。迷うものは無理に一括還流せず、Issue 化して次回の判断に回す
（`apply-base` §3 と対称の方針）。

| 判定 | 例 |
|------|-----|
| **汎用（還流する）** | バグ修正・エラーハンドリングの堅牢化・新しく確立された運用パターン（例: 障害対応手順・確認最小化の追加ケース）・スキル/ツールの手戻り削減・ハーネスの安全対策強化 |
| **プロジェクト固有（還流しない）** | プロジェクト名・ミッション/KPI・ドメイン固有用語・特定の外部サービス名や API 固有の記述・下流固有のラベル体系や Issue 番号への言及 |

## 4. 移植

- 汎用と判定した差分をベースリポジトリへコピーし、下流固有の文字列（対象リポジトリ名・所有者名等）を
  プレースホルダ（`kai-kou`/`github-issue-shortcut`、`modules.yaml` 系なら `github-issue-shortcut`/`kai-kou/github-issue-shortcut`）に
  置換する。
- 新規ルールファイルを追加する場合は `docs/rules/{名前}.md` に実体を置き、
  `.claude/rules/{名前}.md` を symlink する（`session-compression-rules.md` の手順どおり）。
- `bash tools/check_rules_sync.sh` で symlink 整合を検証する。

## 5. PR 化とマージ

- 作業ブランチ `claude/base-harvest-{下流リポジトリ名}-{日付}` を切る。
- コミット → PR 作成（`Session-Id:` トレーラー必須）→ Layer 1 セルフレビュー（`Skill(code-review)`）→
  自動マージ（`pr-review-flow-summary.md` の通常フローと同一）。
- PR 本文に「還流元リポジトリ・還流した差分の一覧・分類理由」を記載する（レビュー可能性のため）。

## 完了・成功の定義

- [ ] 「{リポ名} の改善をベースに還流して」で汎用差分の抽出 → 分類 → 移植 → PR までが定型手順で実行できる
- [ ] プロジェクト固有の記述（ミッション・ドメイン用語・外部サービス名等）が誤って還流されていない
- [ ] `add_repo` が使えないタスク実行モード（L-117）では非対応と正しく判定し、案内して中断する
- [ ] 下流リポジトリ側のセッションで発話された場合（役割逆転）を誤って自動続行せず、ベース側セッションでの再実行を案内する
- [ ] 同期マーカー（`.claude/base-sync-state.json`）がある下流では、それを基準に「下流が独自に <!-- refcheck:ignore -->
      生み出した差分」だけを対象にできている
