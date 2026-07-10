# サンドボックス設定ルール

Claude Code のサンドボックス制限に関する設定方針と運用ルール。

## サンドボックスの仕組み

Claude Code が Bash ツールでコマンドを実行する際、サンドボックスがネットワーク通信を制御する。

| 設定 | 効果 |
|------|------|
| `sandbox.network.allowedDomains` | サンドボックス内プロセスがアクセスできるドメインを制限 |
| `sandbox.excludedCommands` | このパターンにマッチするコマンドはサンドボックスのネットワーク制限を **完全バイパス** して実行される |

### フックスクリプトはサンドボックス外

`SessionStart` / `Stop` / `PreToolUse` 等のフックとして登録されたシェルスクリプトは、
Claude Code のサンドボックスとは独立したプロセスで実行されるため、`allowedDomains` の制限を受けない。

---

## `excludedCommands` のパターン（現行設定）

`settings.json` に以下のパターンが登録されており、**`tools/` 配下の全 Python スクリプト** が
サンドボックスのネットワーク制限を受けずに実行される。

```json
"excludedCommands": [
  "python3 *tools/*.py",
  "python *tools/*.py",
  "timeout * python3 *tools/*.py",
  "timeout * python *tools/*.py"
]
```

| パターン | マッチする呼び出し例 |
|---------|------------------|
| `python3 *tools/*.py` | `python3 tools/generate_audio.py content/scripts/V001_script.json` |
| `python *tools/*.py` | `python tools/youtube_scheduler.py --check-buffer` |
| `timeout * python3 *tools/*.py` | `timeout 30s python3 tools/sync_project.py` |
| `timeout * python *tools/*.py` | `timeout 15s python tools/youtube_scheduler.py --assign-schedule` |

### パターンの設計意図

- `*tools/*.py` — パスの末尾が `tools/` + ファイル名 + `.py` の形式にマッチする
  - **⚠️ セキュリティ上の注意**: このパターンはプロジェクトディレクトリ外のパス（例: `/tmp/evil/tools/script.py`）にもマッチする可能性がある。ただし、Claude Code が実行するコマンドはエージェント自身が生成するため、外部からの任意コマンド実行には繋がらない。
  - **先頭 `*` が必要な理由**: フックスクリプト（`session-start-slack.sh` 等）は `${CLAUDE_PROJECT_DIR}/tools/xxx.py` という **絶対パス** で Python スクリプトを呼び出す。絶対パスにマッチするには先頭の `*` が必須。`tools/*.py`（`*` なし）では絶対パス呼び出しにマッチしない。
- `python3` と `python` の両方に対応（SKILL.md で両方使われるため）
- `timeout *` プレフィックス対応（長時間処理のタイムアウトラッパーに対応）

---

## `allowedDomains` の登録ドメイン一覧

`excludedCommands` でバイパスされる場合でも、`allowedDomains` は MCP サーバー通信や
`excludedCommands` に該当しないコマンド（`gh` CLI 等）のために必要。

> ⚠️ 以下の許可リストは **出自プロジェクト（動画制作）の実例**。自プロジェクトで実際に使う API ドメインに読み替えること（`<your-account>` は自分の Cloudflare Workers サブドメイン等に置換）。

| ドメイン | 用途 |
|---------|------|
| `github.com` / `api.github.com` | GitHub API（gh CLI、MCP サーバー） |
| `slack.com` / `api.slack.com` | Slack Web API（slack_notify.py） |
| `generativelanguage.googleapis.com` | Gemini API（画像生成） |
| `gemini-image-mcp-server.<your-account>.workers.dev` | Gemini Image MCP サーバー |
| `oauth2.googleapis.com` | Google OAuth トークン更新 |
| `www.googleapis.com` | Google API 汎用 |
| `youtube.googleapis.com` / `youtubeanalytics.googleapis.com` | YouTube Data API v3 |
| `youtube-api-proxy.<your-account>.workers.dev` | YouTube API プロキシ（Cloudflare Workers） |
| `api.anthropic.com` | Anthropic API（`claude -p` サブプロセス経由のみ。`tools/*.py` から直接呼び出しは不使用） |
| `qiita.com` | Qiita API（post_qiita_article.py） |
| `api.twitter.com` | X（Twitter）API v2（post_x_announcement.py） |
| `bsky.social` | Bluesky PDS（post_bluesky.py） |
| `us-central1-aiplatform.googleapis.com` | Vertex AI BGM 生成（generate_bgm.py、GCP_LOCATION=us-central1 の場合） |
| `r2.cloudflarestorage.com` | Cloudflare R2 S3 互換 API（backup_video_r2.py） |
| `r2.dev` | Cloudflare R2 パブリックバケットドメイン（動画公開 URL） |

