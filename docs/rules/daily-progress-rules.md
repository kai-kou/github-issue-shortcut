# 日次進捗報告ルール

> 要対応のトリアージは `docs/rules/user-notification-triage.md`（SSOT）に従う。本ファイルは
> 日次進捗レポートの構成と `@mention` 抑制の運用を定義する。

## 原則

日次進捗報告は、ユーザーが手元を離れていても状況を把握できるようにする FYI（情報提供）が基本。
**真の要対応（A-1〜A-6 該当）がゼロの日は `@mention` しない**（毎日 ping しない）。

## 構成

| セクション | 内容 |
|-----------|------|
| 完了サマリー | 当日マージした PR・クローズした Issue・done_sp |
| 進行中 | `status:in-progress` の Issue（担当セッション） |
| 要対応（A 区分のみ） | `user-notification-triage.md` の機械トリアージで A 区分に分類された項目のみ |
| 衛生指標 | オープン Issue / PR 数・Orphan・stale 件数（CP-3） |

## `@mention` の判定

```
要対応（A-1〜A-6 該当）が 1 件以上ある
  ├─ YES → @mention 付きで通知（各項目に「具体的ユーザーアクション + 結果」を必須記載）
  └─ NO  → @mention なしの FYI として日次進捗を情報提供のみ
```

- B/C/D 区分（障害の自律修正・ルール整備済み・外部要因フォールバック）は要対応に混ぜない
- 実装: プロジェクト定義の進捗収集スクリプト（`@mention` 抑制に対応させる）+ `tools/slack_notify.py daily-progress`

## 関連

| ドキュメント | 関係 |
|------------|------|
| `docs/rules/user-notification-triage.md` | 要対応トリアージの SSOT（`@mention` 発火条件） |
| `docs/rules/user-confirmation-minimization.md` | A-1〜A-6 既約境界外の SSOT |
| `docs/rules/progress-reporting-rules.md` | 制作系長時間処理の進捗報告（本ルールとは別軸） |
