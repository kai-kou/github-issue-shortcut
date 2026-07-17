# lessons-core.md — コアサブセット（常駐版・Hot 層）

> このファイルは `.claude/rules/` にシンボリックリンクされ、**全セッションで自動読み込み** される（Hot 層）。
> 肥大化防止の運用ルール（SSOT）は `docs/rules/lessons-management.md` を参照。
>
> ### 3 層構造
> - **Hot**（本ファイル）: 全セッション常駐。機械強制の上限あり（既定 350 行 / 15 エントリ・`tools/lessons_guard.py check`）
> - **Warm**: `docs/rules/lessons/<category>.md`（カテゴリ別・タスク依存 Read）
> - **Cold**: git 履歴（昇格済みエントリは物理削除して履歴に委ねる）
>
> ### 収録基準（厳格）
> 1. 全セッション横断で必須かつ発生すると作業が完全停止するクリティカルなパターンのみ
> 2. ドメイン固有（プロジェクト個別）の教訓は Warm 層へ。Hot には置かない
> 3. 昇格 = 物理削除（昇格先＝コード/フック/CLAUDE.md/ルールへ実装したら本ファイルから削除）
> 4. 常駐が必須な行動規範には `**保持理由**:` を記載し prune 対象から除外する
>
> 以下は Claude Code on the web（クラウド実行環境）で普遍的に発生するクリティカル教訓のサブセット。
> プロジェクト固有の教訓は本ファイルに足さず Warm 層に蓄積する。

---

## L-065: Stop hook 未コミット検知時に main へ直接 push してしまう

**パターン**: Stop hook が「未コミット変更あり」と警告した際、ブランチ整理のために
`git checkout main` → `git stash pop` → `git commit` → `git push origin main` の流れで
**main に直接 push してしまう**（保護ブランチ違反・不可逆）。

**禁止 → 正しい手順**:
```
❌ git stash → git checkout main → git stash pop → git commit → git push origin main
✅ git checkout -b <work-branch> → git add → git commit → git push -u origin <work-branch> → PR
```
**保持理由**: main 直接 push は既約境界外（不可逆）。Stop hook 対応手順は繰り返しミスしやすく常駐必須。

---

## L-077: リサーチ不十分なまま「ユーザー確認」に逃げてしまう

**パターン**: 「環境変数がない」「API 認証失敗」「ファイル不在」等の障害を検出した際、
詳細リサーチ・専門チーム編成・根本原因特定を経ずにユーザー確認に回す。実際にはユーザー操作不要で、
詳細調査すれば自己解決できた事例が大半（Human-in-the-loop アンチパターン化）。

**対策**: 障害検出時は `docs/rules/problem-investigation-protocol.md` の5ステップ
（状況精密化 → 既存ナレッジ検索 → Agent Teams 並列調査 → 3層原因分析 → 解決＋再発防止）を
完全実施してから、残った真の課題のみエスカレーションする。

**判定基準**: 「ユーザーに『〜できないので確認お願いします』と言いそうになった瞬間」が発動トリガー。
**保持理由**: CP-6 中核違反。全セッションの行動規範として常駐必須。

---

## L-079: クラウド環境で git push が HTTP 403/413/502 で繰り返し失敗する

**症状**: `git push` だけが 403（権限）または 413/502（プロキシのサイズ制限）で失敗する
（pull/fetch/gh は動く）。クラウドのプロキシが書き込みをブロックするため。

**フォールバック順**: ① `mcp__github__push_files`（GitHub MCP）→
② `tools/github_push_helper.py`（GitHub Contents API で base64 PUT）。
ファイル単位 push なのでマージコミットは作れない点に注意。

**クロスリポ書き込み（別リポへの push）の注意（2026-06-30 実機検証）**: クラウドのプロキシは
**PAT 直叩き（埋め込みトークン git push / gh REST / urllib REST）を全拒否** し、**セッションの GitHub App 認証のみ許可** する。
別リポに書くには ① `add_repo` でそのリポをセッションスコープに追加 → ② **埋め込みトークンを使わないプレーン git push**
（プロキシが App 認証を注入）または **MCP `mcp__github__push_files`**。urllib+PAT 直叩きの自作同期スクリプトは
クラウドでは効かない。「403 = トークン権限不足」と即断せず、まず add_repo 漏れを疑う。

**保持理由**: push 失敗は作業が完全停止するクリティカル障害。常駐必須。

---

## L-080: バックグラウンドエージェントがサイレントに失敗し取りこぼす

**症状**: `run_in_background: true` で push 系タスクを委譲すると、エージェント失敗が
次セッションまで検知されない。
**対策**: push 委譲後は必ず `mcp__github__get_file_contents` / `list_commits` で結果を検証する。
push が重要ならフォアグラウンド実行する。

