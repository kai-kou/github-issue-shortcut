---
name: research-runner
description: Deep Research を完全自動実行するスキル。ネイティブ `/deep-research`（クラウド環境でも直接実行可能・Opus orchestrator）を主エンジン、Gemini Deep Research Max を第2、DIY（Sonnet 5 + WebSearch）を最終フォールバックとして、`content/research/{ID}_prompt.md` から `content/research/{ID}_deep_research.{md,json}` を自動生成し、品質ゲート・PR 作成・AIレビュー・自動マージまでを担う。「リサーチ自動化して」「ディープリサーチして」「research-runner」と依頼された時に使用する。「ディープリサーチして」の既定エンジンは本スキルであり、ビルトインの deep-research や素の WebSearch へ直行しない。
model: sonnet
effort: high
disallowed-tools: AskUserQuestion
---

# research-runner スキル

Deep Research の完全自動化スキル。ユーザーの手動ディープリサーチを不要にし、
プロンプト（`content/research/{ID}_prompt.md`）から引用付きの構造化リサーチ結果を自律生成する。

> このスキルは汎用ベース版。`{ID}` は任意のリサーチ識別子（slug）で、トピック名・案件 ID など
> 何でもよい。`kai-kou/github-issue-shortcut` はプロジェクト適用時に実リポジトリ slug に置換する
> （環境変数 `GITHUB_REPOSITORY` があればツールは自動でそれを使う）。
>
> 🔴 クラウド実行環境では repo スコープの `gh`（REST + GraphQL）が egress プロキシに 403 でブロックされる（L-114）。
> 本スキル内の `gh issue edit/view` 等の Issue 操作は GitHub MCP（`mcp__github__*`）を一次経路とし、
> `gh` コマンド例は **ローカル環境向けの代替** として読む（SSOT: `docs/rules/github-mcp-fallback-patterns.md`）。

## §0: ルーティング（SSOT・最優先）

ユーザーが「ディープリサーチして」「deep research して」「深く調べて（リサーチ）」等と指示したら、
**このスキル（`research-runner`）が既定の起動先である**。明示しないと
ほぼ同名のビルトイン `deep-research` や素の `WebSearch` に倒れるため（Issue #73 の再発防止）、以下を厳守する。

| 候補 | 実体 | いつ使うか |
|------|------|-----------|
| **`research-runner`（本スキル）** | ネイティブ `/deep-research`（公式分類は **Workflow**・adversarial 多票検証）を、対話起動時は **`Skill` ツールで直接呼び出し**（Step 3a）、自律・バッチ起動時は `tools/run_deep_research_workflow.py`（`claude -p` サブプロセス経由・Step 3b）で実行 | **既定**。ユーザーが「ディープリサーチ」を求めたら必ずこれを最初に起動する |
| 素の `WebSearch` / `WebFetch` | メインセッションの単発検索 | ディープリサーチの **既定にしない**。軽い事実確認のみ |

> **注意（誤解しやすい点・2026-07-03 事実確認）**: ツール一覧に出てくる `deep-research` は「本スキルの DIY フォールバック」ではなく、**ネイティブ `/deep-research`（Workflow）そのもの**。旧記述は誤り。かつてビルトイン `deep-research` を「自セッション内 WebSearch fan-out」と区別していたが、実体は同一の bundled workflow である（`code.claude.com/docs/en/commands` で `[Workflow]` に分類・§0 の実体列を参照）。DIY フォールバック（Sonnet 5 本人による手動 WebSearch/WebFetch）は Step 4 の名称のみで、専用のツール名は存在しない。

- **禁止**: 「ディープリサーチして」に対し、本スキルを起動せず素の `WebSearch` で済ませる／ビルトイン `deep-research` を
  いきなり使う（安易な軽量経路直行禁止・Step 4 の DIY 直行禁止と同じ原則）。
- **例外**: ユーザーがコスト/速度優先を明示した、または対象が `/deep-research` の 30〜50 分が過剰なほど軽微な場合のみ、
  理由を 1 行述べて簡易リサーチに切り替えてよい（サイレント切替は禁止）。

