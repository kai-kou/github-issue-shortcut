---
name: workflow-health-check
description: 開発・運用ワークフローの健全性を自動監査するスキル。パイプライン停滞・フック異常・スケジュールタスク失敗を検出して根本原因を特定・自動修正する。「ワークフロー監査して」「ヘルスチェックして」「/workflow-health-check」と依頼された時に使用する。週次の監査スロット（プロジェクト定義）で自動実行される。
effort: low
---

# workflow-health-check スキル

## 目的

開発・運用ワークフローの健全性を自動監査し、問題を検出したら根本原因を特定して自動修正する。
定期的なフロー改善サイクル（検出 → 修正 → 記録 → 再発防止）を自律的に継続する。

## 設計方針

- **自律的フロー改善**: 問題を検出するたびに根本原因を分析し、再発防止策を Issue に記録する
- **多層防御**: PR 健全性・Issue 状態・パイプライン整合性の 3 層で独立して監査
- **サーキットブレーカー**: 自動修正は安全な範囲に限定（ラベル変更・コメント・条件付きの PR クローズ〔例: 重複 PR かつ古い方のみ、コメント後 24h 経過など〕）。コード変更・マージ・削除は行わない
- **透明性**: 検出・修正の全アクションを GitHub コメント・Slack 通知で記録する

## トリガー

| モード | 実行タイミング | 実行内容 |
|--------|-------------|---------|
| **完全版**（`/workflow-health-check`） | 手動 or 週次の監査スロット（プロジェクト定義） | Step 1〜5 全て実行 |
| **軽量版**（`/workflow-health-check --light`） | 日次の衛生スロット（プロジェクト定義・project-sync 開始時） | Step 1〜2 のみ（PR健全性 + Issue状態） |

## 実行フロー

### ルールファイル読み込み（トークン最適化対応）

以下のルールファイルを `docs/rules/` から Read する（`.claude/rules/` から削除済みのため自動読み込みされない）。

- `docs/rules/{プロジェクト定義の成果物バリエーション判定ルール}.md`（あれば・例: 繰り返しコンテンツ判定ルール）
- `docs/rules/self-review-checklist.md`（過去のレビュー学習内容。旧 `self-review-learnings.md` は存在しないため参照しない）

---

### Step 1: PR 健全性監査

```
1-a: ベースブランチ検証
  └─ オープン PR の base ブランチが main またはプロジェクト定義の「正規ブランチ」（例: content/{ID}-*）か確認
  └─ base が「マージ済み feature ブランチ」（例: claude/add-xxx）の場合 → 警告 + コメント投稿

1-b: マージ可能性チェック
  └─ GitHub REST API の `mergeable_state` または GraphQL の `mergeStateStatus` を取得してマージ可能性を判定
  └─ mergeable_state / mergeStateStatus が dirty / unknown（コンフリクト or 判定不能）の PR を検出
  └─ コンフリクト有り → PR にコメント投稿（解消方法のガイダンス付き）
  └─ 48h 以上放置のコンフリクト → Slack 通知 + status:blocked ラベル付与

1-c: 放置 Draft PR 検出
  └─ 24h 以上更新のない Draft PR を検出
  └─ 作成者に「継続する場合は Draft を解除してください」コメント投稿

1-d: レビュー待ち PR 復帰
  └─ python3 tools/check_pending_pr_reviews.py --actionable-only を実行
  └─ needs_response → pr-review-watcher フローに復帰（指摘対応）
  └─ awaiting_review → 経過時間チェック → 催促 or 問題なし判定 → pr-review-watcher への引き継ぎ（自動マージは行わない）
```

### Step 2: Issue 状態監査

