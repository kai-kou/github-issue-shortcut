# プロジェクト状態スナップショット（2026-07-26 00:35 JST 更新）
> SessionStart フックが自動注入。最新化は `python3 tools/generate_project_context.py`。

## Issue / PR
クラウドでは gh が 403 のため未取得。`mcp__github__list_issues` / `mcp__github__list_pull_requests` で直接確認する（status:in-progress / status:waiting-claude / status:waiting-user / open PR・L-114）。

## 直近のコミット
- 627a99c docs: 実機確認の結果を M1〜M3 の Done 判定へ反映（#93 / #95） (#154)
- 17e004d fix: 実機計測 Issue の手順整備と改善バックログ消化（#91 / #128 / #133 / #134） (#151)
- 378fea7 fix: サブエージェント所見をファイル経由で受け渡し、受領を機械検証する（#140） (#150)
- e1a4d37 test: 実機手動チェックリストの自動化可能部分を機械検証に移す (#148) (#149)
- c1f5a0f fix: worker 環境の closeBundle が前回ビルドの sw.js 残骸を誤検知する不具合を修正 (#147)
- 3fcd0a5 feat: @label 入力中にラベル候補をインライン表示する（オートコンプリート） (#146)
- 3e70400 fix: ショートカットタップでキーボードが開かない回帰を修正（VirtualKeyboard 実験の撤去 + blur→focus） (#144)
- 1edd94f improvement: 温かい起動でのキーボード表示を VirtualKeyboard API で試みる（実験） (#142)