## 採用方針

| 項目 | 内容 |
|---|---|
| **主エンジン** | **ネイティブ `/deep-research`（公式分類=Workflow・adversarial 多票検証）**。対話起動（Step 3a）は本セッションから `Skill` ツールで直接呼び出す（`claude -p` 不要・2026-07-03 公式ドキュメント確認済み・`docs/rules/dynamic-workflows-rules.md` 参照）。自律・バッチ起動（Step 3b）は `tools/run_deep_research_workflow.py`（`claude -p` サブプロセス + Opus 明示指定）を使う。正確性が最高で **必ず最初に実行する** |
| 第2エンジン | **Gemini Deep Research Max API** (`deep-research-max-preview-04-2026`)（主エンジンが真に失敗 or 月次予算ゲート超過時） — `tools/run_deep_research_gemini.py` |
| フォールバック | **DIY**（Sonnet 5 + WebSearch + WebFetch）（上記2つが失敗時の最終手段） |
| コスト | **既定=サブスク週次枠経路（追加 $ ゼロ）**: セッション認証（Claude Code Max サブスク）をそのまま使用し（`DEEP_RESEARCH_USE_SUBSCRIPTION=1` 既定）、`/deep-research` は週次クォータの枠内で実行され追加課金なし。`DEEP_RESEARCH_USE_SUBSCRIPTION=0` で従来の API 従量経路（1本上限 `--max-budget-usd`・当月累計 `$40` 超で Gemini フォールバック・月 `$50` ブレーカー）に戻せる（Step 3a の直接呼び出しはセッションの既存認証をそのまま使うため、この課金分岐自体が発生しない） |
| モデル | 公式仕様は「ワークフロー内の各エージェントはセッションのモデルを使用（スクリプトが明示的に別モデルへ routing しない限り）」。**Opus 固定は本プロジェクトの選択**（Step 3b が `--model claude-opus-4-8` を明示指定）であり、Anthropic 側が `/deep-research` を Opus に固定している仕様ではない。Step 3a（直接呼び出し）はそのときのセッションモデルに従う点に注意 |
| 想定時間 | 本番では 30〜50分/本（wall-clock）。Step 3a はネイティブの Workflow バックグラウンド実行 + 完了通知に従う。Step 3b は必ず `run_in_background` + heartbeat で監視する |

> **claude -p の位置づけ**: Step 3b の `claude -p` は Web ギャップ代替ではなく、コンテキスト隔離・90 分タイムアウト・レート枠検出（EXIT=6）が本質的に必要な **設計上の一次経路**（`isolation-by-design`）。分類とフォールバック標準形の SSOT は `docs/rules/native-fallback-rules.md`。

## 起動条件（自律起動・対話起動）

以下のいずれかを満たすとき起動する:

1. ラベル `phase:research`（または相当）+ `status:waiting-claude` のオープン Issue（自律起動）
2. `content/research/{ID}_prompt.md` が存在し、`content/research/{ID}_deep_research.md` が存在しない（自律起動）
3. **ユーザーが対話で「ディープリサーチして」等と依頼したとき（対話起動・アドホック）**。
   プロンプトファイルや Issue が **無くても STOP せず**、Step 2 の「アドホック起動」フローで
   ユーザー指示文からプロンプトを生成して主エンジンへ進む（§0 のルーティングに従う・Issue #73）。

> 自律起動（1・2）の最初のアクションは **対象 Issue を `status:in-progress` に切り替える** こと
> （CP-4 マルチセッション競合防止）。対話起動（3）は対象 Issue が無いことが多く、その場合はロック不要。

## 必読ドキュメント

作業前に以下を Read する:
- `docs/rules/research-rules.md` — リサーチ品質基準（情報ランク A/B/C・正式名称・必須セクション・fact_check 閾値）
- `tools/research_schema.json` — 出力スキーマ

## 実行フロー

### Step 0: 共通プリフライト

