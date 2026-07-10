---
name: improvement-groomer
description: 溜まった改善 Issue（type:improvement）を一括棚卸し（grooming）するスキル。集計・カテゴライズ・重複統合・優先度/SP 補完・Epic 化を自律実行する。「改善Issueを精査して」「改善バックログを棚卸しして」「improvement を整理して」「Epic化して」「改善Issueを集計・カテゴライズして」「改善バックログが溜まってきた」等と依頼された時、または type:improvement が滞留（30件超）した時に必ず使う。self-improvement-loop（起票・実装）や project-sync（衛生）とは別レーンで、"溜まった改善Issueの整理判断" を専門に担う。
effort: medium
model: inherit
---

# improvement-groomer — 改善 Issue 棚卸しスキル

> **目的**: 溜まった `type:improvement` Issue を定期的に棚卸し（grooming）し、「データなき量産」状態を解消する。集計・カテゴライズ・重複統合・優先度補完・Epic 化を自律実行し、消化（実装）に渡せる整然としたバックログを維持する。

## なぜ専用スキルなのか（責務境界）

改善 Issue のライフサイクルは「起票 → **整理** → 実装」だが、中央の **整理（grooming）** だけ既存スキルの守備範囲外になりやすい。手動の断捨離 Epic が繰り返し作られるのがその兆候。本スキルがそのすき間を埋める。

| スキル | 担当 | 本スキルとの違い |
|--------|------|----------------|
| **self-improvement-loop** | 改善 Issue の **起票**（発見モード）・**実装**（消化モード） | 起票も実装もしない。溜まった山の **整理判断** だけを行い、最優先を消化モードへ渡す |
| **project-sync** | リポジトリ **衛生**（Stale/Orphan/Abandoned・ラベル整合）。機械的 | 重複統合・優先度・Epic 境界という **判断** を伴う。機械処理では担えない |
| **project-manager** | Issue/Milestone の個別 CRUD（手動起動） | 個別作成でなく **一括棚卸し**。分析レポート駆動 |
| **@owner（PO）** | `priority:`/`sp:` ラベルの **決定** | @owner を **呼び出して** 判断を仰ぐ側。棚卸しのワークフロー本体 |

## 2 層構成

project-sync スキルと同じ「コード（重い処理）＋ Claude（判断）」の 2 層で動く。

- **`tools/triage_improvements.py`（コード・副作用なし）**: 全 `type:improvement` を取得 → 集計・カテゴリ分類・重複検出・priority/sp 欠損検出・Epic 候補抽出 → JSON / Markdown レポート出力。**Issue を変更しない（読み取り専用）**
- **本 SKILL.md（Claude の判断）**: レポートを読み、@owner と連携して優先度を補完し、重複クローズ・Epic 統合を実行する

## 実行フロー

### Step 0: ロック取得（CP-4）

棚卸しは Issue 群を変更するため、まず作業 Issue を 1 件（`feat: 改善Issue棚卸し YYYY-MM-DD` 等）作って `status:in-progress` を付与するか、ユーザー指示由来の既存 Issue にロックを取る。スケジュール起動時は重複起動防止のため直近の棚卸し Issue がオープンでないか確認する。

### Step 1: レポート生成（コード）

```bash
python3 tools/triage_improvements.py --out /tmp/groom_report.md   # Markdown
python3 tools/triage_improvements.py --json > /tmp/groom.json     # 機械処理用
```

レポートに含まれるもの:
- **集計**: priority / sp / 監査フェーズの分布
- **カテゴリ別件数**: 監査タグ（`[監査PX/DOMAIN-NN]`）優先、なければキーワードクラスタ（ハーネス/ルール/スキル/ツール/CI 等の汎用カテゴリ）
- **Epic 統合候補**: 同一カテゴリに `--epic-threshold`（既定 6）件以上集中したもの
- **重複/酷似**: ① 監査ドメインコードの重複 ② タイトルトークンの Jaccard 類似度 ≥ 0.6
- **ラベル欠損**: priority / sp 未設定の Issue 一覧（Epic は除外）

レポートを読み、件数の多寡・滞留・偏りを把握する。stdout に短く現状サマリーを出す。

### Step 2: @owner（PO）連携で優先度・SP を補完

ラベル欠損 Issue（`missing_priority` / `missing_sp`）について、`@owner` を **PO として** 呼び出し、`priority:` と `sp:` の妥当値を判断してもらう。@owner は `mcp__github__issue_write` で `sp:`/`priority:` ラベルを直接付与できる（`session-sprint-rules.md` §4・ホワイトリストは `sp:`/`priority:` のみ）。

```
@owner（参加レベル Lv2）への依頼例:
「改善バックログ {N} 件のうち priority/sp 未設定が {M} 件。
 レポート（/tmp/groom_report.md）を見て、各 Issue に priority:/sp: を付与してほしい。
 基準: priority はミッション貢献度（CP-5）、sp は session-sprint-rules.md §3.1。」
```

- SP の基準は `docs/rules/session-sprint-rules.md` §3.1（複雑性 × レビュー負荷 × リスク）・§3.2（工程別標準）
- priority の基準は CP-5 ミッション（`docs/project-mission.md` の KPI 直結度）

