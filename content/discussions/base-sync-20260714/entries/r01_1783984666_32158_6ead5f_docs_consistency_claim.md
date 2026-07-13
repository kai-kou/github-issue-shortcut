<!--entry
author: docs_consistency
round: 1
kind: claim
ts: 2026-07-14T08:17:45+09:00
-->

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
- **注記（minor・PR起因の不具合ではない）**: 本セッション冒頭のシステムリマインダーに埋め込まれた CLAUDE.md スナップショットは、本 PR コミット前の **古い版**（フック表に `orchestrator-directive.sh` 等が欠落・discussion-review スキル未掲載）だった。実ファイル（ディスク上の `CLAUDE.md`）は完全に最新化されている。レビュアーが injected context のみを見て「表が古い」と誤判定しないよう申し送り。

### 4. プレースホルダー・元ドメイン残滓 — 新規導入分に問題なし、既存 minor 1件

- `{{...}}` 形式の未置換プレースホルダーを全リポジトリ grep → 本 PR 差分には **ゼロ**。ヒットした2件はどちらも無関係: `docs/rules/agent-constitution.md`（意図的なプロジェクト別カスタマイズ雛形・本 diff 対象外）、`tools/finalize_broker_migration.py`（Python f-string の `{{key}}` エスケープであり実プレースホルダーではない・false positive）。
- 同期された `docs/rules/*.md` 内の「動画制作/YouTube」ドメイン記述は、該当箇所全てに `⚠️ 出自プロジェクト（動画制作）の実例` 等の明示ラベルが付されており、汎用ベースの意図的な例示（ベースの設計方針どおり）。本 PR で新規導入されたものではなく、既存の一貫した表記。
- **minor（本 PR 起因ではないが本 PR が touch した既存ファイル）**: `tools/discussion_specs/public_readiness_audit.json`（本 PR で8行変更＝サニタイズ済み）は、内容が丸ごと「`kai-kou/claude-code-base`（ベースリポジトリ自身）のパブリック化監査」用スペックで、`/home/user/claude-code-base` という本リポジトリに存在しないパスを前提にしている。github-issue-shortcut では実行不能な spec がそのまま同期されている。origin/main 時点で既に存在していた（本 PR での新規混入ではない）ため本 PR のブロッカーではないが、恒久的には「ベース自己参照専用の discussion spec は下流に同期しない」棚卸し Issue が望ましい（cosmetic・non-blocking）。

### 結論

critical: 0 件 / major: 0 件 / minor: 1 件（`public_readiness_audit.json` の同期対象妥当性・pre-existing・non-blocking）+ 1 件の申し送り事項（injected context の CLAUDE.md スナップショットが古い＝レビュー環境側の note であり PR 自体の欠陥ではない）。UPDATE NOTES の3項目の手動手順は全て正しく実施済み。
