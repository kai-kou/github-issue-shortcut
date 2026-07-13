# ユーザー通知トリアージ（@mention 厳選ワークフロー・SSOT）

> **このファイルは「ユーザーへの @mention 通知をどう厳選するか」の唯一の正本（SSOT）である。**
> `user-confirmation-minimization.md`（A/B/C/D 分類・A-1〜A-6 既約境界外）の **通知レイヤー実装** であり、
> 「確認に回してよいか」を判定する同ドキュメントと一対で機能する。
> `.claude/rules/` に symlink され、全セッションで自動読み込みされる。

---

## 0. なぜ必要か（ユーザー実体験の根本原因・2026-06-04・要約）

`@mention`（要対応扱い）通知が放置される根本原因は2つ: **RC-1**（障害・バグ起因の通知を @mention してしまう。本来 Claude が自律修正すべき案件）と **RC-2**（@mention に「ユーザーが取るべき具体的アクション」が書かれておらず、状況ダンプだけになっている）。ユーザーが行動できない通知は通知設計の欠陥である。経緯全文は `user-notification-triage-detail.md` §0 を参照。

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

## 4. 通知経路ごとの実装（要約）

`slack_notify.py`（waiting / daily-progress）・`collect_production_progress.py`・`comment-approval`・`publish` の各経路に機械トリアージ（§2）が組み込み済み。共通挙動: A 区分ゼロなら `@mention` を抑制し FYI 降格する（`--force-mention`/`--no-mention` で上書き可）。`approval`（PR 作成前承認）は CP-6 で PR 自律化済みのため非推奨・新規利用しない。経路別の詳細実装表は `user-notification-triage-detail.md` §4 を参照。

### 4.1 日次進捗レポートの構成

日次進捗報告は、ユーザーが手元を離れていても状況を把握できるようにする FYI（情報提供）が基本。

| セクション | 内容 |
|-----------|------|
| 完了サマリー | 当日マージした PR・クローズした Issue・done_sp |
| 進行中 | `status:in-progress` の Issue（担当セッション） |
| 要対応（A 区分のみ） | §2 の機械トリアージで A 区分に分類された項目のみ |
| 衛生指標 | オープン Issue / PR 数・Orphan・stale 件数（CP-3） |

`@mention` は §1〜§2 の判定と同一（A 区分が1件以上ある日のみ付与。B/C/D 区分は要対応に混ぜない）。**真の要対応がゼロの日は `@mention` しない**（毎日 ping しない）。実装はプロジェクト定義の進捗収集スクリプト + `tools/slack_notify.py daily-progress`。

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

## 6. 専門チーム（曖昧時のエスカレーション・要約）

機械トリアージで A/B 判定が曖昧（境界キーワードが弱い・新種の通知）な場合のみ、Agent Teams で多角検証する（分類監査・ユーザー視点・自律可否の3役）。通常は機械トリアージで完結する（コスト最小）。専門チーム起動は新種通知の分類ルール追加時に限る。役割の詳細は `user-notification-triage-detail.md` §6 を参照。

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
| `tools/triage_notification.py` | 機械トリアージ分類器（本ファイルのロジック実装） |
| `docs/rules/user-notification-triage-detail.md` | §0 背景ナラティブ・§4 経路別実装表・§6 専門チーム詳細（Hot 層棚卸しで移設・Issue #146） |
