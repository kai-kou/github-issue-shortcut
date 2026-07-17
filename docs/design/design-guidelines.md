# デザインガイドライン（GitHub Issue Shortcut・SSOT）

> **本ファイルは本プロジェクトの UI/UX デザイン判断の唯一の正本（SSOT）である。**
> 根拠は Deep Research `content/research/design-uiux-20260717_deep_research.{md,json}`
> （ネイティブ /deep-research・3 票制敵対検証 + DIY 補完・全主張に一次情報 URL 付き）と
> `docs/research/2026-07-10-mobile-ux-pwa.md`。数値・出典の詳細は各リサーチファイルを参照する。
>
> 実装セッション向けの要約ルールは `docs/rules/design-rules.md`、レビュー観点は
> `docs/rules/design-review-checklist.md`（いずれも本ファイルを参照する派生物）。

## 0. 設計思想（North Star）

**「思いついた瞬間を逃さない」= 起票の速さ・確実さがすべての判断に優先する。**

- KPI: 起票所要時間 10 秒以内（タイトルのみ 5 秒以内）・起動 → 入力 → 送信 3 タップ以内・送信失敗時に入力内容を失わない・初回セットアップ 5 分以内（`docs/project-mission.md`）
- Nielsen の応答時間 3 閾値（0.1 秒 = 瞬時 / 1 秒 = 思考の連続性 / 10 秒 = 注意の限界）に対応させると、**起票フロー全体が「10 秒ルール」の内側**、タップ応答は 0.1 秒（INP 200ms）、送信完了は 1 秒以内が設計目標になる（[A] NN/g・リサーチ §4）
- 実証: Twitter Lite は app shell 化（compose 摩擦低減）で投稿数 75% 増。**入力までの摩擦低減はコア指標を直接動かす**（[A] web.dev case study・リサーチ §3）

## 1. デザイン原則（D-1〜D-10）

| # | 原則 | 根拠（リサーチ §） |
|---|------|------------------|
| **D-1** | **キャプチャとトリアージの分離**: 本アプリはキャプチャ（起票）に徹し、整理・閲覧・編集は GitHub 側に委ねる。閲覧系機能を起票フローに混ぜない | §1（Drafts・Todoist） |
| **D-2** | **入力 1 フィールド主義**: 必須入力はタイトル 1 つ。その他（本文・ラベル・リポジトリ変更）はすべて省略可能で、既定値（ショートカットの初期選択）で送信できる | §1（Todoist Quick Add） |
| **D-3** | **起票フローに 1 タップも足さない**: 新機能が起動 → 入力 → 送信の経路にタップ・画面・待ちを追加するなら既定オフ。メタデータ指定は「タップ選択チップ」か「インライン記号」の 2 経路で任意化する | §1・`project-mission.md` |
| **D-4** | **タップターゲットは 3 層基準**: 主要操作（送信・タイトル欄）48px 以上 / その他のインタラクティブ要素 44px 以上 / 機械チェックの最低ライン 24px（WCAG 2.2 AA）。ターゲット間は 8px 以上離す | §2（WCAG/M3/HIG） |
| **D-5** | **親指ファースト**: 主要アクション（送信）は画面下部（thumb zone の green 圏）に固定配置する。上部ナビに主要操作を置かない。タップの 75% は親指駆動 | §6（Hoober 2013） |
| **D-6** | **ブラウザ標準機能を第一選択**: enterkeyhint・inputmode・autocapitalize・`<dialog>`・CSS 標準（color-scheme・prefers-*）など、追加ライブラリゼロで実現できる経路を必ず先に検討する（バンドル予算・起動速度の防衛） | §2・§7 |
| **D-7** | **入力は絶対に失わせない**: 入力中の随時下書き保存（visibilitychange/pagehide トリガー）・送信失敗時の入力保持・失敗理由と次アクションの明示。サイレントロールバック禁止 | §4・§5 |
| **D-8** | **楽観的 UI は救済とセット**: 起票は高成功率・復旧容易なので楽観的 UI（即時成功表示）好適。ただし失敗時の明示エラー + 再送 UI が実装されるまでは楽観表示を導入しない | §4（useOptimistic） |
| **D-9** | **両アピアランス対応 + フォーカス管理**: ライト/ダーク両方で表示・コントラスト（通常 4.5:1・大文字 3:1）を検証する。アニメーションは prefers-reduced-motion で無効化し、既定でも最小限にする。エラー表示・画面遷移でフォーカスを見失わせない（WCAG 2.4.3 Focus Order / 2.4.11 Focus Not Obscured） | §6 |
| **D-10** | **意図的ミニマリズム**: すべての UI 要素に存在理由（起票を速くするか・確実にするか）を要求する。装飾・演出はデフォルト不採用 | §7（トレンドは参考・原則は D-3 から導出） |

