<!--entry
author: project_guard
round: 2
kind: rebuttal
ts: 2026-07-14T08:20:13+09:00
-->

## project_guard — Round 2（rebuttal / 部分的 concession）

### 1. docs_consistency の minor「public_readiness_audit.json は下流で実行不能な spec」への応答 — 判定は支持、ただし対処方法に反論

**concession（実害判定に同意）**: プロジェクト保護の観点でも実害なしの判定は正しい。根拠:
- 当該 JSON は **不活性データ**（自動実行されるフック・スケジュールに配線されていない）。実行には
  `run_discussion_review.py --spec` での明示指名が必要で、その場合も `--targets` のファイル不在で
  即時 fail-fast する（サイレントに誤動作してアプリ資産へ波及する経路がない）。
- 私の Round 1 の秘密情報 grep でも当該ファイルに漏洩相当の内容はなし。cosmetic・non-blocking に同意。

**rebuttal（「同期対象から外すべきか」の実装方向に異議）**: 「下流（本リポジトリ）で削除して同期対象から
外す」対処は **推奨しない**。理由は私が Round 1 で指摘した `project.name` drift と同一メカニズム:
`apply-to-repo.sh` は modules.yaml とモジュール資産をベース最新版で上書きし、下流側の削除は
`merge_modules_yaml.py` の引き継ぎ対象（enabled:false のみ）に含まれない。しかも今回の同期で
`agent-teams` モジュールの `tools:` 列挙に `discussion_specs/public_readiness_audit.json` が **明示追加**
された（Round 1 §3 で確認済み）ため、下流で消しても **次回再同期で必ず復活** する。恒久対処は
**ベース側**（kai-kou/claude-code-base）で「ベース自己参照専用 spec を配布対象から外す/別ディレクトリへ
隔離する」しかない。棚卸し Issue を起票するなら **宛先はベースリポジトリ**（または apply-base スキルの
除外リスト拡張）と明記すべき。本 PR での対応は不要（現状維持が正しい）という結論は docs_consistency と一致。

### 2. harness_auditor の検証で拾えていないプロジェクト固有リスク — minor 1 件を追加提起

harness_auditor の 4 項目（配線一致・順序・構文・symlink 同期）は網羅的で異議なし。ただし同レンズが
「配線が正しいか」に留まり「**その配線が何を許可するか**」を評価していない点を補完する:

- **[minor・watch item] `permission-request-auto-allow.sh`（本 PR 新規）は `.claude/` 配下の
  Read/Write/Edit/NotebookEdit を自動許可する。** `.claude/` 配下には `settings.json`（フック・権限の
  配線そのもの）が含まれるため、字義どおりなら「権限設定ファイル自体の編集を無確認で許可する」
  自己書き換え面が開く。アプリ資産（src/ 等）はスコープ外であり、かつ main 直 push 禁止 +
  PR レビューという既存ゲートは維持されるので critical ではないが、`settings.json` /
  `settings.local.json` を auto-allow の **除外パターン** にできないかは検討価値がある
  （ベース側改善候補。本 PR のブロッカーではない）。なお私は対象ファイルを再読していないため、
  同フックが既に settings 系を除外している可能性は否定しない — Round 3 または後続 Issue で
  harness_auditor に除外有無の確認を委ねたい。

### 3. 自分の Round 1 指摘の維持

- modules.yaml `project.name` drift（minor）は両者から反論なし。維持する。恒久対策の宛先は
  §1 と同じくベース側（`merge_modules_yaml.py` の `project:` セクション引き継ぎ）で、
  public_readiness_audit の棚卸しと **同一 Issue に束ねられる**（どちらも「apply-to-repo の
  上書きが下流カスタマイズ/下流不要資産を保存しない」という同根の問題）。
- docs_consistency の申し送り「injected context の CLAUDE.md が旧版」は、私の Round 1 §2
  （ディスク上の CLAUDE.md はプロジェクト名・ペルソナ維持のうえ最新化済み）と整合。支持する。

**総合**: 判定変更なし（critical 0 / major 0）。minor 合意 2 件（project.name drift・
public_readiness_audit 棚卸し→ともにベース側 Issue に束ねて起票を推奨）+ 新規 watch item 1 件
（auto-allow の settings 系除外有無の確認）。本 PR 自体はプロジェクト保護レンズで承認可能。
