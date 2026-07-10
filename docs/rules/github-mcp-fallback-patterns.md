# クラウドでの GitHub 操作: 公式 MCP 一次経路パターン（SSOT）

> **このファイルは「クラウド実行環境で GitHub をどう操作するか」の唯一の正本（SSOT）である。**
> 旧版は「`gh` 不在時（FileNotFoundError）の代替」を前提にしていたが、実態は **`gh` は存在するのに
> egress プロキシが repo スコープ操作を 403 でブロックする** という別問題である（2026-06-30 実機検証・Issue #121）。
> さらに **2026-07-02 の再検証（Issue #133）で、旧検証では生存していた `gh search` 系・非 repo REST・
> GitHub Actions パス（variables/secrets/runs/workflows）も 403 化** したことを確認した（ブロック範囲は拡大傾向）。

## 0. 結論（最重要・常駐）

クラウド実行環境（`CLAUDE_CODE_REMOTE=true`）では、**GitHub の読み書きは公式 GitHub MCP
（`mcp__github__*`）が唯一の実働経路** である。`gh` CLI は存在する（`gh --version` は通る）が、
`gh api user`・`gh api rate_limit`・`gh auth status` を除く **ほぼ全ての gh コマンドが egress
プロキシにブロックされる**。

- ❌ **repo スコープ REST**: `gh api repos/{o}/{r}/...` → 403「GitHub access is not enabled for this session. An org admin must connect the Claude GitHub App for this organization.」
- ❌ **GraphQL 全般**: `gh issue/pr list`・`gh repo view`・`gh label list`・`gh release list`・`gh api graphql`（および `--json` を伴う高レベル gh コマンド）→ 403「GraphQL proxying is not enabled.」
- ❌ **search 系（2026-07-02 に 403 化）**: `gh search repos/issues/code/prs`・`gh api search/...` → 403「This GitHub API path is not available: sessions are bound to their configured repositories.」（旧検証の「search API は通る」は失効）
- ❌ **非 repo REST（2026-07-02 に 403 化）**: `gh api users/{u}`・`gh api notifications`・`gh api user/repos` → 同上 403（生存は `gh api user` と `gh api rate_limit` のみ）
- ❌ **GitHub Actions パス（2026-07-02 に 403 化）**: `gh variable list/set`・`gh secret list`・`gh run list`・`gh workflow list`・`gh api repos/{o}/{r}/actions/...` → 403「Access to this GitHub Actions path is not permitted through this proxy.」
- ❌ **urllib 直叩きフォールバックは効かない**: `urllib.request` で `api.github.com` を呼んでも **同一プロキシを通るため同じ 403**（GraphQL・repos・actions/variables いずれも）。「urllib で代替」は誤り。
- ✅ **公式 MCP**: `mcp__github__*` は repo スコープ操作（Issue・PR・レビュー・マージ・ファイル取得・スレッド解決・search・Actions runs/workflows 等）が動作する。ただし **Actions variables/secrets の等価ツールは MCP に存在しない**（§2.4）。
- ✅ **git 操作は別系統で生存**: `git clone https://github.com/...`・`git fetch/pull/push`（origin）は git プロキシ経由で動作する。

## 1. 実機検証マトリクス（cloud_default・2026-07-02・Issue #133。旧: 2026-06-30・Issue #121）

| 操作 | 結果 | 備考 |
|------|------|------|
| `gh --version` | ✅ | 2.45.0 が存在 |
| `gh auth status` | ✅ exit 0 | 前提チェックは誤爆しない |
| `gh api user`（認証ユーザー） | ✅ | 生存する数少ない REST |
| `gh api rate_limit` | ✅ | 同上 |
| `gh api users/{u}`・`notifications`・`user/repos` | ❌ 403 | **2026-07-02 に 403 化**「sessions are bound to their configured repositories」 |
| `gh search repos/issues/code/prs`・`gh api search/...` | ❌ 403 | **2026-07-02 に 403 化**（旧検証では ✅ だった） |
| `gh api repos/{o}/{r}`（repo REST 全般） | ❌ 403 | 「connect the Claude GitHub App」 |
| `gh issue list/view`・`gh pr list`・`gh repo view`・`gh label list`・`gh release list`・`gh gist list`・`gh status` | ❌ 403 | 「GraphQL proxying is not enabled」 |
| `gh api graphql -f query=...` | ❌ 403 | GraphQL |
| `gh variable list`・`gh secret list`・`gh api repos/{o}/{r}/actions/variables` | ❌ 403 | **2026-07-02 に 403 化**「Access to this GitHub Actions path is not permitted through this proxy」 |
| `gh run list`・`gh workflow list` | ❌ 403 | Actions パス（同上） |
| urllib → `api.github.com/...`（graphql・repos・actions/variables） | ❌ 403 | 同一プロキシを通るため gh と同じ結果 |
| `gh repo clone {o}/{r}` | ❌ exit 1 | 内部で API 解決を伴うため失敗 |
| `git clone https://github.com/{o}/{r}.git` | ✅ | git プロキシ経由 |
| `git fetch/pull/push origin`・`git ls-remote` | ✅ | git プロキシ経由 |
| `mcp__github__get_me` | ✅ | |
| `mcp__github__list_issues` / `issue_write` / `pull_request_read` / `get_file_contents` | ✅ | repo スコープも動作 |
| `mcp__github__search_issues` / `search_code` / `search_pull_requests` | ✅ | search の MCP 代替（`repo:` 修飾でスコープ内に限定すること） |
| `mcp__github__actions_list` / `actions_get` / `get_job_logs` | ✅ | Actions runs/workflows の MCP 代替 |

