# デザインルール（実装セッション向け・Warm 層）

> **SSOT は `docs/design/design-guidelines.md`**（根拠・出典・パターン詳細はそちら）。
> 本ファイルはフロントエンド（`src/`・`index.html`・PWA manifest）を変更するタスクの着手時に Read する
> 要約ルール。タスク依存ルールのため `.claude/rules/` への symlink は作らない（常駐不要）。

## いつ Read するか

- `src/**`・`index.html`・`vite.config.ts`（manifest）・`src/**/*.css` を変更するタスクの着手前
- UI/UX の設計判断（画面追加・フロー変更・コンポーネント追加）を含む Issue の着手前
- `design-review` スキル実行時（スキルが本ファイルとチェックリストを Read する）

## 鉄則（違反したら設計から見直す）

1. **起票フロー（起動 → 入力 → 送信）にタップ・画面・待ちを追加しない**。追加する機能は既定オフ（D-3）
2. **必須入力はタイトル 1 つだけ**。他はすべて省略可能 + 既定値で送信可能（D-2)
3. **送信失敗で入力を失わせない**。失敗時 = 入力保持 + 原因別メッセージ + 次アクション + 「下書き保存済み」明示（D-7）
4. **本アプリはキャプチャ専用**。閲覧・整理・編集機能は GitHub 側に委ねる（D-1）

## 実装時の数値基準（詳細表は design-guidelines.md §2）

| 対象 | 基準 |
|------|------|
| タップターゲット | 最低 24×24px（WCAG 2.2 AA）・インタラクティブ要素 44px 以上・主要操作（送信）48px・間隔 8px |
| フォームコントロール | font-size 16px 以上（iOS 自動ズーム防止） |
| コントラスト | 通常テキスト 4.5:1・18pt 以上 3:1（ライト/ダーク両方で確認） |
| 応答 | タップ後 0.1 秒以内に視覚フィードバック・INP 200ms・送信完了 1 秒目標 |
| manifest shortcuts | 最優先を先頭・3 件以内 |

## 実装チートシート（ブラウザ標準第一・D-6）

- タイトル欄: `enterkeyhint="send"` + `autocapitalize="sentences"` + ラベルは入力欄の上に常時表示（placeholder のみ禁止）
- 送信ボタン: 画面下部固定。キーボード共存は viewport meta の `interactive-widget=resizes-content`
- 下書き保存トリガー: `visibilitychange`（hidden）+ `pagehide`（`beforeunload` に依存しない）
- ダーク対応: `color-scheme: light dark` を維持し、色を足すときは両モードで確認
- アニメーション: 原則追加しない。追加するなら `@media (prefers-reduced-motion: reduce)` で無効化
- `maximum-scale=1` / `user-scalable=no` を viewport に書かない
- GitHub API エラー表示: 401=再ログイン導線 / 403・429=`retry-after`・`x-ratelimit-reset` から復帰時刻を計算して表示 / 404=「リポジトリが見つからないか権限がありません」/ 422=`errors[].field` をフィールド直下へ
- 楽観的 UI（`useOptimistic`）を使うときは失敗時の明示エラー + 再送 UI とセット（サイレントロールバック禁止）

## 機械チェック（自動で走る・手動でも実行可）

```bash
python3 tools/check_design_rules.py            # 静的チェック（Warning・self_review_check.py が自動実行）
npm run e2e                                     # e2e/design-guidelines.spec.ts（タップターゲット・16px・ダークモード）を含む
```

- 静的チェックは Warning（非ブロック）。E2E は CI でブロッキング
- Warning を意図的に残す場合は PR 説明文「## 設計意図・既知の警告」に理由を書く（self-review-checklist と同運用）

## レビュー

PR にフロントエンド変更が含まれるときは `docs/rules/design-review-checklist.md` の観点でセルフレビューする
（`design-review` スキルが手順を自動化。/code-review Layer 1 とは別観点＝UX・デザイン準拠の確認）。
