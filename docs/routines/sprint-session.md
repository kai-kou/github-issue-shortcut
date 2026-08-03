# スプリントセッション運用指示（ルーティンのエントリポイント・SSOT）

> **このファイルは Claude Code のルーティン（定期実行）から参照される唯一のエントリポイントである。**
> ルーティン側のプロンプトは「本ファイルを Read して従う」とだけ書かれており、**スプリントの挙動を変えたいときは
> ルーティン設定ではなく本ファイルを PR で編集する**（プロンプト不変の仕組み・2026-07-10 ユーザー指示）。

## 0. 前提

- 1 セッション = 1 スプリント（`docs/rules/session-sprint-rules.md`）。本ファイルの手順を上から実行し、完了したらセッションを終える
- 全行動は `CLAUDE.md`・`docs/rules/`（CP-1〜6・A-1〜A-6・PR 自律化）に従う
- 対象がなければ **no-op で終了してよい**（理由 1 行だけ記録。宣言の儀式は不要）

## 1. スプリントの流れ

### Step 1: 引き継ぎ回収（最優先）

```bash
python3 tools/check_pending_pr_reviews.py --mine --actionable-only --json   # 自セッション系 PR
python3 tools/check_pending_pr_reviews.py --actionable-only --json          # 孤児 PR 救済
```

- 未マージの自 PR・レビュー指摘・CI 失敗があれば、その対応を今回のスプリントとする（`docs/rules/pr-review-flow-summary.md`）

### Step 1.5: 待ち状態 Issue の事実確認監査（毎回・軽量）

対象 Issue を選定する前に、待ち状態 Issue が実態と乖離していないかを **観測可能な証跡で機械検証** し、乖離があれば自律反映する。ユーザーに「完了しましたか？」と確認を求めるのではなく、まず自分で実測する（L-113: 実結果でのみ断定・CP-6）。

> 本 Step は **事実確認による解消検知に限定した軽量レーン** である。検証は各 Issue のブロック理由に直接関係する項目のみ行い（全項目の網羅検証はしない）、A/B/C/D 分類による詳細トリアージや複数 Issue の AskUserQuestion 集約が必要になった場合は `waiting-user-handler` スキルへ委譲する（二重 ping 防止のため、再掲 ping の 72h ルールは両レーン共通）。

1. **`status:waiting-user` / `status:blocked` の全 Issue**（通常 0〜3 件）について、ブロック理由が実際にはすでに解消されていないかを検証する。検証手段の例:
   - 本番動作: `GET /api/ready`（自己診断）・`bash tools/smoke_prod.sh [対象URL]`（設定・D1・ログイン経路の実測。省略時は本番）
   - Cloudflare 実状態: Cloudflare API / Developer Platform MCP（Worker・Secrets 名・D1・Builds 設定）
   - GitHub 実状態: App 公開ページ（https://github.com/apps/issue-shortcut）・マージ済み PR・Issue コメント履歴
   - 仕様確認: ブロック理由が「できなかった」系なら、公式ドキュメントで仕様上の想定挙動でないか確認する（例: Setup URL 入力不可は OAuth during installation ON 時の仕様・#9）
2. **解消を実測確認できた場合**: 検証方法と実結果を記した事実確認コメントを残し、Issue をクローズ（Done Criteria 充足時）または `status:waiting-claude` へ戻す（作業再開可能になった場合）
3. **実測で判定できない・真に人間作業待ちの場合**: そのまま維持する。ただし Issue の最新コメント（Claude の再掲・依頼コメントを含む）から **72 時間超** 経過している場合に限り、依頼内容（具体的アクション・放置した場合の影響）を再掲コメントする。最新コメントがすでに Claude による再掲・依頼で 72 時間未満ならスキップ（4 時間ごとに毎回 ping しない・`user-notification-triage.md` §3）
4. **クローズ漏れの検出**: open Issue のうち `Closes #N` 付き PR がマージ済み（`state=MERGED` を実結果で確認）のもの、または Done Criteria がマージ済み実装で満たされているものを発見したら、根拠（PR 番号・実測結果）をコメントしてクローズする

監査での反映（クローズ・ラベル変更）は成果として Issue コメントに記録する。反映があってもなくても Step 2 の Issue 選定へ進む（監査だけで終了しない）。

