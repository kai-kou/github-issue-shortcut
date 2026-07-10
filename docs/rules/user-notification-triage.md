# ユーザー通知トリアージ（@mention 厳選ワークフロー・SSOT）

> **このファイルは「ユーザーへの @mention 通知をどう厳選するか」の唯一の正本（SSOT）である。**
> `user-confirmation-minimization.md`（A/B/C/D 分類・A-1〜A-6 既約境界外）の **通知レイヤー実装** であり、
> 「確認に回してよいか」を判定する同ドキュメントと一対で機能する。
> `.claude/rules/` に symlink され、全セッションで自動読み込みされる。

---

## 0. なぜ必要か（ユーザー実体験の根本原因・2026-06-04）

ユーザーから明示の指摘:

> 「『ユーザーの対応が必要です』の Slack メンションを精査・カテゴライズ・トリアージして、**本当に対応を求めるものだけ** に厳選してほしい。」
> 「最後のコメント（`--activate-schedule` が save_meta ValueError で停止）が届いても **どう対処すればいいか分からず放置** してしまう。こういうケースの根本原因を特定して再発防止して。」

精査の結果、`@mention`（要対応扱い）通知が放置される **2 大根本原因** を特定した。

| # | 根本原因 | 具体例 | 対策 |
|---|---------|--------|------|
| **RC-1** | **障害（バグ・エラー・失敗）起因の通知を @mention している** | 「`--activate-schedule` が save_meta ValueError で停止（Issue #2483・type:bug）」を「ユーザーのアクションが必要です」として送信 | 障害は L-077 専門チーム調査プロトコルで **Claude が自律修正** すべき案件。`@mention` しない（§2 トリアージで B 区分に落とす） |
| **RC-2** | **@mention に「ユーザーが取るべき具体的アクション」が無い**（技術状況のダンプだけ） | 「重複検出ロジックが原因。Issue 再オープン済み。」← ユーザーは何をすればいいか分からない | A 区分通知には「あなたが取るべき具体アクション + 取らない場合の結果」を必須化（§3） |

> **本質**: ユーザーが放置するのは怠慢ではなく、「**自分がやるべきこと**」が通知に書かれていない（しかも本来 Claude が直すべき障害）から。ユーザーが行動できない通知は **通知設計の欠陥** である。

---

## 1. トリアージの基本原則

```
「ユーザー対応が必要」と通知したくなった
  ↓
その項目は A-1〜A-6（user-confirmation-minimization.md §1 の既約境界外）に該当するか？
  ├─ 該当する（A 区分）→ @mention する。ただし「具体的ユーザーアクション」を必ず添える（§3）
  └─ 該当しない（B/C/D）→ @mention しない
       ├─ 障害起因（バグ・エラー）→ L-077 で自律修正（problem-investigation-protocol.md）
       ├─ B: ツール改修で自律化 → 実装 Issue として処理
       ├─ C: ルール整備済みで自律処理（週次レポート auto-close 等）
       └─ D: 外部要因 → フォールバックで継続（A-6 の課金設定のみ別途 @mention）
```

**鉄則**: A-1〜A-6 に一致しない `@mention` は原則 CP-6 違反。「判定に迷ったら B または C」（安易な A 化を禁止）。

---

## 2. 機械トリアージ（`tools/triage_notification.py`）

通知候補を決定論的に A/B/C/D 分類する分類器を全 `@mention` 経路の前段に置く。

```bash
# 1項目を分類（@mention 要否を判定）
python3 tools/triage_notification.py classify --text "X APIクレジット枯渇。チャージをお願いします" --labels "priority:critical"
#  → 🔔 @mention 必要（A区分） action_class: A (A-6)

python3 tools/triage_notification.py classify --text "save_meta が ValueError で停止" --labels "type:bug"
#  → 🤖 自律処理（@mention 不要） action_class: B  is_failure: True

# セルフテスト（CI / セルフレビューで実行）
python3 tools/triage_notification.py --self-test
```

### 分類ロジック（優先順）

1. **A-6 検出**（課金・OAuth・アカウント設定）→ 障害起因でも **A**（ユーザー権限が物理的に必要）
2. **障害シグナル検出**（`type:bug`/`type:retro-try` ラベル、または「エラー/失敗/停止/ValueError/バグ/例外/再オープン」等）→ **B**（L-077 自律修正・`@mention` しない）
3. **A-1〜A-5 検出**（main 直接 push / 即時手動公開 / 品質ゲート致命的 NG / サーキットブレーカー / 新規マイルストーン）→ **A**
4. **C 検出**（週次レポート・バックログ候補・リサーチ依頼・コメント対応）→ **C**（自律処理）
5. **B 検出**（ローカル実行・外部公開・実装・desync 等）→ **B**
6. **既定** → **B**（迷ったら自律処理）

`mention = (action_class == "A")`。

---

## 3. A 区分通知の必須要件（RC-2 対策）

`@mention` する通知（`waiting` / `daily-progress` 要対応 / `approval` 等）は、各項目に以下を **必ず** 含める。状況説明だけの通知は禁止。

| 必須要素 | 説明 | 悪い例 → 良い例 |
|---------|------|---------------|
| **具体的ユーザーアクション** | ユーザー *だけ* ができる操作を1文で | 「重複検出ロジックが原因」→「課金画面で上限を $X に引き上げてください（あなたのアカウント権限が必要）」 |
| **該当境界** | A-1〜A-6 のどれか | 「（A-6: 課金設定）」 |
| **取らない場合の結果** | 放置するとどうなるか | 「未対応だと次回スケジュール公開が止まります」 |
| **Claude 側の状態** | 自律でやれることは済ませたこと | 「代替手段で処理は継続中。課金復旧で本系統も再開します」 |