1. （プロジェクトに hourly プリフライトがあれば）`python3 tools/check_pending_pr_reviews.py --actionable-only --json` を実行
2. （API 従量経路時のみ）当月コスト累計を確認: `python3 tools/run_deep_research.py {ID} --dry-run --engine gemini`
3. サーキットブレーカー発動時は **STOP + 通知**（境界外。ユーザー判断を仰ぐ）

### Step 1: 対象 Issue のロック取得（CP-4）

MCP（クラウド・一次経路。`labels` は全置換のため現在のラベルを取得してフルリストを渡す・§2.2）:
```
mcp__github__issue_read(method="get_labels", issue_number={ISSUE_NUM})
mcp__github__issue_write(method="update", issue_number={ISSUE_NUM},
  labels=[現在のラベル − "status:waiting-claude" ＋ "status:in-progress"])
```

ローカル環境（gh CLI 到達可能時）の代替:
```bash
gh issue edit {ISSUE_NUM} -R kai-kou/github-issue-shortcut \
  --remove-label "status:waiting-claude" \
  --add-label "status:in-progress"
```

### Step 2: プロンプト確認

```bash
cat content/research/{ID}_prompt.md
```

**自律起動（起動条件 1・2）の場合**: 未存在なら、ツールは research_id を含むオープン Issue 本文の
`## Deep Research プロンプト` セクションからの復元を試みる（`load_prompt` フォールバック）。
それでも取得できない場合は上流のプロンプト生成が未実行 → ユーザーへ報告して STOP。

**対話起動（起動条件 3・アドホック）の場合**: プロンプトファイルが無いのは正常。STOP せず、
ユーザーの指示文（「〜についてディープリサーチして」の本文）から `{ID}_prompt.md` を生成して Step 3 へ進む。

```bash
# ID は指示文から短い slug を作る（例: "競合の料金体系" → pricing-competitor-20260621）
mkdir -p content/research
cat > content/research/{ID}_prompt.md <<'EOF'
# Deep Research プロンプト

## 調査テーマ
{ユーザー指示文の本文をそのまま}

## 調査項目（5〜7 項目に分解）
- {指示文から分解した観点1}
- {観点2}
- …

## 出力要件
docs/rules/research-rules.md の品質基準（ランク A/B/C・official_names・5〜7 セクション・出典 8 件以上）に従う
EOF
```

> 指示が曖昧で調査項目に分解できない場合のみ、`AskUserQuestion` は使えない（`disallowed-tools`）ため、
> メインセッション側で 2〜3 点の前提（対象範囲・期間・地域など）を補ってプロンプト化する。
> プロンプト生成後は **必ず Step 3（主エンジン）を最初に実行** する（素の WebSearch 直行禁止・§0）。

### Step 3: 主エンジン実行（ネイティブ `/deep-research`）【必ず最初に実行】

> 🔴 **最重要**: 主エンジンは **ネイティブ `/deep-research`**（公式分類=Workflow）。Step 4 の DIY を
> 最初から実行してはならない（安易な DIY 直行禁止）。起動方法は起動条件で分岐する（下記 3a / 3b）。

**どちらを使うか（起動条件で自動分岐・§0 参照）**:

| 起動条件 | 使う経路 |
|---|---|
| 対話起動（起動条件 3・ユーザーが今この対話でディープリサーチを依頼） | **Step 3a（直接呼び出し）** |
| 自律起動（起動条件 1・2・Issue ラベル駆動 / 他セッションからの再開） | **Step 3b（`tools/run_deep_research_workflow.py`）** |

#### Step 3a: 対話起動時 — `Skill` ツールで直接呼び出し（`claude -p` 不要）

> 2026-07-03 公式ドキュメント確認済み（`docs/rules/dynamic-workflows-rules.md` 参照）: `/deep-research` は
> CLI・Desktop・IDE拡張・`claude -p`・Agent SDK のいずれでも同一に動作し、**本セッションからサブプロセスを
> 挟まず直接 invoke できる**。今この対話で研究依頼を受けたとき（起動条件 3）はこちらを使う。

