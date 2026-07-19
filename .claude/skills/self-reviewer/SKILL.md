---
name: self-reviewer
description: PR作成前にセルフレビューを実行し、AIレビュアーが指摘しそうな問題を事前に検出・修正する。PR作成直前の最終チェックとして、「セルフレビューして」「PR前にチェックして」と依頼された時に使用する。内部で /code-review（Layer 1）を呼び出す上位フローであり、code-review 自体を置き換えるものではない。
effort: high
---

# PR 作成前セルフレビュースキル（汎用）

PR 作成前に問題を自分で検出・修正してレビュー往復を減らす。`pre-pr-create-check.sh` フックが
`tools/self_review_check.py` を呼ぶため、Error が残ると PR 作成自体がブロックされる。

> **🔴 レビューは Claude 自身のセルフレビューで完結する**: 外部 AI レビュアー（Copilot / Gemini）への
> 依頼は **行わない**。本スキル（Layer 0 機械チェック + 観点別セルフレビュー）に加え、PR 作成後に
> **`/code-review` スキル（Layer 1・必須）** を必ず実行する。構成の SSOT は `docs/rules/ai-reviewer-strategy.md`。

## トリガー条件

- PR 作成直前の最終チェック時
- 「セルフレビューして」「PR 前にチェックして」「レビューコスト下げたい」等の依頼時

## 実行フロー

### Step 0: 機械チェック（必須・最初に実行）

```bash
python3 tools/self_review_check.py

# .md を新規作成・修正した場合は CJK 半角スペースを必ず自動整形してから PR を作る
# （目視では大規模ドキュメントで必ず見落とし、AI レビュアーに同種指摘される・再発防止）
python3 tools/check_cjk_markdown.py --fix --changed
```

- Error（マージコンフリクト痕跡・巨大ファイル等）が残る限り PR 作成は禁止（フックでもブロック）
- Warning は修正するか、PR 説明文「設計意図・既知の警告」に理由を記載する
- **CJK 半角スペース Warning が出たら必ず `check_cjk_markdown.py --fix` で整形してから PR**
  （変更 .md がある PR では `--fix --changed` の実行を必須化する）
- プロジェクト固有のチェック項目は `docs/rules/self-review-checklist.md` に追記し、
  `self_review_check.py` に検査関数を足して機械化する（同一 PR でシートとランナーを更新）

### Step 1: 差分スコープの確認

```bash
git diff main...HEAD --name-only
```

- **タスク外のファイルが混入していないか**（「ついで」の変更は別 PR / 別 Issue に分離）
- 自動生成ファイル・state ファイルが意図せず含まれていないか
- 削除・リネームが意図どおりか

### Step 2: 変更内容のセルフレビュー（観点別）

| 観点 | 確認項目 |
|------|---------|
| **正確性** | ロジックの分岐網羅・境界値・null/空配列・例外処理。数値・単位・日付の整合 |
| **再利用 / 重複** | 既存関数・ユーティリティで代替できないか。コピペ重複がないか |
| **命名 / 可読性** | 周辺コードの命名・コメント密度・イディオムに合わせているか |
| **後方互換** | 既存の呼び出し元・スキーマ・API を壊していないか |
| **セキュリティ** | 秘密情報のハードコードがないか。入力バリデーション・コマンドインジェクション対策 |
| **エラー処理** | 例外を握りつぶしていないか（CP-6: 障害は調査して自律修正、握りつぶさない） |
| **テスト / 検証** | 変更を客観的な実行結果で証明できるか（`bash -n` / `py_compile` / テスト実行） |
| **スコープ超過（設計）** | リクエスト対象の実装内部で、1 箇所しか使わない汎用インターフェース・抽象化が追加されていないか（YAGNI） |
| **ドキュメント整合** | ルール・SKILL.md・README と実装が乖離していないか（desync 防止） |

### Step 3: コミット / ブランチ衛生

- 未コミット・未追跡ファイルがないこと（`git status` が clean）
- 未 push コミットがないこと（`git push -u origin <branch>` 済み）
- `main`/`master` 直接 push になっていないこと
- コミットメッセージが「何をしたか」を簡潔に表していること

### Step 4: `/code-review` セルフレビュー（Layer 1・必須）

PR 作成後に **`/code-review --comment` を必ず実行** する（Layer 1・全 PR 必須）。差分を「第三者の PR」
として読み直すフレッシュ文脈レビューで自己修正盲点（64.5%）を回避する。指摘は修正コミット or
スキップ理由の記録で解消してから自動マージする（`--fix` で作業ツリーへ直接反映も可）。

変更が大きい・影響範囲が広い場合は、加えてサブエージェント（`general-purpose` / `Explore`）を
並列起動して観点別レビューを依頼する（`docs/rules/agent-team-summary.md`）。
diff ≥300行 / `type:security` / `type:breaking-change` の PR は Layer 2（`discussion_review_trigger.py`）も起動する。
critical 指摘は修正必須（自動ゲート扱い）。**外部 AI レビュアー（Copilot / Gemini）への依頼はしない。**

**大規模改善の監査ゲート（PR 作成前チェック・SSOT `docs/rules/large-change-audit-rules.md`）**:
`python3 tools/large_change_audit.py check --diff-lines {N} --changed-files "{...}" --labels "{...}"` を実行し、
大規模改善と判定されたら **A. 議論型レビュー / B. 実機検証 / C. 新規挙動の専用テスト / D. 記録** をマージ前に
満たす計画を立てる。特に **C（新規挙動テスト）が差分に無ければ警告** し、PR 前に追加する（"既存グリーン" で
完了にしない）。免除（docs/ルール/ハーネスのみ・機械的変更）は理由 1 行を記録する。

## 出力

```
## セルフレビュー結果
- 機械チェック: PASS / FAIL（Error N 件）
- 差分スコープ: タスク内 / 混入あり（{ファイル}）
- 検出した問題: {観点}: {内容} → 修正済み / PR 説明に記載
- ブランチ衛生: clean / 要対応
→ PR 作成可否: GO / 修正してから再チェック
```

> プロジェクト固有のセルフレビュー項目（生成物のスキーマ検証・性能閾値・ドメイン品質ゲート等）は
> `docs/rules/self-review-checklist.md` に追記して育てる。