### Step 1.6: 本番の使用量チェックと利用状況の履歴化（毎回・軽量・NFR-14 の検知実装 / #235）

Workers 無料枠（**100,000 requests/日**・UTC 00:00 リセット）の消費量を実測し、**同時に日次値を履歴として永続化する**。

> **なぜルーティンでやるのか**: ① Cloudflare の Notifications には「Workers のリクエスト数が無料枠の X% に達したら通知する」というアラート種別が **存在しない**（`alerting/v3/available_alerts` を全件確認済み。Budget Alert / Billing Usage Alert は金額ベースで、課金の発生しない Free プランでは機能しない・#171 の実測）。枠を超えると **Error 1027 で当日いっぱい全停止** する。② GraphQL Analytics は **32 日（4w4d）より過去のレンジを拒否する** ため、取り込まずに放置すると履歴が消える。本 Step が現状で唯一の検知手段かつ唯一の履歴化手段である。

**手順 1**: `mcp__Cloudflare_API__execute` で直近 30 日の日次値を取得する（アカウント ID は MCP 側が注入するので `accountId` をそのまま使う）。

```js
async () => {
  const q = `query($a:String!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){
    workersInvocationsAdaptive(limit:200,orderBy:[date_ASC],
      filter:{datetime_geq:$s,datetime_leq:$e,scriptName:"github-issue-shortcut"})
    { dimensions { date } sum { requests errors subrequests } } }}}`;
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86400000).toISOString();
  const r = await cloudflare.request({ method: "POST", path: "/graphql",
    body: { query: q, variables: { a: accountId, s: from, e: now.toISOString() } } });
  const rows = r.result?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
  return JSON.stringify({ viewer: { accounts: [{ workersInvocationsAdaptive: rows }] } });
}
```

**手順 2**: 応答をそのまま取り込み → データブランチ `telemetry/worker-usage` へ永続化 → サマリー出力する。

```bash
python3 tools/record_worker_usage.py --ingest - --push --summary <<'JSON'
{ ← 手順 1 の応答 JSON をそのまま貼る }
JSON
```

同一日はフィールド毎 max でマージされるので、1 日に何度実行しても値は後退せず、差分がなければ push は no-op になる。ローカルの `content/analytics/worker_usage/` は gitignore 対象の作業コピーで、正本はデータブランチ側（fresh コンテナでは実行時に自動で hydrate される）。