```
Skill(skill="deep-research", args="{Step 2 で生成したプロンプトの調査テーマ本文}")
```

- 呼び出しは Workflow ランタイム経由でバックグラウンド実行される。ターン終了を焦らず、完了通知
  （タスク完了 / レポート到着）を待つ。**モデルはそのときのセッションモデルに従う**（Opus 品質が
  必要なら呼び出し前に `/model claude-opus-4-8` するか、Step 3b を使う。§「モデル」の注意参照）。
- 結果として返るレポート本文を `content/research/{ID}_research_raw.md` に保存 → 即コミット&push（L-100）
  → Step 3b と同じ **正規化ロジック**（`tools/run_deep_research_workflow.py --normalize-only --report ...`）
  で `research_schema.json` 準拠 JSON に変換して Step 5 へ進む（再検索なし・$0）。
- **失敗時（EXIT相当のエラー・本文欠落・WebSearch 未許可等）→ Step 3.5（Gemini）へ**（Step 3b と同じ判断基準）。
- 前提条件: WebSearch ツールが利用可能であること（公式要件）。`disableWorkflows` 設定は公式に
  「同じ無効化設定が全 surface に適用される」ため、Step 3b（`claude -p` サブプロセス）も同じ
  設定ファイルを読む限り同様に無効化される（Step 3b なら回避できるわけではない点に注意）。
  無効化されている場合は `/deep-research` 自体が使えないため、Gemini（Step 3.5）へ進む。

#### Step 3b: 自律・バッチ起動時 — `tools/run_deep_research_workflow.py`（`claude -p` サブプロセス）

> 自律起動（Issue ラベル駆動・cross-session 実行）は、既存のレート枠スキップカウンタ（Issue ラベル
> `research-skip:N`）・月次コストログ・Opus 明示指定を使い続けるため、引き続き本ツールを使う。
> **必ず `run_in_background` + heartbeat で監視** し、完走（既定 timeout 5400 秒＝90分）を待つ。

```bash
python3 tools/run_deep_research_workflow.py {ID}
# 終了コードの意味（echo で握り潰さず、そのまま判定すること）:
#   0=成功(schema OK) / 1=schema NG・normalize失敗 / 2=入力不足 / 3=予算ゲート超過
#   4=本文回収失敗(出力欠落・長さガード発火) / 5=権限不足・実行エラー
#   6=レート枠超過(capacity) → Step 3.6 のスキップ判定へ（Gemini に即落とさない）
#   → 1/4/5 は Step 3.5（Gemini）へ / 6 のみ Step 3.6（スキップ＋カウンタ）へ分岐 / 2 はユーザー報告
```

- 出力: `content/research/{ID}_deep_research.{md,json}`（`research_schema.json` 準拠・`engine=claude-deep-research-workflow`）。**EXIT=0 なら Step 3.5・4 をスキップして Step 5（品質ゲート）へ**。
- **本文回収の仕組み**: `/deep-research` はレポート全文を作業ファイル `deep_research_report.md` へ Write し、ツールは永続 work_dir からそれを harvest して本文の正本にする（`--output-format json` の `result` は最終メッセージしか拾わないため保険扱い）。本文が **3000 字未満** なら出力欠落とみなし **EXIT=4** で即フォールバックへ。
- **🔴 喪失防止チェックポイント（必須運用）**: 検索成功直後、normalize の前に生レポートが `content/research/{ID}_research_raw.md` に保存される（stdout に `[1.5/3] 喪失防止:` と出る）。**この `_research_raw.md` が存在したら、後続処理の前に必ず即コミット＆push する**（L-100: 未コミットは SessionStart で消える）。normalize が落ちて **EXIT=1** でも、生レポートは git に残り `--normalize-only --report content/research/{ID}_research_raw.md` で再検索なし（$0）に再正規化できる。EXIT=0（成功）時はツールが `_research_raw.md` を自動削除する。
- セキュリティ/動作: `--allowedTools` で事前許可（`tools/run_deep_research_workflow.py` 経由時）。**Bash/Write は Workflow のオーケストレーション実行に必須**。インジェクション対策は work_dir をリポジトリ外へ隔離 + 実行後に必ず破棄 + `--max-budget-usd` 上限で緩和（git commit はサブプロセスにさせず親＝本スキルが行う。root では `--dangerously-skip-permissions` 不可）。
- **EXIT=1/4/5（真の失敗）→ Step 3.5（Gemini）へ**。ただし EXIT=1 で `_research_raw.md` が存在する場合は、Gemini へ行く前に **まず `--normalize-only` 再試行**（再検索コストを払わず復旧できるため）。
- **EXIT=6（レート枠超過）→ Step 3.6（スキップ判定）へ**。**Gemini に落とさない**。
- **EXIT=2（入力不足）→ ユーザー報告**（プロンプト未生成）。

