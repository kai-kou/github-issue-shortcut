# トークン消費最適化ルール

Claude Code のトークン消費を最小化し、セッションあたりのコスト効率を最大化するためのルール。

## 背景（2026-03 調査）

2026年3月に報告された異常なトークン消費の原因は以下の4つが重なったものである。

| 原因 | 種別 | 影響 |
|------|------|------|
| セッション再開バグ（CC-BUG-08） | バグ | 大規模プロジェクトで出力トークン暴走 |
| プロンプトキャッシュミス | 構造的問題 | CLAUDE.md・ルールファイルの再送コスト増大 |
| ピーク時間帯の消費速度引き上げ | 意図的変更 | JST 22:00〜翌4:00 のコスト増 |
| 需要爆増によるインフラ圧迫 | 背景因 | 全ユーザーに影響 |

## ルールファイル階層化（最重要対策）

### 設計原則

`.claude/rules/` に配置するのは **全セッションで必要な基盤ルール** のみ（実際の常駐リストは `tools/check_rules_sync.sh` の `ESSENTIAL_RULES` が正本）。タスク依存のルールは `docs/rules/` に実体のみ配置し、スキルが必要時に Read で読み込む。

### 常時必要ファイル一覧

> **SSOT 注意**: Hot 層（常時必要）の **正本は `tools/check_rules_sync.sh` の `ESSENTIAL_RULES`** 。下表は概念説明のための例示であり、実際の常駐リストは ESSENTIAL_RULES を参照すること（ドリフト防止）。

| ファイル（例） | トークン概算 | 理由 |
|---------|------------|------|
| `agent-team-summary.md` | ~1,000 | 全タスクでサブエージェント使用 |
| `core-principles.md` | ~2,300 | 全タスクの大原則 |
| `pr-review-flow-summary.md` | ~1,200 | ほぼ全タスクで PR 作成 |
| `session-compression-rules.md` | ~2,100 | 圧縮時の安全 |
| `session-safety-rules.md` | ~1,700 | セッション安全 |
| `user-confirmation-minimization.md` | ~2,500 | 確認要否の SSOT |

> **Warm 降格済み（E-B #20）**: `session-concurrency-rules.md`（Scheduled Tasks 利用時のみ Hot 化）と
> `progress-reporting-rules.md`（制作系の長時間処理時にスキルが Read）は **既定では Hot 層に含めない** 。
> Hot 化する場合は `ESSENTIAL_RULES` に追記して `./tools/check_rules_sync.sh --fix` を実行する。

### 削減効果

| 指標 | 変更前 | 変更後 | 削減率 |
|------|--------|--------|--------|
| `.claude/rules/` ファイル数 | 34 | 8（7 symlink + 1 例外） | 76% |
| `.claude/rules/` 総サイズ | ~418KB | ~76KB | 82% |
| 推定トークン数 | ~105,000 | ~19,000 | 82% |

### スキルが Read すべきルールファイル対応表

> ⚠️ 以下の表のスキル名・ルールファイル名は **出自プロジェクト（動画制作）の実例** 。汎用ベースには存在しないファイルもあるため、自分のプロジェクトのスキル・ルール名に読み替えること。

各スキルは Step 0 で必要なルールファイルを `docs/rules/` から Read する。

| スキル | 必要なルールファイル（`docs/rules/` から Read） |
|--------|-----------------------------------------------|
| script-pipeline, script-writer | script-rules.md, research-rules.md |
| script-team-reviewer | script-rules.md |
| audio-pipeline, voicevox-audio | audio-pipeline-rules.md, intonation-rules.md, pronunciation-rules.md |
| image-pipeline, image-generator | image-pipeline-rules.md, youtube-thumbnail-rules.md |
| video-pipeline | video-storage-rules.md, youtube-upload-safety-rules.md, youtube-title-rules.md, video-international-rules.md |
| shorts-pipeline | shorts-rules.md, research-rules.md, video-storage-rules.md |
| self-reviewer | self-review-learnings.md, script-rules.md, research-rules.md |
| retrospective | retrospective-rules.md, self-review-learnings.md |
| refinement | refinement-rules.md, research-rules.md |
| pr-review-watcher | self-review-learnings.md |
| youtube-scheduler | youtube-scheduling-rules.md |
| sns-publisher | slack-notification-rules.md |
| comment-responder | comment-response-rules.md |
| workflow-health-check | youtube-content-variation-rules.md, self-review-learnings.md |
| retro-try-handler | self-review-learnings.md |
| metadata-reviewer | youtube-title-rules.md |
| theme-discovery | series-management-rules.md |
| zenn-book-writer | zenn-book-rules.md |

コンテキスト圧縮は Claude 標準の Auto Compaction（コンテキスト上限付近で自動発動・圧縮してセッションを継続）に委ねる。本ベースは圧縮タイミングを env（`CLAUDE_CODE_AUTO_COMPACT_WINDOW` 等）で固定しない。

## ピーク時間帯回避ルール

### Anthropic ピーク帯（2026-03-26 公式発表）

**PT 5:00〜11:00 / UTC 13:00〜19:00 / JST 22:00〜翌 4:00**

この時間帯はトークン消費レートが最大 2〜3 倍に膨らむ。