> **注意**: `generate_bgm.py` の接続先は `GCP_LOCATION` 環境変数で変わる（例: `asia-northeast1-aiplatform.googleapis.com`）。
> `us-central1` 以外のリージョンを使う場合は `allowedDomains` に追加すること。
> ただし `excludedCommands` で `python3 *tools/*.py` がマッチするため、`allowedDomains` のドメイン漏れでも動作する（多層防御として記載）。

---

## 新しい tools スクリプトを追加するとき

### ネットワーク通信がある場合

1. `tools/*.py` として配置すれば **自動的に `excludedCommands` にマッチ** するため追加作業不要
2. 接続先ドメインが `allowedDomains` に未登録の場合は追加する（多層防御）
3. `docs/rules/env-vars.md` に必要な環境変数を記載する

### `tools/` 以外の場所に配置する場合

`excludedCommands` パターンにマッチしないため、個別にパターンを追加する必要がある。
可能な限り `tools/` に配置することを推奨する。

### ラッパースクリプトを追加する場合

```bash
# NG: excludedCommands パターン "python3 *tools/*.py" にマッチしない
bash tools/run_audio.sh  # → シェルラッパー経由の場合は python3 が直接呼ばれない

# OK: python3 を直接呼び出す
python3 tools/generate_audio.py ...
```

bash / sh ラッパースクリプトを Bash ツールから呼ぶ場合は、
`excludedCommands` に `bash *tools/*.sh` 等のパターンを追加するか、
ラッパーを介さず python3 を直接呼び出す方式に変更する。

---

## 対象スクリプト一覧（主要なもの）

| スクリプト | 接続先 | 備考 |
|-----------|--------|------|
| `tools/slack_notify.py` | `api.slack.com` | セッション通知 |
| `tools/sync_project.py` | `api.github.com` | Projects V2 同期 |
| `tools/youtube_scheduler.py` | YouTube API / OAuth | YouTube スケジュール管理 |
| `tools/youtube_comment_monitor.py` | YouTube API / OAuth | コメント監視 |
| `tools/youtube_delete_video.py` | YouTube API / OAuth | 動画削除 |
| `tools/generate_audio.py` | `localhost:50021`（VOICEVOX） | 音声生成 |
| `tools/generate_images_gemini.py` | `gemini-image-mcp-server.*` | 画像生成 |
| `tools/generate_bgm.py` | `{region}-aiplatform.googleapis.com` | BGM 生成 |
| `tools/post_qiita_article.py` | `qiita.com` | Qiita 投稿 |
| `tools/fetch_x_posts.py` | `api.twitter.com` | X 投稿取得（theme-discovery の Step 1.5） |
| `tools/post_x_announcement.py` | `api.twitter.com` | X（Twitter）投稿 |
| `tools/post_bluesky.py` | `bsky.social` | Bluesky 投稿 |
| `tools/backup_video_r2.py` | `r2.cloudflarestorage.com` | Cloudflare R2 動画バックアップ |
| `tools/generate_comment_reply.py` | `claude -p` サブプロセス（Anthropic API 直接呼び出しなし） | コメント返信生成 |
| `tools/adjust_subtitle_lines.py` | `claude -p` サブプロセス（Anthropic API 直接呼び出しなし） | 字幕調整 |
| `tools/check_pending_pr_reviews.py` | `api.github.com`（gh 経由） | PR レビュー確認 |
| `tools/discover_pending_audio.py` | `api.github.com`（gh 経由） | 音声生成対象検出 |
| `tools/discover_pending_phase.py` | `api.github.com`（gh 経由） | フェーズ対象検出 |

---

## トラブルシューティング

### `tools/*.py` スクリプトの通信が失敗する

1. `settings.json` の `excludedCommands` に `"python3 *tools/*.py"` が登録されているか確認
2. スクリプトを `python3 tools/xxx.py` 形式（`tools/` 相対パスまたは絶対パス末尾が `tools/*.py`）で呼び出しているか確認
3. `bash tools/wrapper.sh` のようにシェルラッパーを経由している場合はパターンがマッチしない → python3 を直接呼び出す

### VOICEVOX（localhost）への接続が失敗する

サンドボックスが localhost を含む全ネットワークをブロックする環境では、
`python3 *tools/*.py` の `excludedCommands` によって完全バイパスされるため解消される。
VOICEVOX が起動しているか確認: `curl -s http://localhost:50021/speakers | head -c 50`

### `generate_bgm.py` の接続先ドメインエラー

`GCP_LOCATION` が `us-central1` 以外の場合、`allowedDomains` に未登録ドメインになる可能性がある。
ただし `excludedCommands` でバイパスされるため実際は影響しない。
`allowedDomains` に `{リージョン}-aiplatform.googleapis.com` を追加することを推奨（多層防御）。
