---
name: self-improvement-loop
description: プロジェクト全体を定期的に横断レビューし、根本原因特定→改善Issue起票→最優先即実装→マージまで自律実行するセルフ改善オーケストレーター。発見（定期の N 観点横断レビュー）と消化（日次の改善Issue高速処理）の2モードで動く。「セルフ改善して」「横断レビューして」「プロジェクト改善して」「/self-improvement-loop」と依頼された時、またはプロジェクト定義の発見スロット / 日次消化スロットで自動実行する。
effort: medium
---

# self-improvement-loop スキル

## 目的

プロジェクト全体（プロジェクト定義の N 観点・例: パイプライン健全性・リポジトリ衛生・成果物品質・コードベース・戦略 等）を定期的に横断レビューし、**個別症状ではなくメタ根本原因** を特定して、改善Issueの起票から最優先課題の実装・マージまでを自律実行する。

ユーザーが状況を確認しに来なくても、**課題発見 → 改善実装 が定期的に回る** 状態を維持する（CP-6 Human-on-the-loop）。

## 設計方針：発見と消化の分離

| モード | 役割 | 頻度 | コスト |
|--------|------|------|--------|
| **発見モード** | N 観点の並列横断レビューで新規課題を発掘し改善Issueを起票 | 定期（プロジェクト定義の発見スロット） | 高（並列サブエージェント） |
| **消化モード** | 起票済み改善Issueを古い順・優先度順に高速消化 | 日次（プロジェクト定義の消化スロット） | 低〜中 |

**長期放置防止**: 発見（在庫生成）と消化（処理）を分離し、消化を日次・複数件で回すことで改善スループットを最大化する。改善Issueは作成後 **7日で必ず再評価**（project-sync が検出）。

## 既存スキルとの役割分担（重複実装しない）

- `workflow-health-check`: ワークフロー（パイプライン停滞・フック・スケジュール失敗）専門 → 発見モード Step 2 から呼び出す
- `project-sync`: Issue/PR 衛生・Orphan検出 → 発見モードは結果を参照
- `retrospective` / `retro-try-handler`: パイプライン単位の振り返り・Try消化 → 消化モードで連携
- 本スキルは上記を束ねる **オーケストレーター**。重複する監査は再実行せず結果を参照する。

---

## 発見モード実行フロー（定期・プロジェクト定義の発見スロット）

### Step 0: 前提チェック
```
- gh CLI 動作確認（which gh）。不在なら L-086 に従い session-start.sh の gh インストール成否を確認
- git log / project_state.md で現状把握
```

### Step 1: N 観点の並列サブエージェントレビュー
N 体を **1メッセージで並列起動**（model=sonnet 推奨・客観性重視）。各エージェントに自己完結プロンプト + 「強み2-3 / 重大問題3-5（根拠データ必須）/ 改善提案（優先度付き）/ 100点満点スコア」を 800字以内で要求する。

> **観点はプロジェクトで定義する**。下表は汎用テンプレート（プレースホルダ）。各プロジェクトは `docs/project-mission.md` の KPI・ドメインに合わせて観点・調査対象を差し替える（ミッション KPI・パイプライン・成果物品質・キャラ/トーン属性 等）。