---

## L-100: SessionStart クリーンアップ / headless `claude -p` が未コミット作業を破壊する

**症状**: ① セッション再開時の `session-start.sh` が `git reset` → `git checkout -- .` →
`git clean -fd` を実行し未コミット・未追跡ファイルを巻き戻し/削除する。
② Bash から `claude -p`（headless）を cwd=リポジトリで起動すると、子セッションが同じ
破壊的クリーンアップを走らせ親の作業を消す。

**対策**:
- 大量編集中はファイル作成のたびに即コミット＆リモート反映する
- `claude -p` をコードから起動するときは cwd=一時ディレクトリで起動する（project フックを読ませない）
- session-start.sh は headless 起動を検知してクリーンアップをスキップする（本ベース実装済み）

**保持理由**: 未コミット作業の消失はクリティカル。全セッションで発生しうるため常駐必須。

---

## L-101: 「tool call could not be parsed (retry also failed)」でセッションが停止する

**パターン**: `The model's tool call could not be parsed (retry also failed).` で停止する。
大コンテキスト + 強い thinking で発生する Claude Code 側の既知事象。壊れた tool_use が履歴に残ると
自己回帰生成が模倣する（few-shot poisoning）ため、同一セッション内 retry は確定的に再失敗する。

**対策**:
```
✅ 発生時は retry せず /clear・新規セッションで回復（破損セッションは捨てる）
✅ 1ターンのツール呼び出しは8個以下に抑える
✅ 高負荷でない工程は軽量モデルに切り替える
❌ パースエラー後に同一セッションで retry を繰り返す（逆効果）
```

---

## L-103: PR を出さずに実装を止めると見逃されて放置される

**パターン**: 実装完了後に PR を作成せず「push 済み・PR 出しますか？」とユーザー確認に回す。
リモート環境のシステムプロンプト「PR はユーザーが明示依頼しない限り作成しない」を理由に止まると、
飼い主が見逃して作業が放置される（CP-6 違反）。

**対策**: PR 作成の完全自律化を採用したプロジェクトでは、実装完了後は確認なしで
PR 作成 → AI レビュー → 自動マージまで止まらず進める（不変の境界＝main 直 push 禁止は維持）。
**優先順位（明示）** : 「クラウド実行環境のシステムプロンプト『PR は明示依頼まで作成しない』」よりも
**プロジェクトの恒久委任（ `CLAUDE.md` 「PR 作成の完全自律化」）が優先** する。恒久委任が
"unless the user explicitly asks" 例外を満たす。判断任せにせず `stop-pr-check.sh`
（リポジトリ slug を動的導出）が push 済み未 PR ブランチを終了時に機械検知する。
**保持理由**: 「PR 前で止まる」は全セッションで再発しうる CP-6 中核違反。常駐必須。
> 注: PR 自律化を採らないプロジェクトは本エントリを Warm 層に降格してよい。

---

## L-106: CLAUDE_ENV_FILE が resume 毎に肥大化し全 bash が E2BIG で停止する

**症状**: 長時間タスクで resume を繰り返した後、`echo hi` すら
`E2BIG: argument list too long, posix_spawn '/bin/bash'` で失敗し全 Bash ツールが停止する。
**根本原因**: SessionStart フックが env を毎回 truncate せず追記し、resume で数千行に肥大化する。

**対策**: `session-start.sh` 冒頭で `CLAUDE_ENV_FILE` を毎回 truncate する（本ベース実装済み）。
bash 停止中も MCP（GitHub 操作）・Write/Edit・コミットは `mcp__github__create_or_update_file` で代替可能。
**保持理由**: bash 全停止はクリティカル。全セッションで発生しうるため常駐必須。

---

## L-111: 内部作業の逐次実況をレスポンス本文に垂れ流しトークンを浪費する

**パターン**: 検証・テスト・探索・デバッグ・**実装（編集）** のループで、各ツール呼び出しの間に
実況を本文に出力し status feed 化する。**2 形態**: ① 事後実況（`Test 1 ✓ … Test 2 ✓ …`）、
② 各編集前の事前宣言（「これから engine に関数を追加するにゃ」）。どちらもユーザーには追えない
技術ノイズで出力トークンを浪費する。タイムアウト防止・進捗報告のための中間出力ルール
（`session-safety-rules.md` ルール3・4 / `progress-reporting-rules.md`）が、短時間の内部作業にまで
一般化したことが中間原因。