## 2. コマンド別 代替パターン（gh → MCP）

repo スコープの `gh` は全てクラウドで 403 になるため、以下を **一次経路** として使う。

| やりたいこと（旧 gh コマンド） | クラウド一次経路（MCP） |
|----------------|----------------|
| `gh pr list --state open` | `mcp__github__list_pull_requests(owner, repo, state="open")` |
| `gh pr view {N}` | `mcp__github__pull_request_read(method="get", pullNumber=N)` |
| `gh pr view {N} --json reviews` | `mcp__github__pull_request_read(method="get_reviews", pullNumber=N)` |
| `gh pr view {N} --json comments` | `mcp__github__pull_request_read(method="get_comments", pullNumber=N)` |
| `gh pr view {N} --json files` | `mcp__github__pull_request_read(method="get_files", pullNumber=N)` |
| `gh pr diff {N}` | `mcp__github__pull_request_read(method="get_diff", pullNumber=N)` |
| `gh pr create` | `mcp__github__create_pull_request(owner, repo, title, head, base, body)` |
| `gh pr merge {N} --squash` | `mcp__github__merge_pull_request(owner, repo, pullNumber=N, merge_method="squash")` |
| `gh pr list --head {ブランチ}` | `mcp__github__list_pull_requests(owner, repo, head="{owner}:{ブランチ}", state="open")` |
| `gh issue list --label "X"` | `mcp__github__list_issues(owner, repo, labels=["X"], state="OPEN")` |
| `gh issue view {N}` | `mcp__github__issue_read(method="get", issue_number=N)` |
| `gh issue create` | `mcp__github__issue_write(method="create", title, body, labels)` |
| `gh issue comment {N} --body "..."` | `mcp__github__add_issue_comment(owner, repo, issue_number=N, body="...")` |
| `gh issue edit {N} --add-label "..."` | `mcp__github__issue_write(method="update", issue_number=N, labels=[...])` |
| `gh api repos/.../contents/{path}` | `mcp__github__get_file_contents(owner, repo, path)` |
| ファイル commit/push（CLI 失敗時） | `mcp__github__create_or_update_file` / `mcp__github__push_files` |
| `gh api graphql`（resolveReviewThread 等） | `mcp__github__resolve_review_thread` / `mcp__github__unresolve_review_thread` |
| `gh repo view` / repo メタデータ | `mcp__github__search_repositories` または `mcp__github__list_branches` 等の個別 MCP |
| `gh search issues "repo:{o}/{r} ..."` | `mcp__github__search_issues(query, owner, repo)` |
| `gh search prs "repo:{o}/{r} ..."` | `mcp__github__search_pull_requests(query, owner, repo)` |
| `gh search code "... repo:{o}/{r}"` | `mcp__github__search_code(query="... repo:{o}/{r}")` |
| `gh search repos` | `mcp__github__search_repositories(query)` |
| `gh run list` | `mcp__github__actions_list(method="list_workflow_runs", owner, repo)` |
| `gh run view {id}` / `gh run view --log` | `mcp__github__actions_get(method="get_workflow_run", resource_id)` / `mcp__github__get_job_logs` |
| `gh workflow list` | `mcp__github__actions_list(method="list_workflows", owner, repo)` |
| `gh workflow run {wf}` | `mcp__github__actions_run_trigger(owner, repo, workflow_id, ref)` |
| `gh release list` | `mcp__github__list_releases(owner, repo)` |
| `gh label list` | 一覧の等価 MCP なし。ラベル名が既知なら `mcp__github__get_label(owner, repo, name)`、網羅が必要なら `list_issues` 応答の `labels` から収集する |
| `gh api users/{u}` | `mcp__github__search_users(query)`（自分自身は `mcp__github__get_me`） |
| `gh variable list/set`・`gh secret list` | ❌ **MCP 等価ツールなし**（§2.4 参照。クラウドから GitHub Variables は読み書き不能） |