```
2-a: スタック Issue 検出（status:in-progress）
  └─ 最終更新から 4h 超の in-progress Issue を検出
  └─ コメント投稿: 「セッション中断の可能性。リセットします。」
  └─ status:in-progress → status:waiting-claude にリセット

2-b: パイプライン中断検出
  └─ 以下のような組み合わせを検出（各フェーズ間の整合性・プロジェクト定義）:
     - 先行フェーズ Issue が waiting-claude なのに後続フェーズ Issue が in-progress
     - 後続フェーズ Issue が waiting-claude なのに先行フェーズ Issue が未クローズ
  └─ 中断疑いの Issue に「前フェーズの完了確認を」コメント + Slack 通知

2-c: ラベル不整合検出
  └─ status: ラベルが 2 つ以上付いている Issue を検出
  └─ 最新の状態に合わせて余分なラベルを除去（古いラベルを削除）

2-d: 長期滞留 Issue 検出
  └─ status:waiting-user で 7 日以上更新なし → Slack メンション通知（1 Issue につき週 1 回まで）
  └─ status:waiting-claude で 24h 以上更新なし → status:waiting-claude のまま Slack 通知

2-e: 外部認証情報（Cookie / トークン）期限切れ検出（完全版のみ・プロジェクト定義）
  └─ 配信先（プロジェクト定義）の投稿に使う認証情報ファイル（例: ~/.{repo}/*_cookies.json）の最終更新日時を取得する
  └─ ファイル不在 → スキップ（クラウド環境で認証情報がない場合は正常）
  └─ 期限が近い（例: 最終更新から 25 日超）→ Slack 警告: 「⚠️ 認証情報の期限が近い可能性。再認証手順（プロジェクト定義）を実行してください」
  └─ 期限切れ疑い（例: 30 日超）→ Slack 緊急通知: 「🚨 認証情報期限切れの可能性。自動公開が失敗する場合があります」

2-f: 事前生成成果物のタイトル健全性チェック（軽量版でも実行・プロジェクト定義）
  └─ 配信先のドラフト（例: 記事 H1 / frontmatter）に管理用プレースホルダ（実タイトル未確定の管理タイトル）が
     残っていないか検知する（実タイトル確定済みなのに管理タイトル＝再発）。検査スクリプトはプロジェクト定義（例: tools/fix_*_titles.py --check）
  └─ exit 0（再発なし or 実タイトル未確定の過渡状態のみ）→ 何もしない
  └─ exit 1（実タイトル確定済みなのに管理タイトル）→ Claude が自律修正（CP-1・ユーザー確認不要）:
     プロジェクト定義の修正スクリプトを実行 → コミット & push → PR → 自動マージ。管理タイトルでの公開を未然に防ぐ

2-g: アナリティクス計測停滞検出（軽量版でも実行・プロジェクト定義）
  └─ プロジェクト定義の鮮度チェックスクリプト（例: tools/check_analytics_freshness.py --slack --auto-recover）を実行し、分析スナップショット（例: content/analytics/snapshots/）のファイル名の日付プレフィックスを取得
     （git checkout で揺れる mtime ではなくファイル名の YYYY-MM-DD を権威ソースとする）
  └─ 全配信先（プロジェクト定義）のうち最新ファイルが 7日超 → Slack WARN: 「⚠️ snapshots 7日超未更新。収集スクリプトの定期実行を確認してください」
  └─ 14日超 → Slack CRITICAL: 「🚨 KPI計測パイプライン停止。週次PDCAが CRITICAL 誤判定する可能性」
  └─ 24h 以内に同一 worst_status の通知を出していたら無音スキップ（重複抑制・throttle）
  └─ --auto-recover 指定時はプロジェクト定義の収集スクリプトを 1 回だけ手動実行して復旧を試み、成功したら鮮度を再評価して exit code・report を更新する（成功時は Slack に「自動復旧成功」を報告）
  └─ type:bug Issue の自動起票は本ステップのスコープ外（Slack 通知のみ。Issue 化が必要な場合は手動 or self-improvement-loop で対応）
```

### Step 3: パイプライン整合性監査（完全版のみ）