## 2. 数値基準（機械チェック対応表・SSOT）

| 項目 | 基準値 | 根拠（一次情報） | 機械チェック |
|------|--------|-----------------|--------------|
| タップターゲット最低 | **24×24 CSS px**（AA） | WCAG 2.2 SC 2.5.8 | `e2e/design-guidelines.spec.ts`（boundingBox） |
| タップターゲット推奨 | 44px（HIG）/ 48px（M3・主要操作） | Apple HIG / Google | 同上（送信ボタン 48px 以上を assert・ベースライン CSS は `button[type="submit"]` 48px / その他コントロール 44px） |
| ターゲット間隔 | 8px 以上 | M3（Android Accessibility） | レビュー目視（チェックリスト） |
| フォームコントロール font-size | **16px 以上** | iOS Safari 自動ズーム防止（業界標準・要注意 B ランク） | `tools/check_design_rules.py` + E2E |
| コントラスト比 | 通常テキスト **4.5:1** / 18pt 以上 3:1 | WCAG AA・Apple HIG 同値 | レビュー目視（axe-core 導入後は自動・#後続） |
| LCP | < **2.5 秒**（75 パーセンタイル） | web.dev Core Web Vitals | Lighthouse CI（後続 Issue） |
| INP | ≤ **200ms** | 同上 | 同上 |
| CLS | ≤ **0.1** | 同上 | 同上 |
| 送信タップ応答 | 0.1 秒以内に視覚フィードバック | NN/g 応答時間 3 閾値 | E2E（所要時間計測・後続） |
| 起票タップ数 | 起動 → 入力 → 送信で **3 タップ以内** | KPI（project-mission.md） | E2E シナリオのステップ数で担保 |
| manifest shortcuts | 最優先アクションを先頭・**3 件以内**（Chrome for Android の実装値・仕様保証なし・要実機再確認） | web.dev（2020 年記事・fact_check_flags #1） | レビュー目視 + `e2e/pwa.spec.ts` |
| アイコン | 512×512 + 192×192（maskable） | web.dev manifest | `e2e/pwa.spec.ts` |
| ズーム禁止の禁止 | `maximum-scale=1` / `user-scalable=no` を書かない | WCAG（拡大の妨害） | `tools/check_design_rules.py` |

> **既知の例外（SSOT・ドリフト防止）**: `input[type="checkbox"]` / `input[type="radio"]` はネイティブ描画サイズが崩れるため、ベースライン CSS（`src/index.css`）・E2E の font-size 検査の **対象外** としている。現状これらはラベルピッカー（既定で閉じた `<details>` 内）にのみ存在し、E2E のタップターゲット検査は「可視要素のみ」を見るため **ピッカーを開いた状態の実寸は未検証**。ピッカー UI を本格実装する際に、チェックボックスの実効タップ領域（ラベル行全体を 24px 以上のタップ対象にする等・WCAG Spacing 例外の適用可否）を設計・検証すること（デザイン負債として明記）。

## 3. 画面・フローの設計パターン

