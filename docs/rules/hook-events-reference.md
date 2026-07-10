# フックイベント公式リファレンス（実在検証 + 採否決定・SSOT）

> このファイルは Claude Code の **フックイベント名の実在性** と、本ベースでの **採否決定** の唯一の正本（SSOT）。
> タスク依存ルール（Warm 層）であり `.claude/rules/` に symlink しない（フック設計・拡張時のみ Read する）。
>
> **検証日**: 2026-06-14 / **一次情報**: https://code.claude.com/docs/en/hooks
> 訓練データではなく公式ドキュメントの実フェッチで裏取りした（E-E #23・🔍 タスク）。

## 0. 検証の結論

公式ドキュメントのライフサイクル表には **31 個** の設定可能なフックイベントが存在すると明記されている。
本ファイルの §1 一覧には、一次フェッチで名称を確認できた **30 件** を掲載する（残り 1 件は未確認・後述）。
過去に「実在が疑わしい」とされたイベント名（`PostToolBatch` / `StopFailure` / `PostToolUseFailure` /
`UserPromptExpansion` / `PreCompact` / `PostCompact` / `SessionEnd` / `Notification`）は **すべて実在** する。

## 1. 公式イベント一覧（公式表記 31・本表は確認済み 30 を掲載・2026-06-14 時点）

| # | イベント | トリガー（要約） | 本ベースでの採否 |
|---|---------|----------------|----------------|
| 1 | `SessionStart` | セッション開始・再開時（matcher: startup/resume/clear/compact） | ✅ 採用（session-start.sh） |
| 2 | `Setup` | 環境セットアップ時 | ⬜ 未採用 |
| 3 | `UserPromptSubmit` | ユーザー送信直後・処理前。**stdout がコンテキスト注入**。exit 2 で prompt をブロック＆消去 | ✅ **採用（user-prompt-submit-guard.sh・#23）** |
| 4 | `UserPromptExpansion` | ユーザー入力コマンドが prompt に展開される前。**stdout 注入**・展開ブロック可 | ⬜ 未採用 |
| 5 | `PreToolUse` | ツール実行前（matcher: tool_name）。permissionDecision で allow/deny/ask/defer | ✅ 採用（pre-tool-use-router.sh・Bash） |
| 6 | `PermissionRequest` | 権限プロンプト発生時。decision.behavior で allow/deny | ✅ 採用（permission-request-auto-allow.sh） |
| 7 | `PermissionDenied` | 権限が拒否されたとき | ⬜ 未採用 |
| 8 | `PostToolUse` | ツール成功後（matcher: tool_name） | ✅ 採用（post-tool-use-validate.sh） |
| 9 | `PostToolUseFailure` | ツール失敗後 | ✅ 採用（post-tool-use-failure.sh・Bash） |
| 10 | `PostToolBatch` | 並列ツール呼び出しのバッチ解決後・次のモデル呼び出し前 | ⬜ 未採用 |
| 11 | `Notification` | Claude Code が通知を送るとき（matcher: permission_prompt/idle_prompt 等・`message` フィールド）。decision 制御なし | ⬜ **未採用（観測専用・後述）** |
| 12 | `MessageDisplay` | メッセージ表示時 | ⬜ 未採用 |
| 13 | `SubagentStart` | サブエージェント開始時 | ⬜ 未採用 |
| 14 | `SubagentStop` | サブエージェント終了時 | ✅ 採用（subagent-stop.sh） |
| 15 | `TaskCreated` | タスク作成時 | ⬜ 未採用 |
| 16 | `TaskCompleted` | タスク完了時 | ⬜ 未採用 |
| 17 | `Stop` | Claude が応答を終えるとき。decision: block で継続 | ✅ 採用（stop-router.sh） |
| 18 | `StopFailure` | API エラーでターンが終わるとき。**出力・exit code は無視される** | ⬜ 未採用（出力無視のため副作用フック不可） |
| 19 | `TeammateIdle` | Agent Team のチームメイトがアイドルになったとき | ⬜ 未採用 |
| 20 | `InstructionsLoaded` | CLAUDE.md / ルール再注入時（load_reason: compact 等） | ⬜ 未採用（ログ用途のみ） |
| 21 | `ConfigChange` | 設定変更時 | ⬜ 未採用 |
| 22 | `CwdChanged` | 作業ディレクトリ変更時 | ⬜ 未採用 |
| 23 | `FileChanged` | ファイル変更時 | ⬜ 未採用 |
| 24 | `WorktreeCreate` | git worktree 作成時 | ⬜ 未採用 |
| 25 | `WorktreeRemove` | git worktree 削除時 | ⬜ 未採用 |
| 26 | `PreCompact` | 圧縮開始前（matcher: manual/auto）。exit 2 で圧縮ブロック可 | ✅ **採用（pre-compact.sh・#23）** |
| 27 | `PostCompact` | 圧縮完了後（matcher: manual/auto）。decision 制御なし | ✅ 採用（post-compact.sh） |
| 28 | `Elicitation` | 入力要求ダイアログ時 | ⬜ 未採用 |
| 29 | `ElicitationResult` | 入力要求の結果確定時 | ⬜ 未採用 |
| 30 | `SessionEnd` | セッション終了時（matcher: clear/resume/logout/prompt_input_exit/bypass_permissions_disabled/other）。decision 制御なし | ⬜ **未採用（後述）** |

