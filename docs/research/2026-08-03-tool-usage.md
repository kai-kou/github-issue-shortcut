# ツール利用状況リサーチ（2026-08-03 JST・Issue #233）

> **調査対象の定義（採用した解釈）**: 本プロジェクトの PWA プロダクト側にはユーザー行動計測（GA4 等）が
> **未導入**（`src/`・`worker/`・`index.html` に `gtag`／解析タグの実装なし。GA4 は `content/discussions/ga4-adoption-20260728/` で
> 検討中の段階）で実データが存在しないため、本レポートの「ツール」は
> **本リポジトリの Claude Code 自律運用が使うツール群**（組み込みツール／MCP サーバー・ツール／Agent Skills／
> サブエージェント／Hooks／権限設定）を指す。

## 0. サマリー（先に結論）

| 観点 | 実測 |
|------|------|
| セッションに提供されているツール総数 | **169**（組み込み 16 + 遅延ロード 32 + MCP 121） |
| MCP サーバー数 | **6**（github / Cloudflare_API / Cloudflare_Developer_Platform / Slack / Google_Drive / context7）+ ホスト側 Claude_Code_Remote |
| リポジトリ内の MCP ツール参照（設計上の利用） | **309 箇所**。うち **github が 294（95.1%）** |
| github MCP のツール利用率 | 55 ツール中 **37 種（67%）** を参照。18 種は未参照 |
| Slack MCP（18 ツール）／Google Drive MCP（8 ツール） | **参照ゼロ**（完全未使用） |
| 実運用トークン量（2026-07・12 日間） | 76 セッション / 合計 **10.7 億トークン**。うち **キャッシュ読み込みが 95.8%** |
| アウトプット実績（直近 100 PR） | 2026-07-13 〜 08-02 の 21 日で 100 PR（うちマージ 99・非マージ 1） |
| **ツール別の呼び出し実績** | **永続化されていない**（後述 G-6。最大のギャップ） |

---

## 1. 調査方法とデータ源

| # | データ源 | 取得方法 | 位置づけ |
|---|---------|---------|---------|
| D-1 | セッションに実際に提供されているツール定義 | 本セッションのツールリスト（組み込み + `ToolSearch` 遅延ロード対象） | 供給側の一次情報 |
| D-2 | `.claude/settings.json` | 直接 Read | 権限・サンドボックス・フック配線 |
| D-3 | リポジトリ内のツール参照 | `.claude/`・`docs/`・`tools/`・`scripts/`・`.github/` を `grep -o` して集計 | 「設計上どのツールを使う建て付けか」の定量値 |
| D-4 | テレメトリデータブランチ `telemetry/cost-data` | `content/analytics/cost_monthly/2026-{07,08}.json` を取得して集計 | 実運用のセッション数・トークン量 |
| D-5 | GitHub 実績 | `mcp__github__list_pull_requests`（直近 100 件） | アウトプット側の実績 |
| D-6 | 現セッションのトランスクリプト | `~/.claude/projects/.../*.jsonl` の `tool_use` 集計 | **n=1 の参考値**（過去セッションはコンテナ破棄で消失） |

**制約**: クラウド実行環境はセッションごとにコンテナが再生成されるため、過去セッションのトランスクリプトは残らない。
`content/pipeline-state/cost_log.jsonl` も gitignore 対象の揮発 state file であり、**ツール別の呼び出し履歴はどこにも永続化されていない**（G-6）。

---

## 2. 提供されているツールの全体像（供給側・169 ツール）

### 2.1 組み込みツール（16・即時ロード）

`Agent` / `Artifact` / `AskUserQuestion` / `Bash` / `Edit` / `Glob` / `Grep` / `Read` / `ReportFindings` /
`ScheduleWakeup` / `SendUserFile` / `ShowOnboardingRolePicker` / `Skill` / `ToolSearch` / `Workflow` / `Write`

### 2.2 遅延ロード（32・`ToolSearch` で取得してから呼べる）