### 3.0 初回セットアップ・GitHub 認証（KPI: ログイン → 初起票 5 分以内）

- **セットアップは 3 ステップで完結させる**: ① GitHub でログイン（OAuth 認可）→ ② リポジトリ選択 → ③ 初起票（＝完了）。ステップ追加（チュートリアル・プロフィール設定等）は既定で入れない（D-3 と同根）
- **認可失敗・キャンセル時**: エラー原因（拒否・タイムアウト・権限不足）と「もう一度ログイン」導線を同一画面に表示する。行き止まり画面を作らない（§3.2 のエラー原則と同じ・[A] NN/g）
- **ホーム画面追加の誘導**: 初起票の完了直後（成功体験の直後）に 1 回だけ提示する。起票フロー中には出さない。誘導文には「次回からホーム画面のアイコンで数秒起票」という価値を明記する
- **ショートカット（リポジトリ / ラベル初期選択）の作成**: 完了画面または設定から、選択済みリポジトリ・ラベルをプリセットした起動 URL を案内する（manifest shortcuts + URL パラメータ・§3.4）
- レビュー観点: セットアップ導線を変更する PR は「ステップ数が 3 を超えないか」「認可失敗の再試行導線があるか」を確認する（design-review-checklist.md §0）

### 3.1 起票フォーム（コア画面）

- **タイトル欄**: 画面上部に大きく 1 つ。`enterkeyhint="send"`・`autocapitalize="sentences"`・16px 以上。ラベルは入力欄の上に常時表示（placeholder のみは NN/g 非推奨・[A] リサーチ §2）
- **キーボード制約への対応**: Android Chrome はコールドローンチで autofocus してもキーボードが開かない（ユーザージェスチャ内の focus() のみ）。**「起動 → 1 タップでキーボード」を最短として設計** し、起動直後の画面はタイトル欄タップが最初の自然な操作になるよう他の視覚ノイズを排除する（[B] リサーチ §1）
- **メタデータ（ラベル・リポジトリ）**: 既定値（ショートカットからの初期選択・最近使用）を表示するチップとして置き、変更はチップタップ → ボトムシート（`<dialog>` 等の標準要素）で行う。タイトル入力を中断させない
- **送信ボタン**: 画面下部固定（sticky footer）・幅広・44px 以上。キーボード表示時は `interactive-widget=resizes-content` で押し上げる（[A] リサーチ §2）

### 3.2 送信・完了・失敗

- 送信中: 1 秒未満で完了する想定のためスケルトン不要。ボタンを disabled + 軽量インジケーターに切り替える（連打防止と 0.1 秒フィードバックの両立）
- 完了: 成功表示 + 「Issue を開く」リンク + 即座に次の起票が可能な状態へ復帰（キャプチャ連続性）
- 失敗: **入力内容は画面に残したまま**、原因（401/403/429/404/422 の別）と次アクション（再ログイン・N 分後に再送・権限確認・フィールド修正）を発生箇所近傍に表示。「下書きは保存済み」を明示（[A] NN/g + GitHub Docs・リサーチ §5）。エラー表示時はフォーカスをエラーメッセージ近傍へ移動し、キーボード等に隠されない位置に出す（WCAG 2.4.3 / 2.4.11・D-9）
- オフライン（ネットワーク到達不能）: 4xx/5xx とは明確に区別し、「オフラインです。接続回復後に自動で再送します（下書き保存済み）」の文言で表示する。自動再送の対象はネットワーク失敗のみで、4xx/5xx は再送せずユーザー修正を促す（workbox-background-sync の仕様・[A] リサーチ §5）
- UI 文言（エラー・チップ・ボタン）は既存の i18n 基盤（`src/i18n/`・日英）に従い、両ロケールを用意する。GitHub API の英語エラーメッセージは生表示せず、ステータス別マッピング文言に変換する

### 3.3 下書き保全（KPI「入力を失わない」の実装標準）

