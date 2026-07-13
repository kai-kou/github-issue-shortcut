<!-- discussion_whiteboard:auto -->
# 🧑‍🏫 議論ホワイトボード: claude-code-base ac5659c 再同期差分の妥当性レビュー

- 議題ID: `base-sync-20260714`
- 論点: ブランチ claude/sync-claude-code-base-bmh8al の差分（origin/main..HEAD・106 files）が、ベース同期として安全・完全・過不足ないかを敵対的相互レビューで検証する。観点: ハーネス配線の整合 / CLAUDE.md 手動マージと孤立ファイル / プロジェクト固有ファイルの保護
- 参加者: `harness_auditor`, `docs_consistency`, `project_guard`
- 投稿数: 3
- 更新: 2026-07-14T08:18:32+09:00

> このファイルは `tools/discussion_whiteboard.py render` が自動生成する。直接編集せず `post` で追記すること（同時書き込み破損防止）。

## ラウンド 1

### `harness_auditor` — 主張
<sub>2026-07-14T08:15:17+09:00</sub>

検証済み・問題なし（4項目とも）:

1. `.claude/settings.json` の hooks 配列と `.claude/hooks/` 実ファイルの一致
   - settings.json が参照する12スクリプト（session-start / user-prompt-submit-guard / prompt-structuring /
     orchestrator-directive / permission-request-auto-allow / pre-tool-use-router / post-tool-use-validate /
     post-tool-use-failure / pre-compact / post-compact / stop-router / subagent-stop）全て実在。
   - settings.json に直接登録されていない5スクリプト（pre-git-push-check.sh / pre-pr-create-check.sh /
     stop-git-check.sh / stop-pr-check.sh / stop-slack-notify.sh / stop-completion-report-check.sh）は
     孤立ファイルではなく、それぞれ pre-tool-use-router.sh（PreToolUse配下）/ stop-router.sh（Stop配下）から
     `source`/サブプロセス呼び出しされる正規のルーター配下ファイル。登録漏れなし。

2. 新規フック配線順序
   - UserPromptSubmit 配列順: user-prompt-submit-guard.sh → prompt-structuring.sh → orchestrator-directive.sh
     （要件どおり3番目）。
   - PermissionRequest: matcher "Read|Write|Edit|NotebookEdit" で permission-request-auto-allow.sh 単独登録、妥当。
   - hooks/lib/hook_block.sh は pre-tool-use-router.sh / pre-git-push-check.sh / pre-pr-create-check.sh /
     stop-git-check.sh / stop-pr-check.sh / stop-completion-report-check.sh / post-tool-use-validate.sh の
     7ファイルから source される共通ライブラリとして正しく配置。

3. bash 構文エラー
   - `.claude/hooks/*.sh` + `.claude/hooks/lib/*.sh` 全19ファイルに `bash -n` 実施 → エラーゼロ。

4. `tools/check_rules_sync.sh` の ESSENTIAL_RULES と `.claude/rules/` symlink
   - ESSENTIAL_RULES 記載13ファイル（agent-team-summary / completion-report-rules / core-principles /
     datetime-rules / lessons-core / pr-review-flow-summary / session-compression-rules /
     session-concurrency-rules / session-safety-rules / session-sprint-rules /
     user-confirmation-minimization / user-instruction-issue-rules / user-notification-triage）と
     `.claude/rules/` の symlink 13本が完全一致。
   - `bash tools/check_rules_sync.sh` 実行 → `[OK] docs/rules/ と .claude/rules/ は同期されています`（exit 0）。

補足（HOOK_DIR 解決の一貫性・軽微確認）:
   - lib 参照元7ファイル中5ファイルは `BASH_SOURCE[0]`、pre-tool-use-router.sh / stop-router.sh の2ファイルは
     `$0` で HOOK_DIR を解決しているが、いずれも settings.json から直接実行される想定でズレは生じない
     （既存パターンとの差異なし・指摘なし）。

結論: harness_auditor レンズで critical/major 指摘なし。

### `project_guard` — 主張
<sub>2026-07-14T08:16:30+09:00</sub>

## project_guard — Round 1 所見

### 1. アプリケーションコード混入 — 検証済み・問題なし
`git diff origin/main..HEAD --name-only` で `src/`・`public/`・`package.json`・`package-lock.json`・
`wrangler.*`・`vite.config.*` に一致するファイルはゼロ。差分は `.claude/` `docs/` `tools/` `scripts/`
`modules.yaml` `CLAUDE.md` のみ。アプリ資産の混入なし。