- **タスク／サブエージェント系**: `TaskCreate` `TaskGet` `TaskList` `TaskOutput` `TaskStop` `TaskUpdate` `SendMessage` `Monitor`
- **スケジュール系**: `CronCreate` `CronDelete` `CronList` `PushNotification`
- **プラン／ワークツリー**: `EnterPlanMode` `ExitPlanMode` `EnterWorktree` `ExitWorktree`
- **発見系**: `ListSkills` `SearchSkills` `SuggestSkills` `ListPlugins` `SearchPlugins` `SuggestPluginInstall` `ListConnectors` `SuggestConnectors` `SearchMcpRegistry` `ListMcpResourcesTool` `ReadMcpResourceTool` `ReadMcpResourceDirTool`
- **その他**: `WebSearch` `WebFetch` `NotebookEdit` `DesignSync`

### 2.3 MCP サーバーとツール数（121）

| サーバー | ツール数 | 本リポジトリでの参照数 | 実態 |
|---------|---------|---------------------|------|
| `github` | 55 | **294** | 一次経路（L-114）。Issue/PR/Actions の中核 |
| `Claude_Code_Remote`（ホスト提供） | 12 | 3 | `add_repo` / `create_trigger` を文書で言及 |
| `Cloudflare_Developer_Platform` | 23 | 3 | D1 の 2 ツールのみ（`d1_database_query` / `d1_databases_list`） |
| `Slack` | 18 | **0** | 通知は `tools/slack_notify.py`（Webhook）で実装（G-2） |
| `Google_Drive` | 8 | **0** | 用途なし（G-3） |
| `Cloudflare_API` | 3 | 6 | `execute` / `search` を autoMode で恒久承認済み |
| `context7` | 2 | 2 | 参照は旧ツール名（G-1） |

### 2.4 プロジェクト資産（Claude Code 拡張）

| 資産 | 数 | 備考 |
|------|-----|------|
| Agent Skills（`.claude/skills/`） | **19** | うち MCP を使う設計は 14。`checkpoint`・`design-review`・`discussion-review`・`self-reviewer`・`skill-creator` は MCP 非依存 |
| スラッシュコマンド（`.claude/commands/`） | 2 | `next` / `status` |
| サブエージェント（`.claude/agents/`） | 2 | `design-reviewer`（tools 無指定＝全ツール）／`owner`（6 ツールに限定） |
| Hooks（`.claude/hooks/`） | **18 スクリプト**（10 イベント / 12 配線） | `SessionStart` `UserPromptSubmit`×3 `PermissionRequest` `PreToolUse` `PostToolUse` `PostToolUseFailure` `PreCompact` `PostCompact` `Stop` `SubagentStop` |
| 運用スクリプト（`tools/*.py`） | **49** | GitHub アクセスは 8 本が REST/トークン経由、他は git・MCP 前提 |
| 常駐ルール（`.claude/rules/`） | 13 ファイル / 約 70.7 KB | Hot 層。毎ターン読み込まれる |

---

## 3. 設計上の利用状況（リポジトリ参照の定量集計）

### 3.1 MCP ツール参照ランキング（上位 15・全 309 件中）

| 順位 | ツール | 参照数 |
|------|-------|-------|
| 1 | `mcp__github__list_issues` | 39 |
| 2 | `mcp__github__issue_write` | 31 |
| 3 | `mcp__github__pull_request_read` | 30 |
| 4 | `mcp__github__list_pull_requests` | 28 |
| 5 | `mcp__github__create_pull_request` | 16 |
| 6 | `mcp__github__search_issues` | 10 |
| 7 | `mcp__github__subscribe_pr_activity` | 8 |
| 7 | `mcp__github__issue_read` | 8 |
| 9 | `mcp__github__actions_list` | 7 |
| 10 | `mcp__github__merge_pull_request` | 6 |
| 10 | `mcp__github__get_file_contents` | 6 |
| 10 | `mcp__github__add_issue_comment` | 6 |
| 13 | `mcp__github__resolve_review_thread` | 5 |
| 14 | `mcp__github__request_copilot_review` | 4 |
| 14 | `mcp__github__push_files` | 4 |