### Step 3: 重複・陳腐化の処理（自律実行）

レポートの `duplicates` と、各 Issue の現状を踏まえて判断する。**CP-6 に則り明白なものは自律実行**:

| 判定 | アクション |
|------|-----------|
| **明白な重複**（同一監査コード・酷似タイトルで内容も同一） | 新しい/情報量の少ない方を `mcp__github__issue_write`（state=closed・`duplicate_of` 指定）でクローズし、残す側に集約コメント |
| **陳腐化**（既に実装済み・前提が消滅・他 Issue で解決済み） | 確認のうえクローズ（理由をコメント）。**仕様・実装状況は必ず grep / コード確認してから** 判断する |
| **判断が割れる**（重複に見えて切り口が違う等） | クローズせず、両 Issue に相互リンクコメントのみ |

> 自律クローズの境界: 内容の同一性に確信が持てる場合のみ。少しでも切り口が異なれば残す（消し過ぎより取りこぼしを許容）。

### Step 4: Epic 統合（自律実行）

`epic_candidates`（同一カテゴリ集中）について、近接テーマを束ねる **追跡 Epic を自動生成** する。

- Epic Issue を `mcp__github__issue_write`（create）で起票。タイトル `[Epic] {カテゴリ}: 改善バックログ統合追跡（{N}件・YYYY-MM-DD）`
- 本文に子 Issue 一覧（`- [ ] #NNNN タイトル`）と統合の意図を記載
- 子 Issue 群はクローズせず **残す**（Epic は実装単位でなく追跡単位）。子に `mcp__github__sub_issue_write` で紐付けられる場合は紐付ける
- Epic 自体には `type:improvement` ＋（@owner 判断で）`priority:`/`sp:` を付与

> Epic 化の目的は「散らばった同種改善を1つのビューで追える」ようにすること。実装は子 Issue 単位で self-improvement-loop 消化モードが進める。

### Step 5: 棚卸しサマリーの記録 + 最優先の受け渡し

1. 棚卸し結果（処理した件数・クローズ数・新規 Epic・優先度補完数）を **作業 Issue にコメント記録** する（チャットでの逐次報告は不要・サイレント運用に準ずる）
2. レポートから **最優先 1 件**（priority:high かつ即実装可能なもの）を選び、self-improvement-loop 消化モードへ渡す（即実装するか、`status:waiting-claude` のまま次スロットに委譲）
3. 生成レポートをリポジトリに残す場合は `content/analytics/grooming/YYYY-MM-DD.md`（プロジェクトのレポート保管規約に合わせる）に置き、ファイル変更があれば PR 化

## 自律度と境界（CP-6）

| 自律実行してよい | ユーザー確認が必要（A-1〜A-6 のみ） |
|----------------|--------------------------------|
| 明白な重複・陳腐化の Issue クローズ | （該当なし。棚卸しは境界外に当たらない） |
| 近接カテゴリの Epic 自動生成・統合 | 新規 **マイルストーン** の追加（A-5）→ @owner 経由で確認 |
| @owner による priority:/sp: 付与 | — |
| 棚卸しサマリーの Issue 記録 | — |

`status:*` ラベルの操作は @owner ではなくメインアシスタントが行う（@owner は `sp:`/`priority:` のみ・PO 権限境界 §4.1）。

## トリガー

- 「改善Issueを精査/棚卸し/整理して」「Epic化して」「改善バックログ集計して」等の明示依頼
- `type:improvement` が 30 件超滞留したのを検知したとき（self-improvement-loop 消化モードが「数が多すぎて選べない」状態になる前の整理）
- 月次の棚卸しスロット（スケジュール運用に乗せる場合はルーティング表に追記）

## 禁止パターン

```
❌ レポートを見ずに勘でクローズ・Epic 化する（必ず triage_improvements.py のデータに基づく）
❌ 切り口が少しでも違う Issue を「重複」として消す（取りこぼし優先・残す）
❌ priority/sp を @owner を通さずメインが恣意的に決める（PO は @owner）
❌ 子 Issue を Epic 化と同時にクローズする（Epic は追跡単位・子は実装まで残す）
❌ status:* ラベルを @owner に操作させる（§4.1 違反）
✅ ツールで可視化 → @owner で優先度 → 明白な重複/Epic は自律処理 → サマリー記録
```

## 関連ファイル

| ファイル | 役割 |
|---------|------|
| `tools/triage_improvements.py` | 集計・分類・重複検出・Epic 候補抽出（副作用なし） |
| `docs/rules/session-sprint-rules.md` | SP 基準（§3）・PO=@owner（§4） |
| `docs/rules/user-confirmation-minimization.md` | A-1〜A-6 既約境界外（§1） |
| `.claude/skills/self-improvement-loop/SKILL.md` | 起票（発見）・実装（消化）。本スキルは中央の整理を担う |
| `.claude/skills/project-sync/SKILL.md` | リポジトリ衛生（重複しない別レーン） |
| `.claude/agents/owner.md` | PO ロール定義（priority:/sp: ホワイトリスト） |