> モデルは既定 **Opus**（`DEFAULT_ENGINE_MODEL=claude-opus-4-8`）。コスト/時間削減が必要なら `--max-budget-usd` を下げるか Gemini/DIY を使う。

### Step 3.6: レート枠超過時のスキップ判定（ネイティブ `/deep-research` を主に維持）

Step 3 が **EXIT=6（レート枠超過・capacity）** を返したときのみ実行する（EXIT=1/4/5 は Step 3.5 へ直行）。

> **ポリシー**: ディープリサーチは **必ずネイティブ `/deep-research` で行う**。**レート枠超過は Gemini に即フォールバックせず「スキップ」して次スロットで再試行** し、**連続3回スキップしたときだけ Gemini（Step 3.5）へ** 降りる。

skip カウンタは **対象 Issue のラベル `research-skip:N`（N=1..3）** で永続化する（クラウド・セッション横断で安全。state ファイルは使わない＝L-100 消失・cross-session 共有問題を回避）。

MCP（クラウド・一次経路）: 現在の skip 値は `mcp__github__issue_read(method="get_labels", issue_number={ISSUE_NUM})` で取得し、
ラベルの付け替えは `mcp__github__issue_write(method="update", labels=[フルリスト])`（全置換・§2.2）で行う。
`research-skip:${NEXT}` ラベルが未作成の場合、MCP にラベル作成の等価ツールはないが、`issue_write` の `labels` に
未存在ラベル名を渡すと GitHub 側で自動作成される（色は既定値）。以下はローカル環境（gh CLI 到達可能時）の代替:

```bash
SKIP=$(gh issue view {ISSUE_NUM} -R kai-kou/github-issue-shortcut --json labels \
  --jq '[.labels[].name | select(startswith("research-skip:")) | sub("research-skip:";"") | tonumber] | max // 0')
NEXT=$((SKIP + 1))
if [ "$NEXT" -lt 3 ]; then
  # スキップ: ラベルを実際に付け替え、status を waiting-claude に戻して次スロットで /deep-research 再試行
  gh label create "research-skip:${NEXT}" -R kai-kou/github-issue-shortcut --color FBCA04 2>/dev/null || true
  [ "$SKIP" -gt 0 ] && gh issue edit {ISSUE_NUM} -R kai-kou/github-issue-shortcut --remove-label "research-skip:${SKIP}"
  gh issue edit {ISSUE_NUM} -R kai-kou/github-issue-shortcut \
    --add-label "research-skip:${NEXT}" \
    --remove-label "status:in-progress" --add-label "status:waiting-claude"
  # → Issue に「⏳ レート枠超過によりスキップ (${NEXT}/3)」とコメントして STOP
else
  # 3連続到達: skip カウンタを全削除して Step 3.5（Gemini）へ
  [ "$SKIP" -gt 0 ] && gh issue edit {ISSUE_NUM} -R kai-kou/github-issue-shortcut --remove-label "research-skip:${SKIP}"
  # → Issue に「⚠️ /deep-research が3連続レート枠超過。Gemini にフォールバック」とコメントして Step 3.5 へ
fi
```