**読み取れること**: 参照の重心は完全に **Issue ライフサイクル管理（list/write/read/search）と PR フロー（read/create/merge/review）** にある。
これは CP-3（リポジトリ衛生管理）・CP-4（論理ロック）・PR 完全自律化という運用設計の裏返しで、ツール構成とルール設計は一致している。

### 3.2 組み込みツールの言及数（`.claude/skills` + `agents` + `commands` + `docs/rules`）

| ツール | 言及数 | ツール | 言及数 |
|-------|-------|-------|-------|
| `Read` | 160 | `WebFetch` | 14 |
| `Agent` | 139 | `Edit` | 14 |
| `Skill` | 81 | `Monitor` | 12 |
| `Bash` | 58 | `AskUserQuestion` | 12 |
| `Workflow` | 45 | `Grep` | 9 |
| `Write` | 40 | `Glob` | 6 |
| `SendMessage` | 28 | `TaskCreate` | 4 |
| `WebSearch` | 26 | `TodoWrite` / `NotebookEdit` / `Artifact` | 各 1 |

**読み取れること**:

- `Read` が突出（160）。ルール・SSOT・スキル手順を **その都度 Read する** 設計（Hot/Warm 2 層構造）が数字に出ている。
- `Agent`（139）と `Skill`（81）が上位＝**委譲前提の運用**。`SendMessage`（28）は議論型 Agent Teams。
- `Grep` 9 / `Glob` 6 と少なく、探索は `Bash`（58）と `Agent` 委譲に寄っている。

### 3.3 スキル別の MCP 依存（14/19 スキルが github MCP に依存）

| スキル | 参照する MCP ツール（github は `gh:` と表記） |
|-------|-------------------------------------------|
| `pr-review-watcher` | `gh:actions_list` `add_reply_to_pull_request_comment` `pull_request_read` `request_copilot_review` `resolve_review_thread` `subscribe_pr_activity` `unresolve_review_thread` ほか |
| `retro-try-handler` | `add_issue_comment` `create_pull_request` `issue_write` `list_issues` `list_pull_requests` `merge_pull_request` `search_issues` |
| `project-sync` | `issue_write` `list_issue_fields` `list_issues` `list_pull_requests` `search_issues` |
| `audit-runner` | `Claude_Code_Remote__create_trigger` `create_pull_request` `issue_write` `list_issues` `list_pull_requests` |
| `self-improvement-loop` | `issue_write` `list_issues` `search_issues` `sub_issue_write` |
| `retrospective` | `add_issue_comment` `issue_write` `list_issues` `pull_request_read` |
| `apply-base` | `Claude_Code_Remote__add_repo` `get_file_contents` |
| `project-manager` / `research-runner` / `workflow-health-check` / `claude-code-spec-sync` / `code-review` / `skill-audit` / `waiting-user-handler` | 1〜3 ツール |
| `checkpoint` / `design-review` / `discussion-review` / `self-reviewer` / `skill-creator` | MCP 非依存（ローカルツールのみ） |

---

## 4. 権限・サンドボックスの状況（`.claude/settings.json`）

| 区分 | 件数 | 内容 |
|------|-----|------|
| `permissions.allow` | **62** | Bash 系 18（git 各種・`npm`/`npx`/`node`/`python3`/`pip3`/`gh`/`sleep`/`bash -n`）、`Read`/`Edit`/`Write` のパス限定 14、MCP 27、`Skill`・`WebSearch`・`WebFetch` |
| `permissions.deny` | **17** | `.env`・`*.pem`・`*.key`・`credentials*`・`id_rsa`・`.aws/**`・`broker_secrets.env` 等の秘密ファイル読み取り 15、`settings.local.json` の書き込み 2 |
| `sandbox` | 有効 | `autoAllowBashIfSandboxed: true`。許可ドメイン 12（github/slack/anthropic/context7/cloudflare/npm/pypi 系）。秘密ブローカー系スクリプト 10 パターンをサンドボックス除外 |
| `autoMode.allow` | 4 | `$defaults` + 作業ブランチへの `--force-with-lease` + Cloudflare Worker/D1 の自律運用 + Workers Builds の `production_settings` 変更 |
| フック配線 | **10 イベント / 12 配線**（スクリプト実体 18） | `PreToolUse` の matcher は `Bash|mcp__github__create_pull_request`、`PermissionRequest` は `Read|Write|Edit|NotebookEdit`、`PostToolUseFailure` は `Bash`。`UserPromptSubmit` のみ 3 本を直列実行し、`PreToolUse`／`Stop` は router スクリプトが子スクリプトへ分岐する |