### ピーク帯に避けるべきタスク

- 長時間パイプライン（image-pipeline: ~60 分、video-pipeline: ~180 分）
- Opus 4.6 を使用するタスク（台本生成、複雑な設計判断）
- 大量のサブエージェントを起動するタスク（Agent Teams レビュー等）

### ピーク帯でも許容されるタスク

- 5 分以内で完了する軽量チェック
- Haiku モデルのみを使用するタスク
- Slack 通知やコメント投稿のみの操作

### スケジュールタスクへの適用

メインアカウントのスケジュールはすべて JST 05:00〜19:00 に収まっており影響なし。

**サブアカウントの調整が必要**:

| タスク | 変更前（JST） | 変更後（JST） | 理由 |
|--------|-------------|-------------|------|
| image-pipeline（サブ） | **01:00**（ピーク帯） | **05:00** | ピーク帯回避 |
| video-pipeline（サブ） | 05:00 | **08:00** | image の後に実行 |
| script + audio（サブ） | 18:00 | 18:00（変更なし） | ピーク帯外 |

> **2026-05-05 更新（3アカウント体制移行）**: メインA が 24 時間フル稼働（深夜帯含む）に移行し、
> サブBも hourly 専用スロットを追加した。ピーク帯（JST 22:00〜翌4:00）での実行は Extra Usage を
> 消費するが、3アカウント合計で最大 84回/日（各28回/日 × 3）の実行容量を確保しているため、
> コスト効率より制作スループットを優先する設計判断。ピーク帯での長時間タスクがExtra Usage上限に
> 先に到達した場合はセッションが中断されるが、次スロットで自動復帰する（`session-safety-rules.md` 参照）。

## フック統合（CC-BUG-16 対策）

### 問題

フック 8 個以上でコンテキスト肥大化・ターン早期終了のリスクがある（CC-BUG-16）。

### 対策

| 変更 | 変更前 | 変更後 |
|------|--------|--------|
| PreToolUse (Bash) | 3 個（push, PR, comment） | **1 個**（`pre-tool-use-router.sh`） |
| PreToolUse (MCP) | 1 個（image gen） | 1 個（変更なし） |
| Stop | 3 個（git, PR, slack） | **1 個**（`stop-router.sh`） |
| **合計** | 11 個 | **7 個** |

ルータースクリプトがコマンド内容に応じて適切なチェックスクリプトに委譲するため、検証機能は完全に維持される。

## セッション再開バグ防御（CC-BUG-08 補強）

### 問題（2026-03-23 発生）

大規模プロジェクトのセッション再開時、ユーザー入力ゼロで出力トークン 652,069 が生成された事例。
本プロジェクトはルールファイル ~19K トークン（最適化後）を持つが、スキル SKILL.md を含めると依然として大規模。

### 既存の防御策（有効性確認済み）

- ✅ セッション再開に依存しない設計（Git + Issue コメントが権威ソース）
- ✅ PostCompact / Stop フックで自動コミット
- ✅ 「大きなセッション（50+ ターン）は再開せず新規セッションで開始」ルール

### 追加防御策

- Claude Code を常に最新バージョンに維持（session-start.sh で自動更新済み）
- `ccusage` でセッション再開後のトークン消費を定期監視（月次 workflow-health-check で実施）
- 異常なトークン消費（1 セッションで出力 100K+ トークン）を検知した場合、retro-try Issue を作成

## CLAUDE.md 圧縮

### 設計原則

CLAUDE.md には **全セッションで必要な判断基準と参照リンク** のみを記載する。Phase 固有の詳細仕様はルールファイルまたはスキル SKILL.md に委譲する。

### 移譲した主要セクション

> ⚠️ 以下の表の移譲先ルールファイル名は **出自プロジェクト（動画制作）の実例** 。汎用ベースには存在しないファイルもあるため、自分のプロジェクトのルール名に読み替えること。

| セクション | 移譲先 | 削減量 |
|-----------|--------|--------|
| Remotion 詳細仕様（z-index, VisualCue, 字幕, SourceCredit） | `docs/rules/remotion-rules.md` | ~106 行 |
| 画像生成ルール詳細 | `docs/rules/image-pipeline-rules.md` 参照 | ~12 行 |
| VOICEVOX 詳細 | `docs/rules/audio-pipeline-rules.md` 参照 | ~4 行 |
| YouTube API 詳細 | `docs/rules/youtube-scheduling-rules.md` 参照 | ~6 行 |
| Slack 通知詳細 | `docs/rules/slack-notification-rules.md` 参照 | ~7 行 |
| スキル配置リスト（28 行） | 各スキル SKILL.md | ~24 行 |
| **合計** | | **~159 行削減** |

## 禁止事項

- `.claude/rules/` にタスク依存のルールファイルを symlink で追加しない（`ESSENTIAL_RULES` リスト外）
- ピーク帯（JST 22:00〜翌 4:00）に長時間パイプラインをスケジュールしない
- フック数を 8 個以上に増やさない（統合ルータースクリプトを使用）
- CLAUDE.md に Phase 固有の詳細仕様を直接記載しない（ルールファイルまたは SKILL.md に委譲）
