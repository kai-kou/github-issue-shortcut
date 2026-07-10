# 議論ホワイトボード運用ルール（Blackboard パターン）

> 専門チームに **役割分担型 fan-out ではなく敵対的相互レビュー（議論）** をさせ、各エージェントが
> 共有ドキュメントに自由記載して議論の整理 + 履歴を git 管理するための共通ルール。
>
> **本ルールは「タスク依存」**（全セッション常駐＝ESSENTIAL_RULES には入れない）。議論型レビューを
> 実装・実行・レビューする時にだけ Read する。各スキルの SKILL.md に「作業前に本ルールを Read」を記載する。
>
> 関連: `docs/rules/dynamic-workflows-rules.md`（WF主導の土台）・`docs/rules/agent-team.md`（並列プリミティブ）。

---

## 1. 背景：なぜ「ホワイトボード」か

多くのプロジェクトの専門チームレビューは **役割分担型 fan-out**（各エージェントが独立評価 →
メインが集計）で、エージェント同士が **互いの意見を読んで反論・検証する「議論」をしていない**。

Anthropic 自身のマルチエージェント研究システムは **artifact パターン**（サブエージェントが
共有ファイルシステムに findings を書き、相互に読み合う）+ **Blackboard（黒板）パターン** で
協調しており、これは「逐次調査のアンカリング（最初の仮説に引っ張られる）」を避けて
**相互に否定し合った末に残った結論の方が真の根本原因に近い** という利点がある（公式 deep-research の
adversarial 検証と同根）。

