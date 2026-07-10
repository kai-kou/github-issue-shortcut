# AIレビュアー戦略（FAIR 構成 SSOT）

> `pr-review-flow.md` / `pr-review-flow-summary.md` / 各パイプライン SKILL.md のレビュー呼び出しは本方針に従う。
> 意思決定経緯は `docs/proposals/claude-only-autonomous-review.md` を参照。

> **🔴 外部 AI レビュアーへの依頼は廃止（飼い主決定・本タスク）**: **Copilot へのレビュー依頼（`mcp__github__request_copilot_review` / `gh pr edit --add-reviewer @copilot`）は行わない。** Gemini も 2026-07-17 で廃止済み。レビューは **Claude 自身が `/code-review` スキルで必ず実行するセルフレビュー（Layer 1）を主軸** とし、外部レビュアーの応答を待たない。外部従量レビューに依存しないことで 25 分待ちを解消し、コストをサブスク枠内に収める。

## FAIR（Fresh-context Adversarial In-session Review）

| Layer | 役割 | コスト | ステータス |
|-------|------|--------|-----------|
| **Layer 0 機械ゲート** | `self_review_check.py`（`scan_dangerous_patterns.py` 含む）/ `check_cjk_markdown.py` / lint / test | ゼロ | ✅ 全 PR 必須 |
| **Layer 1 CCR セルフレビュー（主軸）** | **`/code-review` スキル**（対話セッション内の新規文脈レビュー）を **必ず実行**。差分を「第三者の PR」として読み直し自己修正盲点 64.5% を回避。`--comment` で指摘を PR に記録、`--fix` で作業ツリーに反映可 | ゼロ（サブスク枠内） | ✅ **全 PR 必須（依頼ではなく自己実行）** |
| **Layer 2 敵対的多観点議論** | `run_discussion_review.py` + `discussion_specs/code_review.json`（4 観点・敵対 rebuttal）。`tools/discussion_review_trigger.py` で自動起動 | ゼロ | ✅ 条件付き必須（diff ≥300行 または `type:security`/`type:breaking-change` ラベル時）|
| **Layer 3 外部独立レビュー** | `anthropics/claude-code-security-review` Action / `/ultrareview` 等。**Copilot・Gemini は使わない。** 高リスク差分のみ任意で起動（手動・非ブロッキング） | 従量（高リスク時のみ） | ⚪ 任意（高リスク差分のみ・外部 AI レビュアー依頼は除く） |
| ~~Copilot~~ | レビュー依頼を廃止（本タスク） | — | ❌ 不使用 |
| ~~Gemini Code Assist~~ | 2026-07-17 廃止済み | — | ❌ 停止 |

> **Layer 0+1 通過で即マージ可**（Layer 2 は条件付き必須）。外部 AI レビュアー（Copilot/Gemini）の応答待ちは存在しない。
> 同一 Claude モデルの系統的誤り（~60%）は Layer 2 の敵対的議論と、高リスク差分での Layer 3（security-review Action 等）で吸収する。

### Layer 3 起動判断の機械シグナル（#53）

`tools/detect_pr_diff_type.py`（既存の code/data 判定と同一ツール。Layer 2 の起動判断自体は
`tools/discussion_review_trigger.py` が独自に行う別ロジックであり、本ツールを呼び出すわけではない）は
`high_risk` フィールドで Layer 3 起動検討シグナルを返す。
認証/秘密情報関連パス・公開API/スキーマ/DB関連パス・フック/CI/権限境界（`.claude/hooks/` / `.github/workflows/` / `.claude/settings.json` / `.mcp.json`）の変更・差分行数（500行以上）/ファイル数（20件以上）のいずれかで `true` になる。
マージをブロックしない任意シグナルであり、`--risk-only` で `true`/`false` のみ取得できる。

```bash
python3 tools/detect_pr_diff_type.py --risk-only   # true/false のみ
```

`high_risk=true` を検出したら、Layer 3（`claude-code-security-review` Action 等）の手動起動を検討する。

## Layer 2 自動トリガー（Issue #97）

`tools/discussion_review_trigger.py --pr {PR番号}` を PR 作成後に呼び出すと、
以下の条件を満たす PR に対して自動的に Layer 2 レビューを起動する。

| 条件 | 閾値 |
|------|------|
| 差分行数（追加 + 削除） | ≥ 300 行 |
| PR ラベル | `type:security` または `type:breaking-change` |

条件を満たさない PR は Layer 0 + Layer 1（`/code-review` セルフレビュー）のみで対応する（Layer 2 スキップ）。
Layer 2 失敗時は stderr に警告を出力し、Layer 0+1 で継続する（フォールバック禁止でなくサイレント禁止）。

## マージ可否の判定（外部レビュアー非依存）

- **Layer 0（機械ゲート）+ Layer 1（`/code-review` セルフレビュー）の通過で即マージ可。** 外部 AI レビュアーの応答を待たない（25 分タイムアウトの待機は発生しない）。
- Layer 1 は「依頼して待つ」ものではなく、PR 作成と同一セッションで Claude 自身が `/code-review` を実行して完結させる。検出された指摘は修正コミット or スキップ理由を記録してから自動マージする。
- 条件付きで Layer 2（敵対的議論）が必要な PR は、Layer 2 の verdict も解消してからマージする。

## 関連

- [#97] Layer 2 定常化 / [#2485] Gemini 廃止に伴う代替設計 / [#49] Claude 単独 FAIR への移行決定 / 本タスク（Copilot 依頼廃止・`/code-review` セルフレビュー必須化）
- `tools/discussion_review_trigger.py` / `tools/discussion_specs/code_review.json`
- `docs/rules/pr-review-flow.md` / `docs/rules/pr-review-flow-summary.md`