### 2. プロジェクト固有ファイルの破壊 — 検証済み・問題なし（軽微な整合性ズレ1件あり、下記4参照）
- `CLAUDE.md`: 冒頭の「## このプロジェクトについて / GitHub Issue Shortcut」節・応答スタイル節は無変更。
  差分は Hot/Warm 参照テーブルへの追記（`session-concurrency-rules.md` Hot 化済み注記・`native-fallback-rules.md`
  参照・`discussion-review` スキル追記等）と、既存文言の軽微修正のみ。プロジェクト名・ペルソナ破壊なし。
- `docs/project-mission.md` / `docs/requirements*` / `docs/routines/sprint-session.md` は diff 名一覧に
  一切登場せず（`git diff --name-only | grep -E 'project-mission|requirements|sprint-session'` → NONE）。
  ベースの雛形で上書きされた形跡なし。

### 3. modules.yaml — 概ね妥当・**minor 指摘1件**
- `enabled: false` のモジュールは origin/main・HEAD 双方でゼロ件（このプロジェクトは元々全モジュール有効）。
  よって「無効化していたモジュールが復活」という事故は **発生していない**（`merge_modules_yaml.py` の
  enabled:false 引き継ぎロジックも実装済みで妥当）。
- `agent-teams` モジュールへの `discussion-review` スキル追加・`native-fallback` モジュール新設は
  base 側の正当な機能追加に対応しており、リポジトリ固有カスタマイズとは無関係で問題なし。
- **[minor] `project.name` が `"GitHub Issue Shortcut"` → `"github-issue-shortcut"` に変化。**
  `apply-to-repo.sh` は modules.yaml を base 最新版で無条件上書きし、`merge_modules_yaml.py` は
  `enabled:false` のみ引き継ぐ設計（`project:` セクションは対象外）ため、再適用のたびに表示名が
  base 側のブートストラップ値（未指定時は repo slug）に巻き戻る。実害は無し（`repo:` フィールドは
  `"kai-kou/github-issue-shortcut"` のまま正しく、CLAUDE.md 側の表示名も無変更・どのツールも
  modules.yaml の `project.name` を実行時に参照していないことを確認済み）が、ドキュメント上の
  表示名 drift として残る。恒久対策: `merge_modules_yaml.py` に `project:` セクション（name/repo/timezone）
  の引き継ぎも追加するのが望ましい（後続 Issue 化を推奨・ブロッカーではない）。

### 4. `.claude/base-sync-state.json` — 検証済み・問題なし
```json
{
  "base_repo": "kai-kou/claude-code-base",
  "ref": "main",
  "commit": "ac5659c523971b5f8cc5304e0e63867492678b8b",
  "applied_at": "2026-07-14T08:10:35+0900"
}
```
40 桁 hex（正当な full SHA）で先頭 `ac5659c` と一致。JST タイムスタンプ表記も datetime-rules 準拠。新規追加ファイルとして妥当。

### 5. 秘密情報・トークン漏洩 — 検証済み・問題なし
`git diff origin/main..HEAD` 全文を `api[_-]?key|secret|token|password|Bearer |ghp_|ghs_|sk-ant|AKIA...` で
grep。ヒットは全て「変数名・概念としての言及」（例: `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` という
env var 名の記述、`gh secret list` という API パス名の記述、`secret-hunter` という参加者名、
`mask_secrets` importなど）であり、実値・実トークンの埋め込みは確認されなかった。

---
**総合判定**: critical / major 指摘なし。minor 1件（modules.yaml の `project.name` 表示名 drift、
実害なし・恒久対策として `merge_modules_yaml.py` 拡張を推奨）。

### `docs_consistency` — 主張
<sub>2026-07-14T08:17:45+09:00</sub>

## docs_consistency — Round 1 分析

### 1. UPDATE NOTES 手動手順（2026-07-10 以降）— 全て実施済み・問題なし