> 出典: [How we built our multi-agent research system（Anthropic）](https://www.anthropic.com/engineering/multi-agent-research-system) 、
> [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)（competing hypotheses 例の "Update the findings doc"）。

本ルールはこの findings doc を **git 管理の Markdown ホワイトボード** として実装し、議論の整理 + 履歴を
プロジェクトで永続管理する。

---

## 2. 実装（同時書き込み破損の構造的排除）

`tools/discussion_whiteboard.py` が基盤。**各エージェントは個別のユニークファイルに投稿（post）し、
orchestrator だけが集約（render）する** ことで、同一ファイルへの同時書き込み破損
（[claude-code Issue #29217](https://github.com/anthropics/claude-code/issues/29217)）を構造的に防ぐ。

```
content/discussions/<id>/
  meta.json          … 議題・参加者・論点
  entries/           … 1 post = 1 ユニークファイル（並列 post でも衝突しない・atomic write）
    r01_<ns>_<pid>_<rand>_<author>_<kind>.md
  whiteboard.md      … render が集約する人間可読ビュー（git 履歴 = 議論履歴）
```

### コマンド

| コマンド | 誰が | 用途 |
|---------|------|------|
| `init <id> --topic --participants --brief` | orchestrator | 議題作成（冪等） |
| `post <id> --author <name> --round <n> --kind <種別> --body/--body-file` | 各エージェント | 投稿（**並列安全**） |
| `render <id>` | orchestrator のみ | entries を whiteboard.md に集約（**単一書き手**） |
| `list <id> [--round N] [--json]` | 任意 | 投稿一覧 |
| `show <id>` | 任意 | whiteboard.md 表示（他者の意見を読む） |

### 投稿種別（kind）

`claim`（主張）/ `evidence`（根拠）/ `rebuttal`（反論）/ `question`（問い）/ `concession`（譲歩）/
`consensus`（合意）/ `verdict`（判定）/ `note`（メモ）。

### 厳守事項

- **whiteboard.md を直接編集しない**（必ず `post` 経由）。render が上書きするため直接編集は失われる。
- **render は orchestrator（lead）だけが呼ぶ**（複数書き手にしない）。
- 各エージェントは投稿前に `show` で他者の意見を読み、**相手の具体的な指摘に対して反論/譲歩する**
  （独立感想の垂れ流しは「議論」ではない）。

---

## 3. 議論の進行（標準フロー）

`tools/run_discussion_review.py`（WF主導オーケストレーター）が `claude -p` でこれを駆動する。

```
init（議題作成）
  → ラウンド1: 各専門家が自分のレンズで claim/evidence を post（並列・独立）
  → render
  → ラウンド2: 各専門家が他者の投稿を読み rebuttal を post（敵対的相互検証）
  → render
  → 合意: lead が対立点/合意点を整理し consensus + verdict を post
  → render（締め）
  → whiteboard.md を git コミット（= 議論履歴の永続化）
```

- ラウンド数は議題の難度に応じて増やしてよい（既定 2）。
- **critical は「議論を経ても残った真の問題」のみ** に絞る（相互検証で否定された指摘は除外）。これが
  fan-out 版に対する品質的優位（過剰指摘・誤検知の削減）。

---

## 4. 実行基盤（claude -p 経由・実機検証済み）

- ハーネスのメインセッションには `Workflow`/`TeamCreate`/`SendMessage` が **非露出** だが、
  **Bash から `claude -p` サブプロセスを起動すると使える**（`run_deep_research_workflow.py` と同経路）。
- 公式 Dynamic Workflows の `.js` は **API 非公開** かつ「**スクリプト自体は fs/shell に触れない**（エージェントが
  読み書きする）」制約があるため、手書き `.js` は採らず、`claude -p` の lead に **ラウンド進行を指示** して
  Workflow/Agent ツールを内部活用させる（= WF主導の実体）。
- ⚠️ **`claude -p` は cwd=リポジトリで起動しない**。子セッションの SessionStart フック
  （`git clean -fd` / `git checkout`）が未コミットの作業を破壊するため（L-100 と同根）。
  `run_discussion_review.py` は **cwd=一時ディレクトリ** で起動し、リポジトリへは **絶対パス** で読み書きさせる。
- Agent Teams の peer-to-peer は headless で **lead 早期終了・teammate 早期離脱の競合** が出る（実機確認）。
  そのため議論の永続化は **メッセージではなくホワイトボード（artifact）に寄せる**。SendMessage は
  「更新したから反論して」等の生シグナルの補助に留める。

---

## 4.5 コスト最適化（model mix）

議論型レビューは lead + 参加者分のトークンを消費し、**大型入力（長尺ドキュメント等）× 複数ラウンドで
コストが嵩む**。以下の最適化で **検知精度を落とさずコストを削減** できる。

| レバー | 方針 | 効果・根拠 |
|--------|------|-----------|
| **model mix** | **機械的判定** のレンズ（文字数・表記ゆれ・数字変換・URL有無等）は `claude-haiku-4-5`、**判断重視** のレンズ（構成・演出・専門家監修・lead 合成）は `claude-sonnet-5` | haiku 化しても検知精度は低下しにくい。fan-out 設計の model 割当と一致 |
| **round2 再読抑制** | 各レンズに「round2 は対象を再読せず round1 の自分の分析とホワイトボード（`show`）のみで反論する」と明記 | 大型入力の再読トークンを削減 |
| **ラウンド数** | 既定 2（独立→反論）。軽微な対象は `--rounds 1` も可だが、反論ラウンドが過剰指摘削減の核なので原則 2 を維持 | — |

**設計原則**: スペックの各 participant に `model` を指定し、**そのレンズが「機械的検証」か「判断・創造」か**
で haiku/sonnet を割り当てる。lead（synthesizer）は統合判断のため sonnet を維持する。

---

## 5. ガードレール

1. **フォールバック**: 議論型レビューが失敗（EXIT≠0・verdict 抽出不可）したら、**既存の fan-out レビュー
   経路へ自動退避** する（`dynamic-workflows-rules.md` §5-1 と同方針）。サイレントフォールバック禁止（ログに残す）。
2. **予算**: `claude -p` は lead + サブエージェント分のトークンを消費する。サブスク経路（既定・追加 $ ゼロ）を
   使い、API 従量経路時は `--max-budget-usd` で上限を付ける（`DISCUSSION_USE_SUBSCRIPTION=0` で従量モード）。
3. **監修ゲート**: プロジェクト定義のキャラクター/専門家オブザーバーを参加者に含める場合、設定逸脱・技術誤りの
   指摘は **自動ゲート扱い** にする（CLAUDE.md サブエージェントルール準拠）。
4. **議題 ID 規約**: プロジェクトの命名規約に沿った一意な ID（例: `<対象ID>-<用途>` や `<スキル>-<日付>`）。
   git 管理されるため使い捨て議論は作らない（残す価値のある議論のみ）。
5. **状態記述の同期（L-094 desync 防止）**: スペック（participants/lens）を変えたら、対応する
   SKILL.md の記述も同一 PR で更新する。

---

## 6. スキルからの使い方

各スキルは「議論スペック JSON」を用意し、ドライバーに渡す:

```bash
python3 tools/run_discussion_review.py \
  --id <議題ID> \
  --spec <スキル>/discussion_review_spec.json \
  --targets "<対象パス,...>" --rounds 2
```

スペック形式は `tools/run_discussion_review.py` の docstring と
`tools/discussion_specs/example_debate.json`（最小例・タブ vs スペース討論で動作検証可能）を参照。

---

## 7. 参照

| ドキュメント | 関係 |
|------------|------|
| `tools/discussion_whiteboard.py` | ホワイトボード基盤（init/post/render/list/show・--self-test） |
| `tools/run_discussion_review.py` | WF主導オーケストレーター（claude -p で議論を駆動） |
| `tools/discussion_specs/example_debate.json` | 最小スペック例（動作検証用） |
| `docs/rules/dynamic-workflows-rules.md` | WF主導の土台・ガードレール |
| `docs/rules/agent-team.md` | 役割分担型 fan-out（議論型と使い分ける既存並列プリミティブ） |