| NEXT（連続何回目のスキップか） | アクション |
|---|---|
| **1 または 2（< 3）** | ① 旧 `research-skip:*` を全削除し `research-skip:${NEXT}` を付与 ② `status:in-progress` を外して `status:waiting-claude` に戻す（次スロットで再ロック → `/deep-research` 再試行） ③ Issue に「⏳ レート枠超過によりスキップ (${NEXT}/3)。次スロットで再試行する」とコメント ④ **STOP** |
| **3（== 3）** | ① `research-skip:*` を全削除（カウンタリセット） ② Issue に「⚠️ `/deep-research` が3連続レート枠超過。今回は Gemini にフォールバックする」とコメント ③ **Step 3.5（Gemini）へ進む** |

> 🔴 **カウンタのリセット条件**: Step 3 が **EXIT=0（成功）したら、Step 6 のコミット前に必ず `research-skip:*` ラベルを全削除** する（成功＝連続スキップが途切れたため）。

### Step 3.5: 第2エンジン（Gemini Deep Research Max）【Step 3 が真に失敗（EXIT=1/4/5）or 3連続スキップ到達時】

> 🔴 **最重要（L-080 kick&forget 禁止）**: Gemini DR Max は最大30分の非同期ポーリングを内部で行う。
> Bash の前景実行は最大10分のため、`run_deep_research.py` は **必ず `run_in_background: true` で起動** し、
> **完走（プロセス exit）を監視してから** 次へ進む。「実行中」とだけ報告してターン終了は厳禁。

```bash
python3 tools/run_deep_research.py {ID} --engine gemini
#   0=成功 / 1=Gemini失敗→Step4 / 2=予算ブレーカー
```

**完走監視（必須）**: `run_in_background` の exit 通知（exit code 付き）を受け取るまでターンを完了扱いにしない。`content/pipeline-state/research_progress.jsonl` の末尾 `state` が `done`/`failed`/`timeout`、または `content/research/{ID}_deep_research.json` 出現まで待つ。

**完了判定**: EXIT=0 かつ `deep_research.{json,md}`（`engine=gemini-deep-research-max`）が揃ったら **Step 4 をスキップして Step 5 へ**。EXIT=1 → Step 4（DIY）。EXIT=2 は予算ブレーカー（Step 7 のサーキットブレーカーへ）。

> Gemini 失敗時は `content/pipeline-state/research_fallback_log.jsonl` に理由を記録し非ゼロ終了 → Step 4 へ（サイレントフォールバック禁止）。`GEMINI_API_KEY` 必須（`docs/rules/env-vars.md` 参照）。

### Step 4: 最終フォールバック（DIY・Sonnet 5 + WebSearch）【Step 3・3.5 両方失敗時のみ】

Step 3（/deep-research）と Step 3.5（Gemini）が **両方とも実際に失敗した場合のみ** 実行する。
これらを試さずに本 Step を実行するのは禁止（安易な DIY 直行禁止）。

> **フォールバック発動時の必須記録**: `research_fallback_log.jsonl` に Gemini 失敗理由が記録されていることを確認し、PR 本文に「Gemini フォールバック理由: {理由}」を明記する。

このスキル自身が Sonnet 5 として、本セッション内で WebSearch / WebFetch を実行し、
`research_schema.json` に準拠した JSON を組み立てて `tools/run_deep_research.py` に引き渡す。

実行手順:

1. プロンプトの調査項目（5〜7 項目 + 正式名称確認リスト）を識別
2. **項目ごとに並列 sub-agent**（Haiku 4.5 推奨）を起動して WebSearch（5〜10クエリ）+ WebFetch（主要 2-3 URL）
3. 各 sub-agent は以下のフォーマットで返す:

```json
{
  "heading": "セクション見出し",
  "body_markdown": "本文（[A]/[B]/[C] タグと URL を併記）",
  "source_ids": ["s001", "s002"]
}
```

4. メインスキルが結果を統合し、official_names・sources・fact_check_flags を生成
5. JSON / Markdown を `content/research/{ID}_deep_research.{json,md}` に書き出し

### Step 5: 品質ゲート