> **search 系の注意（Repository Scope）**: `search_issues` / `search_code` / `search_pull_requests` は
> repo 引数・`repo:` 修飾を省くとセッションスコープ外のリポジトリまで検索できてしまう。
> 必ず対象リポジトリを指定してスコープ内に限定すること。

### 2.4 GitHub Actions Variables / Secrets は MCP に等価ツールがない（2026-07-02）

🔴 **`gh variable list/set`・`gh secret list` と `repos/{o}/{r}/actions/variables` への urllib 直叩きは
2026-07-02 からクラウドで 403 ブロックされ、公式 GitHub MCP にも variables/secrets の等価ツールが
存在しない。** つまり **クラウドセッションから GitHub Variables を読むことも設定することも不能** になった。

- **env の供給**: クラウドセッションの環境変数は ① Claude.ai の環境設定（environment variables）
  ② secrets-broker（`SECRETS_BROKER_URL`/`SECRETS_BROKER_TOKEN` 設定時・`infra/secrets-broker/`）で供給する。
  `session-start.sh` の GitHub Variables 自動ロード（gh / `tools/gh_vars.py` の 2 系統）はクラウドでは両方 403 になる
  （フックは 403 を検知してその旨をログに出す。ローカル実行では引き続き動作する）。
- **env の新規設定**: 旧ルールの「`gh variable set` で Claude が自律設定」は **クラウドでは実行不能**。
  ユーザーがローカル端末で `gh variable set` を実行するか、Claude.ai 環境設定 / broker に登録する
  （= A-6 相当のユーザー作業。依頼時は具体的なコマンド・設定名を添える）。
- 詳細な env 運用は `docs/rules/env-vars.md` を参照。

> **GraphQL 専用操作**: `gh api graphql` の独自 mutation/query はクラウドで実行不能（urllib も不可）。
> review thread の resolve/unresolve は MCP に専用ツール（`resolve_review_thread` / `unresolve_review_thread`）が
> あるためそれを使う。MCP に等価が無い GraphQL 専用処理は、**ローカル実行に切り出す** か、必要なら
> ツール改修 Issue（B カテゴリ・`user-confirmation-minimization.md`）として起票する。

### 2.1 `mcp__github__list_issues` の `labels` は OR（gh CLI の `--label A --label B` は AND）

🔴 **gh CLI の `--label A --label B` は「A かつ B」（AND）だが、`mcp__github__list_issues(labels=[A,B])` は
GitHub GraphQL の `issues(labels:)` 引数に渡るため「A または B」（OR）で返る。** 単純な gh→MCP 置換では
意図しない Issue が混入する（例: `labels=["type:retro-try","status:waiting-claude"]` は
`type:retro-try`（status 不問）と `status:waiting-claude`（type 不問）の和集合を返す）。

**対策**: 複数ラベルで絞り込みたい場合は、`list_issues` を **最も絞り込み効果が高い単一ラベル** で呼び、
応答の `labels` 配列を見て **Claude が client-side で残りのラベル条件を AND 判定** する（該当しない Issue は除外する）。

### 2.2 `mcp__github__issue_write` の `labels` は全置換（gh CLI の `--add-label`/`--remove-label` は差分指定）

🔴 **`issue_write` の `labels` パラメータは Issue のラベルを完全に置き換える**（gh CLI の
`--add-label`/`--remove-label` のような追加/削除の差分指定ではない）。ラベルを 1 つ追加/削除したいだけでも、
**まず現在のラベル一覧を取得**（`list_issues` の応答 or `mcp__github__issue_read(method="get_labels")`）し、
そこから対象ラベルを足し引きした **フルリスト** を `labels` に渡す必要がある。

```
❌ mcp__github__issue_write(method="update", issue_number=N, labels=["status:in-progress"])
   → 他の既存ラベル（type:bug 等）が全て消える
✅ 現在のラベル ["type:bug","status:waiting-claude"] を取得
   → "status:waiting-claude" を除き "status:in-progress" を加えたフルリスト
   → mcp__github__issue_write(method="update", issue_number=N, labels=["type:bug","status:in-progress"])
```

### 2.3 ページングの既定値（gh CLI の `--limit 1000` に相当する指定はない）