**整合している点**: 秘密ファイルの deny は Read だけでなくサンドボックスのドメイン制限と二重化されており、
`Bash(gh:*)` を allow しつつ実体は `tools/gh_shim.py`（実 gh 不在時に MCP 代替を案内）に差し替える構成も、
L-114（クラウドでは MCP が一次経路）と矛盾しない。

---

## 5. 実運用の量的実績（テレメトリ・D-4/D-5）

### 5.1 月次トークン（`telemetry/cost-data` ブランチ）

| 月 | セッション | 稼働日 | input | output | cache write | cache read | 合計 | キャッシュ読込比率 |
|----|-----------|-------|-------|--------|-------------|-----------|------|-----------------|
| 2026-07 | 76 | 12 日 | 144,949 | 5,903,593 | 39,388,421 | 1,026,261,604 | **1,071,698,567** | **95.8%** |
| 2026-08（03 まで） | 6 | 3 日 | 81,890 | 391,977 | 7,504,559 | 90,546,751 | **98,525,177** | 91.9% |

- **1 セッションあたり**: 2026-07 は合計 14.1M トークン／出力 77.7K トークン。2026-08 は合計 16.4M／出力 65.3K。
- **キャッシュ読み込みが 9 割超** を占める。Hot 層ルール（13 ファイル・約 70.7 KB）+ CLAUDE.md + スキル定義が
  毎ターン読み込まれる構造だが、プロンプトキャッシュに乗っているため input 実費としては最小化されている
  （`token-optimization-rules.md` の Hot/Warm 2 層設計が機能している裏付け）。
- **日次の粒度**: 2026-07 は 07-17 開始（テレメトリ導入 #106／#242 のタイミングと一致）。07-23・07-30・07-31 に
  データが無いのは欠測ではなく、同日に PR 実績も無い（＝セッション未稼働日）ため整合している。

### 5.2 アウトプット実績（直近 100 PR）

- 期間: 2026-07-13 〜 2026-08-02（UTC・21 日）で **100 PR**。うち **マージ 99 / 非マージクローズ 1（#96）**。
- 日別ピーク（ローカル `main` の squash マージコミットを JST で集計。計測できる範囲は 07-22 〜 07-29 の 46 件）:
  **07-28 が 13 件**、07-25 が 11 件、07-27 が 8 件、07-29 が 7 件。
  テレメトリのセッション数（07-25 が 14 セッション、07-28 が 5 セッション）と突き合わせると、
  **セッション数と PR 数は比例しない**（07-28 は少数セッションで多数の PR を捌いている）。

### 5.3 ツール別呼び出しの実測（参考・n=1）

本セッションのトランスクリプトを集計した結果は `Bash` 8 / `Read` 3 / `Grep` 1。
**サンプル 1 セッションのため傾向とは言えない** が、トランスクリプトの `tool_use` ブロックから
ツール別呼び出しが機械集計できること自体は実証できた（G-6 の改善根拠）。

---

## 6. ギャップ分析

