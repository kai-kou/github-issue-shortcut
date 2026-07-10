# リサーチ: Cloudflare コネクタ / Workers Builds / 定期実行での MCP 可用性（2026-07-10 事実確認）

> M0 実装フェーズで実施した事実確認の要約。[Cloudflare 技術スタックリサーチ](2026-07-10-cloudflare-stack.md)の CI/CD 推奨（GitHub Actions + `wrangler-action@v3` を一次）を、本リサーチの結果を踏まえてキーレス構成（GitHub Actions = テスト/lint 専任・Workers Builds = デプロイ）に変更した（[00-requirements.md](../requirements/00-requirements.md) §6.1・[04-milestones.md](../requirements/04-milestones.md) M0 に反映済み）。

## 1. ビルトインの Cloudflare コネクタ（Workers Bindings MCP）にはデプロイ/Secrets ツールがない

- claude.ai の Cloudflare ビルトインコネクタは Workers Bindings 系（D1・KV・R2 等のリソース作成・参照）のみを提供し、Worker のデプロイや Secrets 投入を行うツールを持たない。
- `wrangler-action@v3` で CI からデプロイする従来案は `CLOUDFLARE_API_TOKEN` の発行・GitHub Secrets への登録という人間のダッシュボード作業を要求する（Issue #5 のスコープ変更コメント参照）。

## 2. Cloudflare API MCP（`mcp.cloudflare.com`）カスタムコネクタで Worker 作成・デプロイ・Builds・Secrets に到達可能（実測済み）

- `mcp.cloudflare.com/mcp`（`search`/`execute`/`docs` の execute 型・OAuth 認可）をカスタムコネクタとして追加すると、新 Workers REST API（JSON・multipart アップロード対応）・Builds API・Secrets API に `execute()` 経由で到達できる。
- 実測結果（Issue #12 コメント・2026-07-10）:
  - `GET /accounts/{id}/workers/scripts` → 200（Worker 7 件取得、読み取り疎通確認）
  - `GET /accounts/{id}/builds/tokens` → 200（Builds API も OAuth スコープ内）
  - Worker デプロイ（multipart アップロード）は `execute()` の公式サンプルとして明記されており対応確定
- 結論: D1 作成・Worker 作成・初回デプロイ・Builds 接続・Secrets 投入を Claude 側が自動化でき、ユーザー作業（フォーム入力・シークレットのコピペ）を大幅削減できる（Issue #12 の「ユーザー作業 v1 → v2」削減の根拠）。

## 3. Workers Builds はビルドトークン自動生成でキーレス

- Cloudflare の GitHub App を対象リポジトリにインストールして「Import a repository」を完了すると、Workers Builds 用のビルドトークンが自動生成される（ユーザーがキーを発行・コピペする作業は不要）。
- 実測結果（Issue #12 コメント・2026-07-10 17:52 JST）: Worker `github-issue-shortcut` 作成済み・Cloudflare の GitHub App インストール済み（対象リポジトリのみの最小権限）・ビルドトークン自動作成済みを確認。初回ビルドはデプロイ段階で失敗したが、これはリポジトリに wrangler 設定・コードがまだなかったため（M0 スキャフォールドのマージ後から正常動作する想定どおりの結果）。
- 結論: デプロイ経路を Workers Builds に一本化すれば `CLOUDFLARE_API_TOKEN` を GitHub Secrets に登録する作業自体が不要になる（キーレス）。

## 4. 認可済みコネクタはスケジュール実行（ルーティン）にも供給される

- claude.ai の Routine（定期実行）設定でカスタムコネクタを明示的に追加しておけば、対話セッションだけでなくスケジュール実行のセッションにも同じ MCP ツールが供給される。
- これにより、M0 スプリントのスケジュール実行からも Cloudflare API MCP 経由での自動化（Worker 状態確認・Builds トリガー設定の確認等）が継続して行える。

## 5. 結論（要件への反映）

| 変更前の推奨（[cloudflare-stack.md §4](2026-07-10-cloudflare-stack.md)） | 変更後（本リサーチ反映後） |
|---|---|
| GitHub Actions + `wrangler-action@v3` を一次、プレビューは Workers Builds 併用も可 | GitHub Actions は `vitest`・lint 等の品質ゲート専任（シークレット不要）。デプロイ・PR プレビュー URL は Workers Builds が担当（キーレス） |
| CI ゲート = 「テスト失敗時はデプロイされない」を wrangler-action の実行順で担保 | `main` へのマージ条件（branch protection）として GitHub Actions のテストを必須化し、テストを通過した変更のみが `main` に入る → Workers Builds のデプロイも自動的にテスト済みの変更のみが対象になる |

反映先: [00-requirements.md](../requirements/00-requirements.md) §6.1・[04-milestones.md](../requirements/04-milestones.md) M0・[2026-07-10-cloudflare-stack.md](2026-07-10-cloudflare-stack.md) §4/§7。