> 注: 公式ライフサイクル表は 31 個と明記しているが、一次フェッチで名称を確認できたのは上記 30 件。
> 残り 1 件は **未確認**（本フェッチでは名称を特定できなかった）。断定を避け、フック拡張時に
> 公式ドキュメントを再フェッチして本表を補完する。

## 2. stdout がコンテキスト注入されるイベント（重要）

ほとんどのイベントの stdout はデバッグログ止まりで Claude には見えない。**例外** は以下の 3 つのみ:

- `UserPromptSubmit`
- `UserPromptExpansion`
- `SessionStart`

これら以外のフックで Claude に情報を渡したい場合は、`hookSpecificOutput.additionalContext`
（Claude 向け）を JSON で返す。`systemMessage` はユーザー向け表示。

## 3. #23 で新規採用したフックと役割整理

### UserPromptSubmit（user-prompt-submit-guard.sh + prompt-structuring.sh）
UserPromptSubmit には 2 フックを配線する（settings.json で guard → structuring の順）。stdout は
両方ともコンテキストに注入されるが、役割を分離している:

- **user-prompt-submit-guard.sh**（安全助言）: ユーザー入力の高リスクパターン（main 直 push / rm -rf /
  .env・秘密情報 / フック無効化 / settings.local.json への env 書き込み）を検出し、関連ガードレールを
  **助言としてコンテキスト注入** する。既定は **非ブロッキング**（exit 0）。誤検知で正当作業を止めない
  ため。真に破壊的なパターンをブロックしたいプロジェクト向けに exit 2 のブロック例をコメントで残してある
- **prompt-structuring.sh**（プロンプト自動構造化・Issue #172）: ユーザーの生指示（タスク依頼）を着手前に
  作業スペックへ展開させる構造化ディレクティブを注入する。公式仕様で生プロンプトの置換は不可
  （"can't replace the prompt"）のため、stdout 注入で近似する workaround。トグル
  `CLAUDE_PROMPT_STRUCTURING=auto|off|always`（既定 auto）。**高リスク入力を検出したら本フックの注入を
  完全抑制** し guard の助言だけを残す（二重バナー防止）。詳細 SSOT は `docs/rules/prompt-structuring-rules.md`

### PreCompact（pre-compact.sh）と PostCompact（post-compact.sh）の役割分担
- **PreCompact**: 圧縮が始まる *前* に未コミット変更を WIP コミット＆push（L-100 の一次防御）。
  圧縮処理中の不具合や圧縮後の SessionStart クリーンアップで作業が消える前に、最も早く確定させる
- **PostCompact**: 圧縮 *後* のルール再確認リマインダー + symlink 同期 + 二次的な WIP セーフティネット。
  PreCompact が確定済みなら working tree は clean になり二重コミットは発生しない

## 4. 未採用イベントの採否理由（明示）

| イベント | 未採用の理由 |
|---------|------------|
| `SessionEnd` | WIP 保全は `Stop`（stop-router.sh）+ `PreCompact`/`PostCompact` で既にカバー済み。logout 時のクリーンアップが必要なプロジェクトのみ追加する（settings.json に `SessionEnd` を追記）。汎用ベースでは冗長コミットを避けるため未採用 |
| `Notification` | decision 制御なしの観測専用。Slack 通知は `tools/slack_notify.py` で能動制御しており、idle/permission プロンプトを横取りする用途がないため未採用。observability が欲しいプロジェクトのみ採用 |
| `StopFailure` | 出力・exit code が無視されるため副作用フックを置けない（API エラー時のログは別経路で取得） |
| `PostToolBatch` / `InstructionsLoaded` 他 | 現行ハーネスの守備範囲（main 直 push 防止・PR フロー・圧縮保全）に必要十分。将来要件が出たら本表の採否を更新する |

## 5. サブエージェント persistent memory の frontmatter キー（#23 検証）

公式（[sub-agents docs](https://code.claude.com/docs/en/sub-agents)）で確認した正しいキーは **`memory`**（`persistent_memory` ではない）。

```yaml
---
name: code-reviewer
description: ...
memory: user   # user | project | local
---
```

| スコープ | 保存先 | 用途 |
|---------|--------|------|
| `user` | `~/.claude/agent-memory/<name>/` | 全プロジェクト横断で学習を蓄積 |
| `project` | `.claude/agent-memory/<name>/` | プロジェクト固有・バージョン管理で共有 |
| `local` | `.claude/agent-memory-local/<name>/` | プロジェクト固有・コミットしない |

- サブエージェントの全 frontmatter キー: `name`(必須) / `description`(必須) / `prompt` / `tools` /
  `disallowedTools` / `model` / `permissionMode` / `mcpServers` / `hooks` / `maxTurns` / `skills` /
  `initialPrompt` / `memory` / `effort` / `background` / `isolation` / `color`
- **Plugin 経由のサブエージェントは `hooks` / `mcpServers` / `permissionMode` が無視される**
  （`.claude-plugin/plugin.json` で配布する owner.md は `tools` のみ使用のため影響なし）

## 6. 参照

| ドキュメント | 関係 |
|------------|------|
| `.claude/settings.json` | フック登録の実体 |
| `docs/rules/session-compression-rules.md` | PreCompact/PostCompact の運用文脈 |
| `docs/rules/harness-escalation.md` | フック Lv3 昇格の判断 |
| `docs/rules/lessons-core.md` | L-100（未コミット作業消失）の対策 |