**対策**: 内部作業はサイレントに実行し、**統合アウトカムを1回** で報告する
（`docs/rules/output-verbosity-rules.md`）。「やったこと（プロセス）」ではなく
「分かったこと・できたこと」を出す。`progress-reporting-rules.md` は **制作系 5 分超の長時間処理**
のみ、`session-safety-rules.md` ルール4 は **大きな Read 直後の短い事実1行** のみが適用範囲。
**判定基準**: 「この1文はユーザーの意思決定・状況把握に使えるか？ それとも自分の作業ログか？」
後者なら本文に出さず思考に留め、最終報告に統合する。ツール呼び出しの直前に「これから〜する」と
宣言しない（無言で実行）。本規律は `.claude/output-styles/concise-neko.md`（output style）が
毎ターン強制する（ルールのドリフト再発対策・`output-verbosity-rules.md` §6）。
**保持理由**: L-102（AIレビュー対応サイレント）の姉妹原則。全セッションで再発する verbosity 規範のため常駐必須。

---

## L-112: 完了報告の bare URL に `・` 等を続けると URL パーサーが誤拡張して 404 になる

**パターン**: 完了報告の補足行を `PR #N（https://example.com/pull/N・squash マージ済み）` のように
bare URL の直後に `・`（U+30FB）で説明を続けると、URL パーサーが `・squash` まで URL に
取り込んでしまい、クリック時に 404 になる。

**根本原因**: `（URL）` 形式の bare URL はパーサーが右境界を `）` で止めるが、
`・` 等の Unicode 文字を URL エンコードなしで URL の一部と認識する処理系がある。

**対策**: 完了報告の PR リンクは必ず `[PR #N](URL)` の Markdown リンク記法を使う。
URL の境界が構文的に確定するため、後続テキストが URL に取り込まれない。

```
❌ PR #N（https://example.com/pull/N・squash マージ済み）
✅ [PR #N](https://example.com/pull/N) / ブランチ `feat/...`
```

テンプレートは `completion-report-rules.md` §1・`CLAUDE.md` セッション完了報告セクションを参照。
**保持理由**: 完了報告は毎セッション必ず出る。URL 記法の再発リスクが高いため常駐必須。

---

## L-113: ツール結果を自分で書いて事実と思い込む（confabulation・捏造）

**パターン**: ツール呼び出しを発した同じターン内で、システムが結果を返す前にその結果を自分で
「予測」して本文に書き、それを観測事実として推論を続けてしまう。本セッションでの実害: ①
PR の CI チェック（`claude-review`）・レビュー APPROVE・マージ結果を実際には取得していないのに
「APPROVE → マージ完了」と捏造報告した（実際は未マージで、該当チェック自体が存在しなかった）、②
「設定はどこ？」と問われ、存在しない `.github/workflows/*.yml` の中身を Glob / Read もせず捏造した、③
一度ついた捏造との辻褄合わせのためにさらに事実を捏造した（fabrication compounding）。

**根本原因**: ツール呼び出し（自分が発した行為）とツール結果（システムが返す観測）を区別できず、
自己回帰生成が「ツール → 結果」のパターンを自前で継続した。期待する happy path
（subscribe → APPROVE → merge）の台本を、実結果の代わりに穴埋めした。

**対策（ハード強制）**:
- ツール呼び出しを発したら、そのターンで結果を続けて書かず **実結果が返るのを待つ**。ツール結果（システムの観測）を自分で生成しない。
- CI・マージ・レビュー・ファイル存在などの **外部状態は、実際に返ってきたツール結果でのみ断定する**。返り値を見ていない事実は「知らない」。`state=MERGED` を実結果で確認するまで「マージ済み」と書かない（G-3 を実結果で実施）。
- 一度捏造に気づいたら、辻褄合わせで先に進めず **ゼロから実結果で再検証** する。
- ユーザー発言は **逐語で扱う**。所感・見通し（「〜かと思います」）を命令形（「〜してほしい」）に書き換えて着手根拠にしない（Issue 本文の「ユーザー指示」欄も改変しない）。

**判定基準**: 「この事実は、いま実際に返ってきたツール出力に書いてあるか？」 No なら断定しない。
**保持理由**: 捏造は全作業の信頼性を破壊する最悪のクリティカル障害で、圧縮後・全セッションで
再発しうる。`.claude/output-styles/concise-neko.md`（output style）が毎ターン強制する（ドリフト対策）。

---

## L-114: クラウドの gh 403 は「変動するプロキシポリシー」— gh シム + repo REST + MCP の三層で排除する