- **#227**（gh auth status 除外）: `CLAUDE.md:139` で `gh auth status` を「クラウドで生存するのは」の列挙から除外し、「（`gh auth status` は exit 0 でも失敗表示・認証判定に使わない）」の注記を追加済み。ファイル内出現は1箇所のみ（重複なし）。✅
- **#199**（native-fallback-rules.md 参照追加）: `CLAUDE.md:106` のタスク依存ルール一覧に `native-fallback-rules.md`（Web 未提供機能の claude -p フォールバック標準形）が追加済み。実体 `docs/rules/native-fallback-rules.md` も存在。`.claude/rules/` には symlink されていないが、これは正しい（`tools/check_rules_sync.sh` の `ESSENTIAL_RULES` に含まれない task-dependent ルールのため symlink 不要。`./tools/check_rules_sync.sh` 実行結果 `[OK]`）。✅
- **#203**（daily-progress-rules.md 削除）: ファイル本体・symlink とも完全に削除済み。リポジトリ全体 grep で `daily-progress-rules` への参照ゼロ。残る `daily-progress` という文字列は全て `tools/slack_notify.py --type daily-progress`（別概念＝日次進捗レポートの CLI サブコマンド名。ルールファイルではなく機能として現存し正当）および `user-notification-triage.md` §4.1 相当箇所への統合後の記述であり、孤立参照ではない。✅

### 2. 孤立ファイル検出 — 問題なし

`docs/rules/*.md` と `tools/*.py`/`*.sh` のファイル名集合を base clone（`/workspace/claude-code-base`）と `comm -23`/`comm -13` で突合した結果、**両方向とも差分ゼロ**（孤立ファイルなし・欠落ファイルなし）。`.claude/skills/` も14スキル完全一致。

### 3. CLAUDE.md の表 vs 実態 — 一致（ただし injected context に注意）

- スキル表（14行）= `.claude/skills/` の14ディレクトリと完全一致。
- フック表（18行、一部 `/` で複数ファイルまとめ表記）= `.claude/hooks/` の18ファイルと完全一致（`orchestrator-directive.sh`・`permission-request-auto-allow.sh`・`stop-git-check.sh`/`stop-pr-check.sh`/`stop-slack-notify.sh` も含め全て記載あり）。
- 必読ルール表（13行）= `.claude/rules/` の13 symlink と完全一致。`check_rules_sync.sh` も `[OK]`。
- **注記（minor・PR起因の不具合ではない）**: 本セッション冒頭のシステムリマインダーに埋め込まれた CLAUDE.md スナップショットは、本 PR コミット前の**古い版**（フック表に `orchestrator-directive.sh` 等が欠落・discussion-review スキル未掲載）だった。実ファイル（ディスク上の `CLAUDE.md`）は完全に最新化されている。レビュアーが injected context のみを見て「表が古い」と誤判定しないよう申し送り。

### 4. プレースホルダー・元ドメイン残滓 — 新規導入分に問題なし、既存 minor 1件

- `{{...}}` 形式の未置換プレースホルダーを全リポジトリ grep → 本 PR 差分には**ゼロ**。ヒットした2件はどちらも無関係: `docs/rules/agent-constitution.md`（意図的なプロジェクト別カスタマイズ雛形・本 diff 対象外）、`tools/finalize_broker_migration.py`（Python f-string の `{{key}}` エスケープであり実プレースホルダーではない・false positive）。
- 同期された `docs/rules/*.md` 内の「動画制作/YouTube」ドメイン記述は、該当箇所全てに `⚠️ 出自プロジェクト（動画制作）の実例` 等の明示ラベルが付されており、汎用ベースの意図的な例示（ベースの設計方針どおり）。本 PR で新規導入されたものではなく、既存の一貫した表記。
- **minor（本 PR 起因ではないが本 PR が touch した既存ファイル）**: `tools/discussion_specs/public_readiness_audit.json`（本 PR で8行変更＝サニタイズ済み）は、内容が丸ごと「`kai-kou/claude-code-base`（ベースリポジトリ自身）のパブリック化監査」用スペックで、`/home/user/claude-code-base` という本リポジトリに存在しないパスを前提にしている。github-issue-shortcut では実行不能な spec がそのまま同期されている。origin/main 時点で既に存在していた（本 PR での新規混入ではない）ため本 PR のブロッカーではないが、恒久的には「ベース自己参照専用の discussion spec は下流に同期しない」棚卸し Issue が望ましい（cosmetic・non-blocking）。

### 結論

critical: 0 件 / major: 0 件 / minor: 1 件（`public_readiness_audit.json` の同期対象妥当性・pre-existing・non-blocking）+ 1 件の申し送り事項（injected context の CLAUDE.md スナップショットが古い＝レビュー環境側の note であり PR 自体の欠陥ではない）。UPDATE NOTES の3項目の手動手順は全て正しく実施済み。