- 入力中: 随時保存（現行 `src/issues/draft.ts` の localStorage 方式を維持。高頻度化・大容量化したら IndexedDB へ）
- 離脱時: `visibilitychange`（hidden）+ `pagehide` で最終保存。`beforeunload` には依存しない（モバイルで発火しない・[A] MDN）
- 再訪時: 下書きがあれば復元して表示（無言で捨てない）
- インストール誘導: ホーム画面追加は Safari ITP 7 日削除の回避にもなるとされる（[B] リサーチ §5・fact_check_flags #4。iOS 実機での長期検証は未実施のため断定しない）

### 3.4 起動導線（PWA）

- manifest `shortcuts` は「New Issue（既定リポジトリ）」を先頭に 3 件以内に収める（3 件は Chrome for Android の実装値であり仕様保証なし・実装時に実機で再確認する）。アイコン長押し導線は Android のみ（iOS 非対応）と認識する
- display は `standalone`・アイコン 512/192（maskable）・app shell プリキャッシュ（vite-plugin-pwa 既定 + workbox）で再訪サブ秒起動を守る
- Web Share Target 受信時は Android の `text` フィールドに URL が入る癖に対応する（[A] リサーチ §3）

## 4. アンチパターン（やらないこと）

- ❌ 起票フローへのステップ追加（確認ダイアログ・チュートリアル・アンケート・スプラッシュ）
- ❌ placeholder だけをラベルにする / フローティングラベル依存
- ❌ `maximum-scale=1` / `user-scalable=no` でズーム禁止（WCAG 違反）
- ❌ 送信失敗でフォームをクリアする・エラーを toast 一瞬で消す・原因不明の「エラーが発生しました」
- ❌ 楽観的 UI のサイレントロールバック（成功と見せて無言で取り消す）
- ❌ UI ライブラリ・CSS フレームワークの安易な導入（バンドル予算と起動速度が先。導入は計測とセットで別 Issue）
- ❌ 反証済み主張に基づく設計判断: 「beforeinstallprompt に fetch ハンドラ必須」「manifest は全ブラウザで必須」（リサーチで反証済み・生レポート参照）

## 5. 機械チェック・レビュー体制マップ

| レイヤー | 実体 | 対象 |
|---------|------|------|
| 静的チェック（Warning） | `tools/check_design_rules.py`（`self_review_check.py` から自動実行） | 16px フォント・enterkeyhint・placeholder ラベル・reduced-motion・viewport ズーム禁止 |
| E2E（ブロッキング） | `e2e/design-guidelines.spec.ts` | タップターゲット 24/44px・フォーム 16px・ダークモード smoke |
| E2E（既存） | `e2e/issue-draft.spec.ts` ほか | 下書き保全・起票フロー |
| レビュー観点 | `docs/rules/design-review-checklist.md` + `design-review` スキル | 機械化できない原則（D-1〜D-3・D-5・情報階層・文言） |
| 後続導入（Issue 化） | Lighthouse CI（LCP/INP/CLS・minScore）・@axe-core/playwright（wcag22aa タグ必須）・size-limit（バンドル予算） | パフォーマンス・a11y の自動化 |

## 6. 参照

| ファイル | 内容 |
|---------|------|
| `content/research/design-uiux-20260717_deep_research.md` | 本ガイドラインの根拠（一次情報 URL・情報ランク付き・47 出典） |
| `content/research/design-uiux-20260717_research_raw.md` | /deep-research 統合結果の原本（反証済み主張・caveats 含む） |
| `docs/research/2026-07-10-mobile-ux-pwa.md` | 先行リサーチ（autofocus 制約・shortcuts・share_target・TWA ロードマップ） |
| `docs/rules/design-rules.md` | 実装セッション向け要約ルール（Warm 層） |
| `docs/rules/design-review-checklist.md` | デザインレビュー観点（PR レビュー時） |
| `docs/project-mission.md` | KPI・判断基準の上位定義 |