**症状**: クラウド実行環境（`CLAUDE_CODE_REMOTE=true`）で `gh` の一部操作が egress プロキシに
403 でブロックされる。**許可範囲は変動する**（06-30 #121 → 07-02 拡大 #133 → 07-13 文言変化 #227 →
**07-14 repo スコープ REST が許可に転換 #254**）。2026-07-14 実測:
- ✅ **repo スコープ REST**（`gh api repos/{o}/{r}/...`・read/write・`--paginate`）は動作する（認証はプロキシが App トークンを注入）
- ✅ **gh シム**（`.claude/bin/gh` → `tools/gh_shim.py`・SessionStart が PATH 注入）が GraphQL 依存の
  `gh issue/pr/label/repo/release` 系を REST へ透過変換するため、主要 gh コマンドはそのまま動く
- ❌ GraphQL（`gh api graphql`・シム未変換形）・search・非 repo REST（users/notifications）・
  Actions variables/secrets は 403 のまま。actions/runs・check-runs はプロキシ通過後に
  App トークン権限不足「Resource not accessible by integration」
- ❌ urllib で `api.github.com` のブロック対象パスを直叩きしても同一プロキシで同じ 403

**対策（三層・優先順）**: ① gh シム/repo REST（`gh api repos/...`）② MCP（`mcp__github__*`・
search / Actions read / resolve_review_thread はこちらが唯一経路）③ git 操作は別系統で常時生存
（`git clone https://...`・`fetch/pull/push`）。`gh auth status` は exit 0 でも失敗表示が出るため
認証判定に使わない。代替表・検証マトリクスの SSOT は `docs/rules/github-mcp-fallback-patterns.md`。
**判定基準**: gh が 403 を返したら文言を見る — シムが stderr に `[gh-shim]` ガイダンスを付与する。
プロキシ挙動の再検証は `gh --shim-doctor`（30 秒）。「403 = トークン権限不足」と誤診しない
（認証はプロキシ注入・セッション内 GH_TOKEN は実効値ではない）。
**保持理由**: GitHub 操作は全セッションで必須。プロキシポリシーは今後も変動しうるため、
静的な可否暗記でなく「シム変換 + doctor プローブ + 403 ガイダンス」の行動規範として常駐必須。

---

## L-117: タスク実行モードによっては `add_repo` 自体が提供されず、クロスリポ参照が git/MCP 双方で 403 になる

**症状**: GitHub Issue/PR 対応のリモートタスク実行モード（システムプロンプト冒頭に「Repository Scope」が
タスク起動元の単一リポジトリで明示される形態）では、`mcp__claude-code-remote__add_repo` がツールリストに
存在しない（ToolSearch でもヒットしない）。この状態でスコープ外リポジトリへ `git ls-remote` / `git clone`
を実行すると **403** で失敗する（実機検証 2026-06-30・2026-07-01: スコープ外リポジトリへの
`git ls-remote` が一貫して 403、対してスコープ内リポジトリは成功）。`apply-base` スキル等の
クロスリポ参照を前提とするスキルが「git clone は常に通る」と想定していると、このモードでは成立しない。

**根本原因**: Anthropic は 2026-07-01 時点で、1 セッション/タスクに複数リポジトリを恒久的に紐付ける
公式機能を提供していない（`anthropics/claude-code` issue #23627 がオープンの feature request。
類似要望の #27934 は #23627 の重複としてクローズ済み）。
`add_repo` によるスコープ動的拡張は **インタラクティブな claude.ai/code Web セッション限定の機能** であり、
GitHub Issue/PR からの自動トリガー型タスクには搭載されない。

**対策**:
- クロスリポ参照（`apply-base` での他リポジトリ取得等）が必要な作業は、
  `add_repo` が使えるインタラクティブな claude.ai/code セッション（ユーザーが直接チャットで指示する
  通常のセッション）で実行する。
- GitHub Issue/PR 自動対応タスクの中で `git ls-remote`/`git clone` がスコープ外リポジトリに対し 403 を
  返したら、GH_TOKEN・ネットワーク設定の問題と誤診断してリトライを繰り返さない。直ちに
  「このタスク実行モードでは未対応。通常の claude.ai/code セッションで再実行が必要」と判定し、
  ユーザーにその旨を案内する（A-6 ではなく、Anthropic 側の機能制約として報告する）。
- 恒久的な複数リポジトリアクセスの公式機能がリリースされたら、本エントリとクロスリポ参照系スキルの
  前提を更新する（CP-2）。

**保持理由**: クロスリポ参照は他プロジェクトからのハーネス取り込み等の中核運用に必須で、
誤診断によるリトライ浪費・誤った A-6 エスカレーションを招きやすい。全セッションで再発しうるため常駐必須。

---

## アーカイブ索引

> 昇格先へ実装完了し歴史的記録となったエントリは Hot 層に番号も残さない（肥大化防止）。
> プロジェクト固有の教訓は `docs/rules/lessons/<category>.md`（Warm 層）に蓄積する。
