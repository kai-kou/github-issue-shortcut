# GitHub Issue Shortcut

「思いついた瞬間」を逃さず、Android スマホのホーム画面から数秒で特定の GitHub リポジトリに Issue を起票できる、最速・最短の起票体験を提供する PWA です。

PAT 管理の手間なし（GitHub 認証）・ショートカット起動（リポジトリ / ラベル初期選択）を武器に、Todoist のクイック追加級の体験を GitHub Issues にもたらすことを目指しています。

## 特徴（目標）

- **起票 10 秒以内**（タイトルのみなら 5 秒以内）: 起動 → 入力 → 送信の 3 タップ以内
- **PAT レス**: GitHub 認証（OAuth）でトークンを手動管理しない
- **ショートカット起動**: リポジトリ・ラベルを初期選択した状態で起動できる
- **送信失敗時も入力を保全**: 下書きを失わない

## 技術スタック

| レイヤー | 採用技術 |
|---------|---------|
| フロントエンド | Vite + React 19（SPA / PWA） |
| API | Hono（Cloudflare Workers 上で動作） |
| ホスティング | Cloudflare Workers（単一 Worker 構成・workers.dev） |
| データ | Cloudflare D1 |
| CI | GitHub Actions（テスト・型チェック・Markdown ゲート） |
| デプロイ | Cloudflare Workers Builds（Git 連携・キーレス） |

## セットアップ

```bash
npm ci          # 依存インストール
npm run dev     # ローカル開発サーバー（Vite）
npm run build   # 型チェック（tsc -b）+ ビルド
npm test        # テスト（vitest / @cloudflare/vitest-pool-workers）
```

デプロイは Cloudflare Workers Builds（Git 連携）が担当します。詳細な要件・アーキテクチャは [`docs/requirements/`](docs/requirements/) を参照してください。

## ドキュメント

- [要件定義](docs/requirements/) — FR/NFR・アーキテクチャ・マイルストーン計画
- [プロジェクトミッション](docs/project-mission.md) — ミッション・KPI・優先順位
- [リサーチ](docs/research/) — 認証・技術スタック・市場調査

## 開発運用について

本リポジトリは Claude Code による自律開発運用（[claude-code-base](https://github.com/kai-kou/claude-code-base) 由来のルール・スキル・ハーネス）を採用しています。運用ルールは [`CLAUDE.md`](CLAUDE.md) と [`docs/rules/`](docs/rules/) にまとまっています。

## ライセンス

[MIT License](LICENSE) の下で公開しています。