```
3-a: ブランチ孤立検出
  └─ 制作ブランチ（例: content/{ID}-*・プロジェクト定義）が存在するが、対応する Issue / PR がない場合 → Slack 警告
  └─ claude/* ブランチが 7 日以上前のコミットで止まっている → Slack 警告

3-b: 成果物整合性チェック（フェーズ構成はプロジェクト定義）
  └─ 先行フェーズ完了（PR マージ済み）なのに後続フェーズ Issue がない → 後続フェーズ Issue を自動作成
  └─ 並行フェーズが両方完了なのに次フェーズ Issue がない → 自動作成

3-c: 重複 PR 検出
  └─ 同一エンティティ ID + 同一フェーズ（例: [{ID}] {フェーズ名}）のオープン PR が複数存在 → Slack 通知
  └─ 古い PR（先に作成された方）に「重複の可能性」コメント + status:blocked 付与
```

### Step 4: 根本原因記録・再発防止（完全版のみ）

```
4-a: 問題パターン集計
  └─ 今週検出した問題を種別・頻度・影響範囲でサマリー化

4-b: retro-try Issue 自動生成
  └─ 同じ問題が 2 週連続で検出された場合 → type:retro-try Issue を作成（assignee:claude）
  └─ 例: 「ベースブランチ不整合が継続的に発生。PR 作成前チェックを強化する」

4-c: セルフレビュー学習ログ更新
  └─ P-XX / I-XX パターンに該当する新問題を docs/rules/self-review-checklist.md に追記提案
  └─ ルールファイルへの反映は commit + PR で行う（CLAUDE.md 直接変更は禁止）

4-d: 週次レポート生成
  └─ 以下の形式で Slack 通知（週次の監査スロットのみ・プロジェクト定義）
```

### Step 5: フィードバックループ健全性チェック（完全版のみ）

retro-try Issue の消化率・重複状況・パイプラインカバレッジを自動監査し、フィードバックループ自体を改善する。

```
5-a: retro-try Issue 消化率チェック
  └─ `type:retro-try` ラベルの Issue を全件取得（open + closed）
  └─ 消化率（closed / total）を算出
  └─ 消化率 50% 未満 → Warning（Slack 通知 + 改善提案）
  └─ オープン件数が 30 件超 → Warning（バックログ肥大化）

5-b: 重複 Issue 自動検出・統合
  └─ `type:retro-try` のオープン Issue を全件取得
  └─ タイトルからキーワードを抽出し、同一テーマの Issue グループを特定
     判定基準: 同じツール名・フィールド名（プロジェクト定義）、同じファイルパス、または同じ問題パターン
  └─ 3 件以上の同テーマ Issue が存在 → メイン Issue にコメント追記 + 残りを duplicate クローズ
  └─ 1 回の実行で統合するグループは最大 3 グループまで（サーキットブレーカー）

5-c: パイプライン別カバレッジチェック
  └─ 各パイプライン（プロジェクト定義）の retro-try Issue 件数を集計
  └─ 過去 7 日間にパイプライン PR がマージされたのにレトロスペクティブ Issue が 0 件 → Warning
     例: あるパイプラインの PR がマージされたが [Retro][{pipeline}] Issue が存在しない → レトロスペクティブ未実行の可能性
  └─ Warning の場合は Issue コメントまたは Slack 通知で報告

5-b2: waiting-user 重複 Issue 検出（完全版のみ）
  └─ status:waiting-user のオープン Issue を全件取得（バックログ分類〔例: ネタ候補・phase:1-*〕は除外）
  └─ タイトルの [{ID}] + フェーズキーワードで正規表現マッチし、同一エンティティ ID + 同一フェーズの Issue グループを検出
     例: 「[{ID}] {フェーズ名}: ...」が 2 件以上存在 → 重複候補
  └─ 検出した場合は Slack 通知のみ（自動クローズは禁止。ユーザー判断に委ねる）
     通知例: 「⚠️ waiting-user 重複 Issue を検出しました: {ID} {フェーズ名} が 2 件 → #{N1}, #{N2}」
  └─ 1 回の実行で通知するグループは最大 5 グループまで（サーキットブレーカー）

5-d: スケジュール最適化提案（自動実行なし・レポートのみ）
  └─ retro-try-handler の消化ペース（件/週）と生成ペース（件/週）を比較
  └─ 生成 > 消化 × 1.5 → 「retro-try-handler の実行頻度を上げることを検討」とレポート
  └─ 消化 > 生成 × 2 → 「実行頻度を下げてコスト削減可能」とレポート
```

