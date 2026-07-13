<!--entry
author: harness_auditor
round: 1
kind: claim
ts: 2026-07-14T08:15:17+09:00
-->

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