`docs/rules/research-rules.md` と `tools/research_schema.json` に基づき判定する。
プロジェクトに lint/URL 検証ツールがあれば併用する（無ければスキーマ準拠の手動チェックで代替）:

```bash
# 任意（存在する場合のみ）
[ -f tools/lint_research_files.py ] && python3 tools/lint_research_files.py {ID}
[ -f tools/validate_fact_check_urls.py ] && python3 tools/validate_fact_check_urls.py content/research/{ID}_deep_research.md
```

判定基準:

| 条件 | アクション |
|---|---|
| `fact_check_flags >= 5 件` | Gemini DR Max（Step 3.5）で 1回だけ再リサーチ |
| `rank C >= 1 件` | 同上 |
| `sections < 5` | Step 4 で不足項目だけ追加実行 |
| `sources < 8` | 同上 |
| 上記すべてクリア | Step 6 へ |
| 再リサーチ後も基準未達 | `status:waiting-user` に戻す + 通知（境界外） |

### Step 6: コミット & PR

```bash
git checkout -b claude/{ID}-deep-research-{timestamp}
git add content/research/{ID}_deep_research.{json,md}
git commit -m "[{ID}] research: Deep Research 自動実行完了 (engine={engine})"
git push -u origin claude/{ID}-deep-research-{timestamp}
```

PR 作成（`docs/rules/pr-review-flow-summary.md` の標準フローに従う）:
- タイトル: `[{ID}] research: Deep Research 自動実行`
- 本文: `engine` / `cost_usd` / `search_count` / `rank_distribution` / `fact_check_flags` 件数を明記
- `Closes #{ISSUE_NUM}`

### Step 7: AIレビュー監視 & 自動マージ

`docs/rules/pr-review-flow-summary.md` 標準の subscribe_pr_activity + ハートビートで監視。
レビュアー OK で自動マージ → Issue クローズ → （あれば）次工程の Issue 起票。

### Step 8: コスト記録 & レトロ

- `tools/run_deep_research.py` / `run_deep_research_workflow.py` が `content/pipeline-state/research_cost_log.jsonl` に追記する
- 失敗（フォールバック発動含む）時は `/retrospective` を起動し Try Issue 化する

## 失敗モードと対応

| 失敗モード | 検出 | 対応 |
|---|---|---|
| Gemini API 障害（5xx 連続 / >10分） | `run_deep_research.py` のリトライ | `research_fallback_log.jsonl` に記録 → DIY 切替 + 通知 |
| Gemini タイムアウト（>30分） | `_poll_interaction` の MAX_DURATION_SECONDS | フォールバック記録 → wip コミット + DIY フォールバック |
| 品質劣化（fact_check_flags ≥ 5 / rank C ≥ 1） | Step 5 の品質ゲート | Gemini で 1回再試行 → それでも NG なら waiting-user |
| 月予算超過（API 従量経路） | `check_budget()` | `$50` で即停止 + 通知（境界外） |
| 同テーマ並行実行 | Step 1 のラベル取得失敗 | 即終了（CP-4 パターン） |
| プロンプト未生成 | Step 2 のファイル不在 + Issue 復元失敗 | 上流のプロンプト生成を起動するか、ユーザーに報告 |

## 関連ファイル

- `tools/run_deep_research_workflow.py` — 主エンジン Step 3b（自律・バッチ起動用。ネイティブ `/deep-research` を `claude -p` サブプロセス経由で実行 + 正規化。対話起動は Step 3a で `Skill` ツールから直接呼ぶため本ファイルを経由しない）
- `tools/run_deep_research.py` — オーケストレーション・I/O・コスト監視（Gemini/DIY ランナー）
- `tools/run_deep_research_gemini.py` — Gemini DR Max エンジン（Interactions API・ポーリング・スキーマ正規化）
- `tools/research_schema.json` — 出力 JSON Schema
- `content/pipeline-state/research_fallback_log.jsonl` — フォールバック発動の記録（可視化）
- `content/pipeline-state/research_cost_log.jsonl` — コスト記録
- `docs/rules/research-rules.md` — リサーチ品質基準
