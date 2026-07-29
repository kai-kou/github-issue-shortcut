# telemetry/cost-data

Claude Code セッションの月次トークン集計（機械生成テレメトリ）専用のデータブランチにゃ。

- 書き込みは `tools/commit_cost_telemetry.py`（Stop hook から 1 日 1 回）のみ。
- main とはマージしない（コード履歴を汚さない・#242）。
- **コスト実額（`cost_usd` / `cost_jpy_approx`）は含まない**。本リポジトリは public であり、
  運営者の Claude API 利用実額を残さないと決めている（#189）。ブランチを分けても公開されて
  いることに変わりはないため、このブランチも対象にした（#202）。較正に使うのはトークン数・
  セッション数で、金額はドル換算の便宜値にすぎず落としても用途は損なわれない。
- 参照: `git show origin/telemetry/cost-data:content/analytics/cost_monthly/YYYY-MM.json`
