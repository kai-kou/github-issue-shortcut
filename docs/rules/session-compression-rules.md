# セッション圧縮ルール（Context Compaction・Hot 層サマリー）

Claude Code のセッション圧縮（Auto Compaction）発生時の動作と運用ルール。全文（モデル別コンテキスト表・
PostCompact 自動コミットの内部動作・シンボリックリンク自動修正の詳細）は
`docs/rules/session-compression-rules-detail.md` を参照。

## セッション圧縮の仕組み

| 項目 | 内容 |
|------|------|
| **発生タイミング** | コンテキストウィンドウが約 95% に到達した時（自動）、または `/compact` コマンド（手動） |
| **CLAUDE.md の扱い** | 圧縮後にディスクから **完全に再読み込み** される（失われない） |
| **`.claude/rules/` の扱い** | 全ファイルが圧縮後に再読み込みされる（失われない） |
| **会話内の口頭指示** | 圧縮により **失われる**（CLAUDE.md に書かれた指示のみ保持） |

モデル別コンテキストウィンドウサイズ（Opus 4.8 / Sonnet 5 = 1M トークン、Haiku 4.5 = 200K トークン）と実運用上の注意は detail 版を参照。1M トークンあっても不要な情報を詰め込まない。

## 圧縮後のフックイベント

`PostCompact`（圧縮完了直後・未コミット変更の自動コミット + シンボリックリンク自動修正）と `InstructionsLoaded`（`load_reason: "compact"`・CLAUDE.md 再注入後のログ記録）。`.claude/hooks/post-compact.sh` が設定済み。

## PostCompact 自動コミット機能（要点）

圧縮後の SessionStart クリーンアップ（`git checkout -- .` / `git clean -fd`）は **未コミットのまま残っていた作業内容を全て消す**。この対策として `post-compact.sh` が圧縮直後に未コミット変更を検出し、`main`/`master` 以外のブランチであれば自動で `git add -A && git commit && git push` する。内部動作の詳細（対象条件表・stdout ログの判断材料・wip コミットの扱い）は detail 版を参照。

## シンボリックリンク方式の運用ルール

- `docs/rules/` に実体を置き、`.claude/rules/` にシンボリックリンクを置く方式を採用。シンボリックリンクは圧縮後も正常に動作する（リンク先が再解決される）。タスク依存ルール（常駐不要なもの）は `docs/rules/` のみに置き、スキル起動時に Read する。
- **新規ルールファイル追加時の必須手順**: ① `docs/rules/{ルール名}.md` に実体作成 ② `ln -s ../../docs/rules/{ルール名}.md .claude/rules/{ルール名}.md` ③ `./tools/check_rules_sync.sh` で検証 ④ **Hot 層予算内か確認**（`wc -c .claude/rules/*.md` の実体合計と `token-optimization-rules.md` の予算値を突き合わせ、超過するなら Warm 降格 or 既存 Hot ファイルの追加圧縮を検討してから追加する・Issue #146）⑤ 両方を `git add` してコミット。
- 手順②を忘れるとルールが `.claude/rules/` に存在せず読み込まれないが、`session-start.sh` / `post-compact.sh` が `check_rules_sync.sh --fix` で自動検出・修正する（detail 版参照）。

## 圧縮時に失われないようにするベストプラクティス

| 情報の種類 | 保持方法 |
|-----------|---------|
| プロジェクトルール | `CLAUDE.md` または `.claude/rules/*.md` に記載する |
| **作業中のファイル変更** | **PostCompact フックが自動コミット＆プッシュ** |
| セッションをまたぐ作業状態 | GitHub Issue コメントに記録する |
| 確認・判断依頼の内容 | ユーザーに確認する前にコミット＆プッシュする（`session-safety-rules.md` 参照） |
| 会話内の口頭指示 | **CLAUDE.md に反映しない限り圧縮後に失われる** → 重要なルールは必ず CLAUDE.md に書く |

## 禁止事項

- 「次のセッションで気をつける」だけで済ませない（CLAUDE.md またはルールファイルに反映する）
- **常時必要なルール** を `.claude/rules/` のシンボリックリンクなしで `docs/rules/` のみに置かない（タスク依存ルールは `docs/rules/` のみで可・`ESSENTIAL_RULES` に含まれないものは symlink 不要）
- 新規ルール追加時に `check_rules_sync.sh` の実行および Hot 層予算チェックを省略しない
