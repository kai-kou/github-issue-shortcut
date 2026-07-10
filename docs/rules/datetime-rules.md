# 日時表記ルール（Datetime Rules・JST 統一 SSOT）

> **このファイルは「日時を表示・記録するときのタイムゾーン基準」の唯一の正本（Single Source of Truth）である。**
> 飼い主の明示決定（2026-06-21・Issue #75）に基づき新設。
> `.claude/rules/` に symlink され、全セッションで自動読み込みされる（Hot 層・圧縮後も有効）。

---

## 0. 大原則: 日時は JST で統一する

**ユーザーに見える、または記録（コミットメッセージ・Issue / PR コメント・ログ・通知・スナップショット）に残る日時は、すべて JST（日本標準時・Asia/Tokyo・UTC+9）で表記する。**

- チャットでユーザーに日時を伝えるときも **必ず JST** にする（UTC で答えない）。
- システムから注入される時刻（プロジェクト状態スナップショット等）が UTC 由来でも、ユーザーに伝える際は **JST に換算** して `HH:MM JST` の形で示す（UTC = JST − 9 時間）。
- 表記フォーマットは末尾に ` JST` を付ける: `YYYY-MM-DD HH:MM JST`（日付のみで足りる場合は `YYYY-MM-DD`）。

---

## 1. 唯一の例外: 機械処理用の UTC は維持する

以下は **JST 化してはならない**（UTC のまま正しい）。これらはユーザーに見せる日時ではなく、機械が解釈する値・内部計算用である。

| 用途 | 例 | 理由 |
|------|----|------|
| 外部 API に渡す ISO 8601 タイムスタンプ | GitHub API の `after_timestamp`（`date -u +"%Y-%m-%dT%H:%M:%SZ"`） | API 仕様が UTC `Z` 形式を要求する。JST 化すると壊れる |
| 内部の経過時間・stale 判定計算 | `check_pending_pr_reviews.py` / `pipeline_state.py` の `datetime.now(timezone.utc)` 差分 | 差分計算には TZ 表記が不要（表示しない）。基準が UTC で一貫していれば正しい |
| エポック秒・mtime 差分 | `date +%s` | TZ 非依存 |
| UTC↔JST↔PT 換算表 | `token-optimization-rules.md` のピーク帯換算 | 換算が目的なので UTC 併記が正しい |

**判定基準**: 「その日時を **人間が読む / 記録として残す** か？」→ YES なら JST。「**機械が解釈する / 内部計算にのみ使う**（表示しない）か？」→ NO なら UTC 維持で可。

---

## 2. 実装パターン（新規コードはこれに従う）

### Python

```python
from datetime import datetime, timezone, timedelta

JST = timezone(timedelta(hours=9))  # 日本は DST がないため固定オフセットで正確

# 表示・記録用
now = datetime.now(JST).strftime("%Y-%m-%d %H:%M JST")

# 機械処理用（API・内部計算）は従来どおり UTC
now_utc = datetime.now(timezone.utc)
```

- `datetime.utcnow()` / `datetime.now()`（TZ なし）を **表示・記録用途で使わない**（コンテナのローカル TZ に依存して不定になる）。
- `self-review-checklist.md` は TZ 未指定の `datetime.now()` をコードの問題として検出する。

### シェル

```bash
# 表示・記録用（コミットメッセージ・ログ）。動的に生成するシェルのタイムスタンプは
# %Z（実行時の TZ 略称）を使う。リテラル "JST" を直書きすると PROJECT_TZ を
# 上書きしたとき「JST と書いてあるのに実体は別 TZ」の嘘表記になるため。
# 既定（PROJECT_TZ 未設定）では Asia/Tokyo なので %Z は "JST" を出す。
timestamp=$(TZ="${PROJECT_TZ:-Asia/Tokyo}" date '+%Y-%m-%d %H:%M %Z')
day=$(TZ="${PROJECT_TZ:-Asia/Tokyo}" date '+%Y-%m-%d')

# 機械処理用（GitHub API 等）は UTC のまま
rereview_ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
```

- ハーネス（hooks）の既定 TZ は `Asia/Tokyo`（`PROJECT_TZ` で上書き可能）。`TZ="${PROJECT_TZ:-Asia/Tokyo}"` の形を使う。
- **動的なシェル `date` のタイムスタンプはリテラル `JST` を直書きせず `%Z` を使う**（上記コメント参照・Issue #79）。Python は固定の `JST` 定数（`timezone(timedelta(hours=9))`）を使うためリテラル `JST` 表記で正しい（定数が +9 固定なので嘘にならない）。プロセス・ドキュメントのテンプレートで「このプロジェクトの既定＝JST」を説明する文中の `JST` 表記も可。
- `${PROJECT_TZ:-UTC}` のように **UTC を既定にしない**。

---

## 3. ドキュメント / スキルの日時テンプレート

- 日時テンプレートに `HH:MM`（時刻）を含めるときは **必ず ` JST` を付ける**: `{YYYY-MM-DD HH:MM JST}`。
- 日付のみのテンプレートは `$(TZ=Asia/Tokyo date +%Y-%m-%d)` で生成し、コンテナ TZ に依存させない。
- 既存テンプレートで JST を明示済みの模範: `session-safety-rules.md`（停止時刻）・`checkpoint/SKILL.md`・`progress-reporting-rules.md`。

---

## 4. 完了・成功の定義

- [ ] チャットでユーザーに伝える日時が JST になっている
- [ ] 表示・記録系コードの日時が JST 基準（API 用 UTC を除く）
- [ ] ハーネス（hooks）の既定 TZ が `Asia/Tokyo`
- [ ] 動的なシェル `date` のタイムスタンプが `%Z`（リテラル `JST` 直書きでない・Issue #79）
- [ ] 日時テンプレートに JST が明示されている（時刻付きの場合）
- [ ] 機械処理用 UTC（API・内部計算）は維持されている
- [ ] `python3 tools/check_datetime_tz.py` が PASS（表示・記録系の TZ 未指定 `datetime` 残存ゼロ・Issue #80）

---

## 5. 参照

| ドキュメント | 関係 |
|------------|------|
| `docs/rules/session-safety-rules.md` | 停止時刻テンプレート（JST 明示の模範） |
| `docs/rules/token-optimization-rules.md` | UTC↔JST↔PT 換算表（換算目的の UTC 併記は正） |
| `docs/rules/self-review-checklist.md` | TZ 未指定 `datetime.now()` の検出 |
| `tools/check_datetime_tz.py` | 表示・記録系の TZ 未指定 `datetime` 残存を検出する機械チェック（Issue #80） |
| `tools/generate_project_context.py` | スナップショット時刻（JST） |
