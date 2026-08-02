# プロジェクト状態スナップショット（2026-08-02 08:40 JST 更新）
> SessionStart フックが自動注入。最新化は `python3 tools/generate_project_context.py`。

## Issue / PR
クラウドでは gh が 403 のため未取得。`mcp__github__list_issues` / `mcp__github__list_pull_requests` で直接確認する（status:in-progress / status:waiting-claude / status:waiting-user / open PR・L-114）。

## 直近のコミット
- f4f32d6 chore: claude-code-base を d5deafd へ同期し、下流固有の改善を退避・復元する (#224)
- fa6b026 fix: telemetry/cost-data ブランチのコスト実額露出を解消する (#222)
- 0089779 fix: 未認証エンドポイントの可用性防御と全レスポンスのセキュリティヘッダーを追加 (#217)
- 818374b feat: LP に sitemap.xml を追加し、GitHub Pages 公開を走らせる (#220)
- 788c2e4 feat: GitHub Pages で公開するプロダクト LP を制作する (#215)
- d14470f fix: Cron Trigger を空配列で明示し D1 撤去後の残存トリガーを解消する (#218)
- ec8d3c1 fix: repo パラメータの形式検証とハーネス秘密ファイルの権限を修正（セキュリティレビュー #204） (#213)
- 9e48ece docs: ユーザー目線の議論型レビューで検出した README と実装の乖離を解消する (#206)
