<!-- discussion_whiteboard:auto -->
# 🧑‍🏫 議論ホワイトボード: 実機手動確認チェックリスト（起票フロー）の自動化スコープ確定（Issue #148）

- 議題ID: `manual_check_automation_20260725`
- 論点: 実機確認待ち Issue（#145/#16/#15）の Done Criteria を消化するために人手で実施した『オンライン系チェックリスト』を、どこまで自動化すべきかを敵対的にレビューして確定する。チェックリスト実体: (1) リポジトリ検索欄に `バグ修正 #repo名` と入力 → `#` トークンがハイライトされ一覧が絞り込まれる、(2) リポジトリをタップ → 残りの自由文『バグ修正』がタイトル初期値へ引き継がれる、(3) タイトル欄に `テスト @b` → 入力欄直下にラベル候補チップ（bug 等）が出る、(4) 候補タップ → `テスト @bug ` に確定 + ラベルがチェック済み + キーボードが閉じない、(5) `@bug` 確定後は候補が消える、(6) ラベルチップのタップ解除でテキストとラベル選択が連動して消える、(7) コールドスタート（WebAPK standalone）からタイトルのみ起票し送信完了まで 5 秒以内をストップウォッチ実測。決めるべきは、(a) 既存 E2E（e2e/smart-input.spec.ts・kpi.spec.ts・shortcuts.spec.ts 他 18 spec）が既にカバーしている範囲と本当に未カバーの範囲の切り分け（重複テストを増やさない）、(b) エミュレーション（Playwright Pixel 7・モック GitHub）で十分な項目と実機でしか担保できない項目（実指タップ精度・実機フォント視認性・ソフトキーボード挙動・WebAPK standalone コールドスタート・Service Worker Background Sync）の線引き、(c) 5 秒 KPI の自動化形態（e2e/kpi.spec.ts は既に外形計測 PoC を持ち『実機体感の代替ではない』と明記している。回帰ガードとして閾値 assert を強めるのか、実測を KPI 正本として残すのか）、(d) 残る手動確認の『チェックリスト生成・結果の Issue コメント記録』まで自動化するか（新規ツール追加の是非）、(e) 実行経路（ci.yml の E2E に載せるか、smoke.yml で本番に対して回すか）。制約: 追加ライブラリを増やさない（docs/design/design-guidelines.md D-6）・YAGNI・タスク外リファクタ禁止。
- 参加者: `e2e-coverage-auditor`, `real-device-realist`, `automation-maximalist`, `yagni-guard`
- 投稿数: 0
- 更新: 2026-07-25T13:39:40+09:00

> このファイルは `tools/discussion_whiteboard.py render` が自動生成する。直接編集せず `post` で追記すること（同時書き込み破損防止）。

_（まだ投稿がありません）_
