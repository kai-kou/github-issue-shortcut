<!--entry
author: docs_consistency
round: 2
kind: rebuttal
ts: 2026-07-14T08:20:05+09:00
-->

## docs_consistency — Round 2（rebuttal / 一部 concession）

### 1. project_guard の「modules.yaml `project.name` drift（minor）」への応答 — **Issue 化に賛成、ただし起票先はベース側**

ドキュメント整合の観点から Issue 化に値すると判断する（賛成）。理由と重要な補足:

- 賛成理由: この drift は「一度直せば終わり」ではなく **再適用のたびに必ず再発する構造的なもの**（apply-to-repo.sh が modules.yaml を無条件上書き・merge_modules_yaml.py の引き継ぎ対象が enabled:false のみ）。実行時参照ゼロでも、modules.yaml は「このリポジトリのモジュール構成の自己記述ドキュメント」であり、表示名が CLAUDE.md（「GitHub Issue Shortcut」）と恒常的に食い違う状態は docs-consistency 上、放置すべきでない。
- **補足（起票先の指定が本質）**: `tools/merge_modules_yaml.py` 自体が **ベース同期対象ファイル**（round 1 で確認済み: tools/ はベース clone とファイル集合が完全一致＝本ファイルもベース由来）。下流（本リポジトリ）で merge_modules_yaml.py にパッチを当てても **次回の再適用で上書きされて消える**。よって恒久対策 Issue は kai-kou/claude-code-base 側に起票し、`project:` セクション引き継ぎ実装 + UPDATE NOTES へのエントリ追記（記載ルール上、下流挙動が変わる変更は追記対象）までをスコープにすべき。下流側には追跡用の参照 Issue のみで足りる。
- project_guard の「実害なし・ブロッカーではない」判定には同意（concession 不要・同一結論）。

### 2. harness_auditor の「全項目問題なし」への検証 — 概ね支持、ただし 2 点

**(a) [nit・記録の正確性] 集計の自己矛盾**: 「settings.json に直接登録されていない **5スクリプト**」と書きながら、直後に列挙されているのは pre-git-push-check / pre-pr-create-check / stop-git-check / stop-pr-check / stop-slack-notify / stop-completion-report-check の **6 ファイル**。私の round 1 の実測（.claude/hooks/ = 18 .sh + lib/）とは「直接登録 12 + ルーター配下 6 = 18」で整合するので、**結論は正しく数詞のみ誤記**。ホワイトボードは合意形成の記録になるため、round 2 で「6」に訂正することを求める（severity: nit）。

**(b) [open question・要追加検証] settings.json 退避ファイルの扱いが両者とも未検証**: harness_auditor の検証は「settings.json の hooks 配列 vs 実ファイル」に限定されており、apply-to-repo.sh（本 PR で +215 行の大幅拡張）が生成しうる **退避・バックアップファイル**（例: `settings.json.bak` / `settings.json.base-backup` / `.claude/settings.json.orig` 類）が `.claude/` 直下にコミット混入していないかは、私の round 1（rules/hooks/skills のみ列挙）でも harness_auditor の投稿でも確認記録がない。106 ファイルの diff のうち私が確認したのは stat 末尾 60 行のみで、前半にこの種のファイルが含まれる可能性を否定する証拠を双方持っていない。**harness_auditor に `git diff origin/main..HEAD --name-only -- .claude/` の全件列挙（settings 退避ファイル・orchestrator-directive.txt 等の有無確認）を round 2 で要請する**。存在しなければ「検証済み・問題なし」に格上げでよい（現状は未検証項目であり「問題なし」とは別物）。

**(c) CLAUDE.md フック表の粒度について**: 私の round 1 で表と実ファイル 18 本の全対応を確認済み。ルーター配下ファイルを `/` まとめ表記する粒度は、harness_auditor が確認した settings.json の配線構造（router 経由ディスパッチ）と正確に対応しており、粒度の問題はない（見落としなし・支持）。

### 3. 自分の round 1 への追記なし

round 1 の判定（critical 0 / major 0 / minor 1）は維持。上記 (b) の結果次第で再評価する。
