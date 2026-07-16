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

1. **`status:waiting-user` / `status:blocked` の全 Issue**（通常 0〜3 件）について、ブロック理由が実際にはすでに解消されていないかを検証する。検証手段の例:
   - 本番動作: `GET /api/ready`（自己診断）・`bash tools/smoke_prod.sh`（設定・D1・ログイン経路の実測）
   - Cloudflare 実状態: Cloudflare API / Developer Platform MCP（Worker・Secrets 名・D1・Builds 設定）
   - GitHub 実状態: App 公開ページ（https://github.com/apps/issue-shortcut）・マージ済み PR・Issue コメント履歴
   - 仕様確認: ブロック理由が「できなかった」系なら、公式ドキュメントで仕様上の想定挙動でないか確認する（例: Setup URL 入力不可は OAuth during installation ON 時の仕様・#9）
2. **解消を実測確認できた場合**: 検証方法と実結果を記した事実確認コメントを残し、Issue をクローズ（Done Criteria 充足時）または `status:waiting-claude` へ戻す（作業再開可能になった場合）
3. **実測で判定できない・真に人間作業待ちの場合**: そのまま維持する。ただし最後のユーザー向け依頼コメントから **72 時間超** 経過していたら、依頼内容（具体的アクション・放置した場合の影響）を 1 回だけ再掲コメントする（4 時間ごとに毎回 ping しない・`user-notification-triage.md` §3）
4. **クローズ漏れの検出**: open Issue のうち `Closes #N` 付き PR がマージ済みのもの、または Done Criteria がマージ済み実装で満たされているものを発見したら、根拠（PR 番号・実測結果）をコメントしてクローズする

監査での反映（クローズ・ラベル変更）は成果として Issue コメントに記録する。反映があってもなくても Step 2 の Issue 選定へ進む（監査だけで終了しない）。

### Step 2: 対象 Issue の選定（上から順に 1 件）

1. `status:in-progress` で 4 時間以上更新のない Issue（stale 再開・CP-3）
2. `status:waiting-claude` の Issue
3. 未着手のマイルストーン Issue を **`ms:M0` → `ms:M1` → `ms:M2` → `ms:M3` の順**、同一マイルストーン内は Issue 番号順
   - Issue 本文の「依存」に未完了 Issue が書かれていたらスキップして次へ
   - `status:waiting-user` / `status:blocked` はスキップ（触らない）
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