この push には、公開ダッシュボード（[利用状況ページ](https://kai-kou.github.io/github-issue-shortcut/analytics/)・#239）が読む `dashboard.json`（日次 30 / 週次 12 / 月次 6 バケット）も含まれる。**ダッシュボードの更新はこの Step だけで完結し、`site/` を触る必要はない**（`site/` は main 上にあり、更新のたびに PR が要る構造を避けるための設計・議論 `wae-dashboard-20260803` の D-3）。

判定は `--summary` の **「当日（UTC）」行**（`→ 正常 / Warning / Critical`）に対応する。同じ出力の「期間内ピーク」行は参考値で、過去のスパイクを示すだけなので、それを理由にエスカレーションしない。

| 当日の requests | 判定 | 対処 |
|---|---|---|
| 70,000 未満（70%） | 正常 | **記録不要**（履歴の push だけして Step 2 へ。毎回の正常報告はしない） |
| 70,000〜89,999（70〜90%） | Warning | #195 にサマリーをコメントし、流入源（Bot・スクレイパー・記事バズ）を調査する |
| 90,000 以上（90%〜） | Critical | レート制限の強化を検討し、有料プラン移行（$5/月）の要否をオーナーへ打診する（**課金設定の変更は A-6**） |
| `errors` が急増、または Error 1027 を観測 | 全停止中 | 最優先で対応。UTC 00:00 のリセットまで自然復旧しない |

`errors` が 0 でないときは、requests が閾値未満でも原因を確認する（アプリの例外は `observability` のサンプリング 5% でしか残らないため、件数の推移が一次シグナルになる）。

**手順 3（週次のみ）**: `--report-due` が `yes` を返したときだけ、サマリーを **#195**（利用状況計測の再評価）へコメントし、投稿済みを記録する。閾値未満の週は何もしない（毎回 ping しない）。

```bash
python3 tools/record_worker_usage.py --report-due          # yes のときだけ手順を続ける
python3 tools/record_worker_usage.py --summary             # コメント本文
python3 tools/record_worker_usage.py --mark-reported --push
```

> **取れる数字と取れない数字**: requests / errors / subrequests は取れるが、**ユニーク利用者数・DAU は取得できない**（Workers のメトリクスにユニーク軸がなく、workers.dev のためゾーンの `uniques` も使えず、`invocation_logs: false` + サンプリング 5% でリクエスト単位ログも残していない）。利用者数の計測を足すかどうかは #195（Workers Analytics Engine の導入判断）の範囲で、本 Step の数値をその判断材料にする。
>
> 履歴の参照: `git show origin/telemetry/worker-usage:content/analytics/worker_usage/SUMMARY.md`

### Step 2: 対象 Issue の選定（上から順に 1 件）

1. `status:in-progress` で 4 時間以上更新のない Issue（stale 再開・CP-3）
2. `status:waiting-claude` の Issue
3. 未着手のマイルストーン Issue を **`ms:M0` → `ms:M1` → `ms:M2` → `ms:M3` の順**、同一マイルストーン内は Issue 番号順
   - Issue 本文の「依存」に未完了 Issue が書かれていたらスキップして次へ
   - `status:waiting-user` / `status:blocked` は実装対象として選定しない（Step 1.5 の事実確認監査による反映は除く）
   - **`ms:M4` は保留中のため着手禁止**（ユーザーの実施判断待ち・2026-07-10 決定）

選定できる Issue がなければ: オープン PR・リポジトリ衛生（Stale Issue / Orphan PR）を確認して終了。

### Step 3: ロックとプランニング（CP-4）

- 選定 Issue に `status:in-progress` を付与（最初のアクション）
- Issue へ Sprint Planning コメントを投稿（ゴール 1 文・対象・編成。`session-sprint-rules.md` §2）

### Step 4: 実装 → PR → マージ

- 要件の正は `docs/requirements/00-requirements.md`（FR/NFR ID）と `docs/requirements/04-milestones.md`（Done 判定）。技術判断の根拠は `docs/research/` を参照
- 作業ブランチで実装 → `python3 tools/check_cjk_markdown.py --fix --changed` → セルフレビュー → PR 作成（本文に `Closes #N`・`Sprint Goal:`・`sp:N`・`Session-Id:`）→ `/code-review` セルフレビュー → 指摘対応 → **squash 自動マージ**（恒久委任済み・確認不要）
- マージ後: Issue クローズを確認し、`04-milestones.md` の該当 Done 判定に進捗があれば同 PR で更新

### Step 5: ブロック時の扱い

- 人間作業（アカウント設定・Secrets 投入等 = A-6 相当）が必要: 必要な操作を **手順付きで** Issue にコメントし `status:waiting-user` に変更して次の対象へ（丸投げ禁止・`user-notification-triage.md` §3）
- 技術的ブロック: `problem-investigation-protocol.md` の 5 ステップを尽くしてから `status:blocked` + 調査記録

## 2. ガードレール

| 項目 | ルール |
|------|--------|
| スプリントサイズ | 1 スプリント 1 Issue（最大 `sp:8`）。終わらなければ WIP コミット + Issue に進捗コメントで次スプリントへ引き継ぐ |
| 品質ゲート | `docs/project-mission.md` のドメイン品質ゲート（E2E 未確認で main にマージしない等）を遵守 |
| M0 の人間依存 | Cloudflare / GitHub App のセットアップ（waiting-user Issue）が未完了の間は、それに依存しないタスク（雛形・CI・テスト整備）だけ進める |
| サーキットブレーカー | 修正サイクル 2 回超で STOP → ユーザー報告（A-4） |
| スコープ | 対象 Issue の範囲外のファイルを「ついで」に変更しない。改善案は別 Issue 起票 |

## 3. 本ファイルの変更方法

- 挙動（優先順位・ガードレール・頻度以外）を変えたいとき: **本ファイルを編集する PR を出す**（ルーティン設定は触らない）
- 実行頻度・有効/無効を変えたいとき: ルーティン側（claude.ai の Routine 設定 or `update_trigger`）で変更する