`mcp__github__list_issues` / `list_pull_requests` の `perPage` は最大 100（既定はツール依存でそれ以下の場合あり）。
gh CLI の `--limit 1000` のような大きな上限指定はできないため、対象が 100 件を超えうる場合は
`perPage=100` を明示し、応答の `pageInfo.hasNextPage`/`endCursor` を見て `after` で追加ページを取得する
（本リポジトリ規模では通常 1 ページで足りるが、件数が多いプロジェクトでは省略しないこと）。

## 3. git 操作（クラウドで生存）

`git` は API プロキシとは別の git プロキシを通るため、以下は **そのまま使える**:

```bash
git clone --depth 1 https://github.com/kai-kou/claude-code-base.git   # ✅ gh repo clone の代わり
git fetch origin <branch>                                             # ✅
git pull origin <branch>                                              # ✅
git push -u origin <branch>                                           # ✅（push が 403/413/502 のときは L-079 のフォールバック）
```

`gh repo clone` は内部で API を叩くため **クラウドでは失敗する**。リポジトリ取得は
`git clone https://github.com/...`（認証はプロキシが付与）を使う。

## 4. Python スクリプトからの GitHub アクセス

`tools/*.py` が `subprocess` で `gh api repos/...` や `gh pr/issue` を呼んでいる場合、クラウドでは 403 になる。

- 取得系（read）: スクリプトが `gh` で失敗（403/非 0）したら、メインセッションの `mcp__github__*` ツールで直接操作する。
- GraphQL 系: **urllib で `api.github.com/graphql` を直叩きしない**（同一プロキシで 403）。MCP の等価ツールへ置換する。
- 🔴 **サイレント縮退の禁止（Issue #133 で一斉修正）**: gh 失敗時に「空リスト・0 件・False」へ静かに縮退する
  実装は、403 を「対象なし」と誤認させる（スナップショットが空になる・重複防止が無効化する等）。
  gh を呼ぶ `tools/*` は失敗時に **stderr へ `gh_unavailable` を明示し、専用 exit code / センチネル値で
  「取得失敗」を呼び出し元へ伝える**（`check_pending_pr_reviews.py` の `GhUnavailableError` → exit 3 が参考モデル）。
  呼び出し元（Claude・フック）は失敗シグナルを受けたら MCP で直接操作する。
- 🔴 **「取得失敗」と「0 件」を混同しない（L-074/L-086・Issue #130）**: `tools/check_pending_pr_reviews.py` は
  PR 一覧取得（`gh pr list`）自体が失敗した場合、**`NO_PENDING_PRS`（exit 0）を返さず** stderr に
  `ERROR: gh_unavailable`、stdout に `GH_UNAVAILABLE` を出力して **exit code 3** で終了する。
  呼び出し元は exit code を確認し、3 の場合は「0 件」と解釈せず下記の代替フローで直接取得すること。
  他の `tools/*.py` を新規に書く場合も同じ原則（取得失敗を沈黙して空リスト化しない）に従う。
- `check_pending_pr_reviews.py` 等が `FileNotFoundError`（gh 不在）や 403 を返した場合の代替フロー:

```
1. mcp__github__list_pull_requests(state="open") でオープン PR を取得
2. 各 PR について:
   a. mcp__github__pull_request_read(method="get_reviews") でレビュー取得
   b. mcp__github__pull_request_read(method="get_review_comments") でスレッド確認
   c. mcp__github__pull_request_read(method="get") で作成日時確認
3. needs_response / ready_to_merge をメインセッション側で判定する
```

## 5. ローカル実行との違い

`gh` が GitHub に直接到達できるローカル環境では、repo スコープ操作も `gh` で動く。その場合は従来どおり:

- repo 指定に `-R kai-kou/github-issue-shortcut` を付与する
- `gh pr create` に `--head {現在のブランチ}` `--base main` を付与する

クラウドかどうかは `CLAUDE_CODE_REMOTE` で判定できる（`true` ならクラウド = MCP 一次経路）。

## 6. 参照

| ドキュメント / ツール | 関係 |
|------------------------|------|
| `CLAUDE.md`「gh CLI / GitHub 操作」節 | 要約（本ファイルが SSOT） |
| `docs/rules/lessons-core.md` L-114 | クラウド gh ブロックの Hot 層 lesson |
| `docs/rules/lessons-core.md` L-079 | git push が 403/413/502 のときのフォールバック |
| `docs/rules/env-vars.md` | GitHub Variables がクラウド 403 化した後の env 供給・設定経路（§2.4 の詳細） |
| `.claude/skills/apply-base/SKILL.md` | ベース取得を git clone / MCP 経路で行う（gh api contents 非依存） |
