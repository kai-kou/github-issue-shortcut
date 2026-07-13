<!--entry
author: harness_auditor
round: 2
kind: concession
ts: 2026-07-14T08:19:37+09:00
-->

## harness_auditor — Round 2（ハーネス実行時の実害有無レンズでの妥当性検証）

### 1. project_guard「modules.yaml project.name drift（minor）」→ 同意（minor 判定を実行時観点から追認）

- Round 1 で settings.json の全 12 登録フック + ルーター配下 6 スクリプト + lib の配線を精査したが、
  **フック実行パス上に modules.yaml を読むものは存在しない**。settings.json の hooks が起動するのは
  `.claude/hooks/*.sh` のみで、その参照連鎖（router → pre-git-push-check / pre-pr-create-check /
  stop-* 各種 → lib/hook_block.sh）に modules.yaml への依存はゼロ。
- したがって `project.name` の表示名 drift は **セッション起動〜停止のどのフックイベントでも評価されず、
  ハーネス実行時の実害は確定的にゼロ**。project_guard 自身の「どのツールも実行時に参照しない」確認とも
  整合する。minor（non-blocking・後続 Issue で merge_modules_yaml.py に project: 引き継ぎ追加）が妥当。
  major への格上げ根拠は私のレンズからは無し。

### 2. docs_consistency「public_readiness_audit.json 同期妥当性（minor）」→ 同意（さらに弱い実害と評価）

- `tools/discussion_specs/*.json` は **どのフックイベントにも配線されていない**（Round 1 の
  settings.json 精査で SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop 等の
  全イベントを確認済み。discussion spec を読むエントリは皆無）。
- この spec が評価されるのは、discussion-review スキル / run_discussion_review.py を
  **明示的に `--spec` 指定で起動したときのみ**。存在しないパス `/home/user/claude-code-base` を
  前提にした spec は、その明示起動時に file-not-found で fail-fast するだけで、サイレントな
  誤動作・他フックへの波及は構造上起こりえない（自動発火経路なし）。
- よって実行時リスクは「明示的に間違った spec を選んだときの即時エラー」に限定され、
  pre-existing でもあることから **minor どころか cosmetic 寄り**。non-blocking 判定に同意。
  棚卸し Issue（ベース自己参照 spec の同期除外）も妥当な恒久対策と考える。

### 結論

両 minor 指摘とも、ハーネス実行時実害の観点で **格上げ不要・non-blocking のまま確定** を支持する。
本ブランチのマージブロッカーは 3 者のレンズを通じてゼロ。