> **判定**: 「ユーザーが取るべき具体アクションを1文で書けない」なら、それは A 区分ではない（= `@mention` しない）。

---

## 4. 通知経路ごとの実装

| 経路 | 実装 | トリアージ挙動 |
|------|------|--------------|
| `slack_notify.py waiting` | トリアージゲート組込済 | A 区分が1件もなければ `@mention` を抑制し、メインチャンネルへ「🤖 自律処理項目（要対応ではない）」として FYI 降格（記録は残すが ping しない）。`--force-mention` で上書き可 |
| `collect_production_progress.py`（daily-progress 要対応） | トリアージ組込済 | `status:waiting-user`/`status:blocked` を A/B/C/D 分類。A 区分のみ「要対応」として `@mention`。A 区分ゼロなら `--no-mention` で日次進捗を情報提供のみ（毎日 ping しない） |
| `slack_notify.py daily-progress` | `--no-mention` 対応済 | 真の要対応ゼロのとき `@mention` を付けない |
| `comment-approval`（comment-responder） | 優先度ゲート（実装済み） | `priority:critical` / `high`（ブランド毀損リスクが高い区分・プロジェクト例: 誤情報指摘・批判）の個別通知のみ `@mention`。`medium`/`low`（軽微な区分・プロジェクト例: 要望・好意的・FAQ）とバッチダイジェストは `@mention` なし FYI（ドラフトは Issue に残り自動投稿はしない）。品質ゲート通過区分は自律投稿（承認不要・プロジェクトで定義） |
| `approval`（PR 作成前承認） | **非推奨**（CP-6 で PR 自律化済み） | 新規利用しない。PR 作成・マージはユーザー承認不要 |
| `publish` | FYI イベント分離（実装済み） | 完了報告系イベント（プロジェクト例: 配信完了 / スケジュール済み / 定例レポート）は `@mention` しない（`_PUBLISH_FYI_EVENTS`）。確認・節目アクション系イベント（プロジェクト例: 限定公開 / 公開前確認 / 本公開・A-2 相当）は `@mention` を維持 |

---

## 5. 障害（バグ・エラー）を検出したときの正しい動線（RC-1 対策）

ワークフロー実行中に障害（`ValueError`・API 失敗・ファイル不在・停止等）を検出したら、**絶対に `@mention` で丸投げしない**。

```
障害検出
  → STOP → 未コミットを保存（session-safety-rules.md）
  → problem-investigation-protocol.md の5ステップ（状況精密化→ナレッジ検索→専門チーム並列調査→3層原因分析→解決+再発防止）
  → 自己解決可能 → 修正実装（type:bug Issue として処理）。ユーザー確認不要
  → 自己解決不可 かつ A-1〜A-6 該当（例: A-6 課金・OAuth）→ §3 の必須要件を満たして @mention
```

`type:bug` / `status:waiting-claude` ラベルの Issue は **Claude の作業** であり、ユーザーの To-Do ではない。これらを `daily-progress` の「要対応」や `waiting` に混ぜない（トリアージが自動で B 区分に落とす）。

---

## 6. 専門チーム（曖昧時のエスカレーション・オブザーバー）

機械トリアージで A/B 判定が曖昧（境界キーワードが弱い・新種の通知）な場合のみ、Agent Teams で多角検証する。

| 役割 | subagent | 観点 |
|------|----------|------|
| 分類監査 | general-purpose（haiku） | A-1〜A-6 該当性・障害起因かの再確認 |
| ユーザー視点 | 初心者目線チェック役（Lv1） | 「この通知、自分が何をすればいいか分かる？」 |
| 自律可否 | general-purpose（sonnet） | クラウド実行・ツール改修で自己解決できないか（§ user-confirmation-minimization.md §4） |

通常は機械トリアージで完結する（コスト最小）。専門チーム起動は新種通知の分類ルール追加時に限る。

---

## 7. 完了・成功の定義

- [ ] `@mention`（ユーザー対応が必要）が A-1〜A-6 該当時のみ発火する
- [ ] 障害（バグ・エラー）起因の通知が `@mention` されない（L-077 で自律修正）
- [ ] A 区分通知に「具体的ユーザーアクション + 結果」が含まれる（状況ダンプ禁止）
- [ ] `triage_notification.py --self-test` が PASS
- [ ] 日次進捗が真の要対応ゼロの日は `@mention` しない（毎日 ping しない）

---

## 8. 参照

| ドキュメント | 関係 |
|------------|------|
| `docs/rules/user-confirmation-minimization.md` | A/B/C/D 分類・A-1〜A-6 既約境界外の SSOT（本ファイルは通知レイヤー実装） |
| `docs/rules/problem-investigation-protocol.md` | 障害起因の自己解決プロトコル（RC-1 の動線） |
| `docs/rules/slack-notification-rules.md` | Slack 通知のチャンネル分離・セットアップ |
| `docs/rules/daily-progress-rules.md` | 日次進捗報告（要対応のトリアージを本ファイルに従う） |
| `tools/triage_notification.py` | 機械トリアージ分類器（本ファイルのロジック実装） |