### Step 6: CLAUDE.md / 常駐ルール肥大化監査（完全版のみ・P-7）

公式ベストプラクティス「CLAUDE.md が長すぎると Claude が半分無視する」（[best-practices](https://code.claude.com/docs/en/best-practices)）に基づき、CLAUDE.md と常駐ルール（`.claude/rules/` symlink 群）のトークン肥大化を監査する。**report-only（自動編集しない）** — 削除候補を提示するのみで、CLAUDE.md の編集はユーザー判断または別 Issue で実施する（rule-loading 構造変更のリスク回避）。

```
6-a: CLAUDE.md（プロジェクトの主要指示ファイル）行数チェック
  └─ wc -l CLAUDE.md を取得
  └─ 600 行超 → Warning（「肥大化。プルーニング or @import 分割を検討」）

6-b: プルーニング候補の提示（公式判定基準）
  └─ 各セクションについて「この行を消したら Claude がミスするか？」を自問
  └─ NO（= Claude が既に正しくやっている / 自明 / フックで強制済み）の行 → 削除 or hook 昇格の候補としてレポート
  └─ 重複記述（同一ルールが CLAUDE.md と docs/rules/*.md の両方に冗長定義）→ SSOT 化候補としてレポート

6-c: 常駐ルール合算サイズチェック
  └─ .claude/rules/ の symlink 先合算行数を集計
  └─ セッション開始時の自動読み込みトークン量として概算を report

6-d: @import 分割の提案（report-only・自動実行しない）
  └─ CLAUDE.md 内で「大きく・低頻度更新・独立性が高い」セクション（例: プロジェクト定義のドメイン詳細節）を検出
  └─ `@docs/...md` インクルードでの分割候補としてレポート（実装はユーザー承認後に別 PR。圧縮時保持挙動・symlink 運用への影響評価が必要なため自動適用しない）
```

> **安全方針（P-7）**: 本ステップは **監査・提案のみ**。CLAUDE.md の `@import` 分割や行削除は rule-loading 構造・セッション圧縮時保持挙動に影響するため、health-check では自動実行せず、検出結果を週次レポートに記載してユーザー/別 Issue の判断に委ねる。

### 週次レポートフォーマット

```
## 🔍 ワークフロー健全性チェック週次レポート

### 今週の検出サマリー
| カテゴリ | 検出件数 | 自動修正 | 要確認 |
|---------|---------|---------|--------|
| PR 健全性 | N件 | N件 | N件 |
| Issue 状態 | N件 | N件 | N件 |
| パイプライン | N件 | N件 | N件 |

### 自動修正した問題
- ✅ スタック Issue {N}件 → ラベルリセット
- ✅ ラベル不整合 {N}件 → 修正済み

### 要確認事項（ユーザーアクション必要）
- ⚠️ {問題の概要}: #{Issue番号 or PR番号}

### 検出された繰り返しパターン
- {パターン}: {今週N回目} → {対応中 or retro-try Issue #N に記録}

### フィードバックループ健全性（Step 5）
| 指標 | 値 | 判定 |
|------|-----|------|
| retro-try 消化率 | {closed}/{total} ({N}%) | OK / Warning |
| オープン件数 | {N}件 | OK / Warning（30件超で Warning） |
| 重複統合 | {N}グループ統合 | — |
| パイプラインカバレッジ | 各パイプライン:{N}（プロジェクト定義） | OK / Warning（0件で Warning） |
| 生成/消化バランス | 生成{N}件/週 vs 消化{N}件/週 | OK / 要調整 |

### 次週への改善アクション
- {type:retro-try Issue があれば一覧}
- {フィードバックループの改善提案があれば記載}
```

## 自動修正の安全範囲

| 操作 | 許可 | 理由 |
|------|------|------|
| ラベル追加・削除 | ✅ | リバーシブル |
| GitHub コメント投稿 | ✅ | 情報提供のみ |
| Slack 通知送信 | ✅ | 情報提供のみ |
| Phase 移行 Issue 作成 | ✅ | 漏れ補完 |
| retro-try Issue 作成 | ✅ | 記録のみ |
| 重複 retro-try Issue の duplicate クローズ | ✅ | メイン Issue にコメント追記後にクローズ（Step 5-b） |
| PR クローズ | ⚠️ 条件付き | 重複 PR かつ古い方のみ。コメント投稿後 24h 経過が条件 |
| コード変更・コミット | ❌ | セルフレビューまたはユーザーが対応 |
| PR マージ | ❌ | pr-review-watcher が担当 |
| Issue クローズ | ❌ | ユーザーまたは各パイプラインが担当（例外: 重複 retro-try の duplicate クローズは上記の通り許可） |

## Claude Code による実行手順

### 手動実行（完全版）

```bash
# workflow-health-check を手動で実行（全4ステップ）
# 「/workflow-health-check」または「ワークフロー健全性チェックして」で起動
```

### 軽量版（project-sync から呼び出し）

```bash
# project-sync の Step 0 として以下を実行（Step 1〜2 のみ）
# PR 健全性 + Issue 状態監査
```

### 実行コマンド例

MCP（クラウド・一次経路。repo スコープの `gh` はクラウドで 403・L-114。SSOT: `docs/rules/github-mcp-fallback-patterns.md`）:
```
# PR 健全性確認（ベースブランチ・マージ可能性）
mcp__github__list_pull_requests(owner, repo, state="open")

# スタック Issue 確認（in-progress かつ 4h 超）
mcp__github__list_issues(owner, repo, state="OPEN", labels=["status:in-progress"])

# ラベル不整合確認（status: が 2 つ以上）
mcp__github__list_issues(owner, repo, state="OPEN")
  → 応答の labels 配列を client-side で判定（status: 開始のラベルが 2 つ以上の Issue を抽出）

# ワークフロー実行状況の確認（gh run / workflow list 相当）
mcp__github__actions_list(method="list_workflow_runs", owner, repo)
mcp__github__actions_list(method="list_workflows", owner, repo)
```

ローカル環境（gh CLI 到達可能時）の代替:
```bash
# PR 健全性確認（ベースブランチ・マージ可能性）
gh pr list -R kai-kou/github-issue-shortcut \
  --state open \
  --json number,title,baseRefName,mergeable,isDraft,updatedAt \
  --limit 100 \
  --jq '.[] | {number, title, base: .baseRefName, mergeable, isDraft, updatedAt}'

# スタック Issue 確認（in-progress かつ 4h 超）
gh issue list -R kai-kou/github-issue-shortcut \
  --label "status:in-progress" \
  --state open \
  --json number,title,updatedAt \
  --limit 100

# ラベル不整合確認（status: が 2 つ以上）
gh issue list -R kai-kou/github-issue-shortcut \
  --state open \
  --json number,title,labels \
  --limit 200 \
  --jq '[.[] | select([.labels[].name | select(startswith("status:"))] | length > 1)] | .[] | {number, title, status_labels: [.labels[].name | select(startswith("status:"))]}'
```

## サーキットブレーカー

- **1 回の実行で作成する Issue は最大 5 件** まで（過剰なノイズ防止）
- **Slack 通知は同一 Issue につき 24h に 1 回まで**
- **連続失敗 3 回でスキップ**（API エラー等）: 「ヘルスチェック一時停止」を Slack 通知して終了
- **スタック Issue の自動リセットは 1 回の実行で最大 10 件** まで
- **重複 Issue の統合は 1 回の実行で最大 3 グループ** まで（Step 5-b）

## 統合先

| 実行タイミング | 統合先スキル | 実行モード |
|-------------|------------|----------|
| 週次の監査スロット（プロジェクト定義） | 週次管理ワークフロー（プロジェクト定義） | 完全版 |
| 日次の衛生スロット（プロジェクト定義） | project-sync（Step 0 として） | 軽量版 |
| 手動 | `/workflow-health-check` コマンド | 完全版 |

## 禁止事項

- PR のコードを自動的に修正してコミットしない
- マージ済みブランチを削除しない
- Issue を自動クローズしない（ユーザーまたは各パイプラインが担当）
- Slack 通知を 24h 以内に同一内容で重複送信しない