| # | ギャップ | 根拠 | 影響 | 推奨対応 |
|---|---------|------|------|---------|
| **G-1** | `permissions.allow` の context7 エントリが **旧ツール名**（`mcp__context7__get-library-docs`）。現行サーバーが提供するのは `mcp__context7__query-docs` | `.claude/settings.json:46` / 提供ツール一覧 | CP-2（最新情報の取得）で context7 を使うたびに権限プロンプトが出て自律性が落ちる | allow を `mcp__context7__query-docs` に更新（`resolve-library-id` は現行のままで正しい） |
| **G-2** | Slack MCP 18 ツールが接続済みだが参照ゼロ。通知は `tools/slack_notify.py`（Webhook）で実装 | 参照集計 0 件 | 必ずしも問題ではない（Webhook はフックから叩けて安定）。ただし **接続コストだけ払っている** 状態 | 現状維持でよいが、「Slack 通知は Webhook が正・MCP は使わない」と `slack-notification-rules.md` に明記して迷いを消す |
| **G-3** | Google Drive MCP 8 ツールが参照ゼロ・用途なし | 参照集計 0 件 | 同上 | プロジェクト用途がないなら接続を外す判断もあり |
| **G-4** | Cloudflare_Developer_Platform 23 ツール中、参照は D1 の 2 種のみ。`workers_list` / `workers_get_worker` / `workers_get_worker_code` は未参照 | 参照集計 | デプロイ検証を wrangler CLI に依存しており、Worker の実デプロイ状態を MCP で確認する手段が運用に組み込まれていない | デプロイ後検証に `workers_get_worker` を組み込むと「デプロイできたつもり」を機械的に潰せる |
| **G-5** | 未接続サーバー `mcp__youtube__*` への言及がベース由来で残存 | `docs/rules/claude-code-optimization.md:620` | 陳腐化した記述。将来の誤読・誤設定リスク | 本リポジトリに存在しない MCP の記述を削除、またはベース由来の注記を付ける |
| **G-6** | **ツール別の呼び出し実績が永続化されていない**。テレメトリはトークン量のみ | `tools/calc_daily_cost.py` の集計項目／`cost_log.jsonl` は gitignore の揮発 state | 「どのツール・どのスキルにコストが乗っているか」が測れず、最適化が定性判断になる | `calc_daily_cost.py` は既にトランスクリプトを走査しているので、同じループで `tool_use` の name を集計し、月次 JSON に `tools: {name: count}` を追加する（実装コスト小・効果大） |
| **G-7** | github MCP の 55 ツール中 18 種が未参照。うち `enable_pr_auto_merge` / `update_pull_request_branch` は現行フローの課題に直結 | 参照集計 | 必須 CI 完走待ちを「待って手動マージ」で回している。base 更新も手作業 | `enable_pr_auto_merge` で CI 通過後の自動マージを GitHub 側に委ね、`update_pull_request_branch` で base 追従を 1 コールにする |

未参照の github MCP ツール（18）: `add_comment_to_pending_review` `create_repository` `delete_file` `disable_pr_auto_merge`
`enable_pr_auto_merge` `fork_repository` `get_check_run` `get_commit` `get_latest_release` `get_release_by_tag` `get_tag`
`get_team_members` `get_teams` `list_issue_types` `list_tags` `run_secret_scanning` `search_commits` `update_pull_request_branch`

> `get_check_run` は `pull_request_read(method="get_check_runs")` で代替済みのため、未参照でも欠落ではない。

---

## 7. 総評

- **ツール構成と運用ルールは高い整合性を持つ**。参照の 95% が github MCP に集中し、それが Issue ライフサイクルと
  PR 自律フロー（CP-3／CP-4／PR 完全自律化）という設計意図とそのまま対応している。
- **コスト構造は「キャッシュ読み込み 9 割超」**。Hot/Warm 2 層のルール設計はキャッシュ前提で妥当に機能している。
- **最大の弱点は観測**（G-6）。トークン量は月次で永続化されているのに、**ツール別・スキル別の内訳が残らない** ため、
  「どのツールが効いていて、どれが死蔵か」を本レポートのように **静的参照集計で近似するしかない**。
  トランスクリプトから機械集計できることは実証済みなので、ここを埋めるのが次の一手として最も費用対効果が高い。
- **設定の陳腐化は 2 件のみ**（G-1・G-5）で、資産全体の鮮度は良好。

---

## 8. 参照

- データ: `telemetry/cost-data` ブランチ `content/analytics/cost_monthly/2026-{07,08}.json`
- 設定: `.claude/settings.json`
- 関連ルール: `docs/rules/github-mcp-fallback-patterns.md`（MCP 可否マトリクス・L-114）/
  `docs/rules/token-optimization-rules.md`（Hot/Warm 2 層）/ `docs/rules/agent-team.md`（委譲・Agent Teams）/
  `docs/rules/claude-code-optimization.md`（ツール露出の変遷）