| # | 観点（テンプレート） | subagent_type | 主な調査対象（プロジェクト定義） |
|---|------|--------------|------------|
| 1 | ミッション KPI・成長 | general-purpose | プロジェクト定義の分析データ（例: content/analytics/）, メタ情報 |
| 2 | パイプライン健全性 | general-purpose | .claude/skills/*pipeline*, lessons-core.md, discover系ツール, git log |
| 3 | リポジトリ衛生・PM | general-purpose | GitHub MCP（list_issues/PR・status別内訳・滞留日数） |
| 4 | 成果物品質・キャラ/トーン一貫性 | general-purpose | プロジェクト定義の成果物（例: ドメイン固有の検証項目・キャラ属性）, 検証スクリプト |
| 5 | 技術アーキ・コードベース | general-purpose | tools/（規模・重複・死蔵）, tests/, .github/workflows/, requirements |
| 6 | 戦略・利用者価値 | プロジェクト定義のレビュー役（Lv3） | 分析データ, リサーチ資料, 成果物一覧 |

### Step 2: メタ根本原因の特定
- N 観点の所見を統合し、**複数の症状にまたがる共通の根** を3層因果分析（直接/中間/根本）で特定する
- 「個別Issueの寄せ集め」ではなく「1つの根が複数症状を生んでいないか」を最優先で探す
- 必要なら裏取り（実機コマンド・grep）で根本原因を確定する

### Step 3: 改善Issue起票（重複チェック必須）
```
1. 既存オープンIssueを検索（gh issue list / search_issues）し、同一根本原因のIssueが無いか確認
2. 重複が無ければ起票:
   - title: feat:/fix:/improvement: {根本原因に対する対策}
   - labels: type:{feature/bug/improvement} + priority:{high/medium/low} + sp:{2/3/5}（small/medium/large 相当を写像・session-sprint-rules.md §3.3・必須）
   - body: 背景 / 根本原因(3層) / 対応方針 / 完了条件 / 再発防止
3. Issue乱発を避ける（1根本原因=1Issue・refinement の命名規約に準拠）
```

### Step 4: 最優先1件を即実装 → マージ
- priority:high かつ実装コスト小・効果大の1件を選ぶ
- status:in-progress 付与（CP-4 論理ロック）→ 実装 → 効果を実機検証 → コミット → PR → AIレビュー → 自動マージ
- L-086 等のレッスン記録が必要なら lessons に追記

### Step 5: 報告
- 特定した根本原因・起票Issue一覧・実装した最優先課題を Slack/完了報告で出力（L-076 アウトカム形式）

---

## 消化モード実行フロー（日次・retro-try-handler と連携）

```
1. 対象Issue取得:
   クラウド一次経路（repo スコープの gh は 403・L-114）:
     mcp__github__list_issues(owner, repo, state="OPEN", labels=["status:waiting-claude"], perPage=100)
   ローカル環境（gh CLI 到達可能時）の代替:
     gh issue list -R kai-kou/github-issue-shortcut --state open --limit 1000 \
       --label "status:waiting-claude" --json number,title,labels,milestone,updatedAt
   → type:improvement / type:bug / type:retro-try でフィルタし、priority ラベル順（high → medium → なし → low）でソート
     （同 priority 内の順序は下記タイブレークのみで決める。「古い順」は単独では適用しない）
   → **監査バックログ（プロジェクト定義のマイルストーン例: 「監査 P0〜P3」）**: 監査 Issue は
     priority ラベル（P0/P1=high・P2=medium・P3=low）とマイルストーンを起票時に付与済みのため、
     本ソートにそのまま乗る。**同 priority 内のタイブレークは以下の順序で一意に適用する**:
     1. 監査マイルストーン付き Issue を優先し、マイルストーン昇順（P0→P1→P2→P3）でソート
     2. プロジェクト定義の重み付け（例: lessons 高頻度指摘から算出した領域別ウェイト）があれば参照し、
        ウェイトが高い Issue 種別を優先
        （ユーザーが繰り返し重視してきた領域を自律的に先取りするための重み付け）
     3. 上記が同等の場合は作成日時の古い順を適用する

2. 上位 5件（priority:high → priority:medium → priority なし → priority:low → 各群内で上記タイブレーク）を選び、各々:
   - status:in-progress 付与
   - 実装コスト評価 → 小〜中なら実装 → PR → マージ
   - 大規模・曖昧なら設計をIssueコメントに記録し priority 据え置き（着手は次サイクル）
   - ※ in/out 均衡のため上限は 5件/回（refinement の生成ペース 3〜5件/日に対し消化 5件/日で均衡）。
     コスト上限内（時間/トークン）で完走できる範囲に留め、未完分は次サイクルへ持ち越す

3. 放置検出:
   - type:improvement / retro-try で7日以上 updatedAt が古いものを検出
   - サーキットブレーカー: 3サイクル試行しても進まないものは status:blocked + 理由コメント

4. 報告: 消化件数・残数・放置検出結果（**在庫増加率 vs 消化率**を明記）:
   - 当日 created（status:waiting-claude 付与）件数 = in flow
   - 当日 closed もしくは status:waiting-claude 解除 件数 = out flow
   - out < in が3日続く場合は CP-3 衛生アラートとして発見モードにエスカレーション
```

---

## サーキットブレーカー / 安全装置

- 1課題あたり修正サイクル2回超で STOP → Issueコメントに状況記録（session-safety-rules.md）
- 発見モードのコスト上限意識: N 観点並列は重いため発見スロットを限定（プロジェクト定義の頻度）
- main直接push禁止・PR経由のみ（CP-6 境界外リスト遵守）

## トリガー

| モード | 実行タイミング |
|--------|-------------|
| 発見（完全版） | プロジェクト定義の発見スロット / `/self-improvement-loop` / 「横断レビューして」 |
| 消化（軽量版） | 日次の消化スロット / `/self-improvement-loop --consume` / 「改善Issue消化して」 |
