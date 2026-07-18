# プロジェクト状態スナップショット（2026-07-18 09:10 JST 更新）
> SessionStart フックが自動注入。最新化は `python3 tools/generate_project_context.py`。

## 作業中 Issue（status:in-progress）
- #94: fix: GitHub App インストール完了後の /auth/callback 復帰が pre-auth Cookie 欠如で 400 

## Claude 対応待ち Issue（status:waiting-claude・上位 15）
（なし）

## ユーザー対応待ち Issue（status:waiting-user）
- #35: [M1] E2E 検証・KPI 計測: 実機での起票フロー確認手順の整備 + 手動計測で KPI 検証
- #20: [M3] B4-4: キュー再送と重複防止の整合（issue_log 照合との統合）
- #18: [M3] B4-2: オフラインキュー（Background Sync + 楽観的 UI）
- #16: [M3] B3-3: スマート入力（#repo @label トークンのインライン認識）
- #15: [M3] B1-3: ボトムシート + 起動即入力（1 タップで同期 focus）
- #13: [M2] C1-1 / C2-2: ショートカット作成ヘルパー（プリセット URL 生成 + 配置ガイド）
- #11: [M2] C2-1: manifest shortcuts（長押しメニューの定番プリセット）

## オープン PR
（なし）

## 直近のコミット
- b420a7d feat: B4-4 オフラインキュー再送と重複防止の統合（issue_log × client_request_id） (#92)
- 9542ba2 feat: B4-2 オフラインキュー（Workbox Background Sync + 楽観的 UI） (#90)
- 1148b55 feat: B3-3 スマート入力（#repo @label のインライン認識・ハイライト・タップ解除） (#89)
- 60437ae feat: B1-3 ボトムシート + 起動即入力（ネイティブ dialog） (#88)
- c81e304 feat: C1-1/C2-2 ショートカット作成ヘルパー（プリセット URL 生成 CRUD + 配置ガイド） (#86)
- c4eab01 feat: MVP に仮デザインテーマを適用（ライト/ダーク対応・CSS のみ） (#85)
- a53cf76 chore: claude-code-base 5609d71 を再同期（16コミット分の更新反映） (#83)
- dec2b71 feat: manifest shortcuts（アイコン長押しメニューの定番プリセット）を追加 (#82)
