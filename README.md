# telemetry/worker-usage

Cloudflare Workers（`github-issue-shortcut`）の日次利用状況（機械生成テレメトリ）専用の
データブランチにゃ。

- 書き込みは `tools/record_worker_usage.py` のみ（スプリントルーティン Step 1.6 から実行）。
- main とはマージしない（コード履歴を汚さない・#242 と同じ方針）。
- Cloudflare の GraphQL Analytics は 32 日より過去を返さないため、ここが長期履歴の正本になる。
- 含むのはリクエスト数・エラー数・サブリクエスト数のみ。**利用者を識別する情報は含まない**
  （そもそも Workers のメトリクスに個人を識別できる軸が無い）。
- 参照: `git show origin/telemetry/worker-usage:content/analytics/worker_usage/SUMMARY.md`
