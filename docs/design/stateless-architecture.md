# 設計: ステートレス化（サーバー個人データ保持ゼロ）アーキテクチャ

- 作成日: 2026-07-27
- ステータス: 採用決定（オーナー判断・2026-07-27）
- 背景資料: [公開リスク・コストのリサーチ](../research/2026-07-27-public-release-risk-cost.md)

## 1. 決定

**サーバー（Cloudflare）に個人データを一切保持しない構成へ移行し、D1 を廃止する。**
GitHub のトークンは **Worker の鍵で暗号化した HttpOnly Cookie** に格納し（前回検討の「C 案」）、
それ以外の状態（ショートカットプリセット・重複防止・下書き）はすべて利用者の端末に置く。

### なぜ

- 公開時の最大リスク（他人の GitHub トークンを預かること・漏洩の一撃性・鍵ローテーション不能）が構造的に消える
- APPI / GDPR の実務負担（越境移転の情報提供・開示請求対応・保持期間の管理）がほぼ消える
- 「消えないデータが増え続ける」問題（`request_ids` / `rate_limits` / 期限切れ `sessions`）が発生源ごと無くなる
- インフラコストの主因（D1 書き込み＝総額の約 7 割）が消える
- **シンプルさ**: 永続層・マイグレーション・行ロック・保持期間 Cron がすべて不要になる（オーナーの方針）

### 採らなかった案

| 案 | 却下理由 |
|----|---------|
| トークンを localStorage / IndexedDB に生で置く | XSS 一発で private リポジトリの Issue 読み書きを奪われる。ブラウザアプリ向け OAuth のベストプラクティスに逆行 |
| GitHub API をブラウザから直叩き（CORS 利用） | トークンを JS から読める場所に置く必要があり、上と同じ問題。**Worker プロキシは維持する** |
| PAT 手動入力方式（Worker ごと廃止） | ミッション（PAT レス）に真っ向から反する |
| D1 を残したまま保持期間だけ実装 | 対症療法。トークンを預かる構造（最大リスク）が残る |

## 2. 変更後のアーキテクチャ

```text
ブラウザ（PWA・利用者の端末）
├ Cookie（HttpOnly・Secure・SameSite=Lax・JS から読めない）
│   └ __Host-gh : AES-256-GCM で暗号化した { access, refresh, 各有効期限 }
├ Cookie（JS から読める・個人データではない）
│   └ __Host-gh-exp : access token の有効期限（UNIX 秒）だけを持つ
├ localStorage : ショートカットプリセット・最近使ったリポジトリ・下書き・UI 設定・キャッシュ
└ IndexedDB    : オフラインキュー・送信済み client_request_id（重複防止・SW と共有）
      │ HTTPS（Cookie 自動送信）
      ▼
Cloudflare Worker（ステートレス・永続層なし）
├ /auth/login・/auth/callback : PKCE + トークン交換（client_secret 必須・CORS 非対応のため Worker 必須）
├ /auth/refresh               : Cookie の refresh token でローテーション → Set-Cookie で書き戻し
├ /api/*                      : GitHub API プロキシ（Cookie を復号 → GitHub 呼び出し）
└ Rate Limiting binding       : 悪用抑止（カウンタは Cloudflare 管理・個人データを保存しない）

D1: 廃止
```

**保持するものは「暗号化された鍵を運ぶ Cookie」だけで、それも利用者の端末にある。**

## 3. 機能ごとの移行先

| 現状（D1） | 移行後 | 備考 |
|-----------|-------|------|
| `users` | 廃止 | login / avatar は `/api/me` が GitHub `/user` を都度取得（クライアントは localStorage にキャッシュ済み） |
| `sessions` | 廃止 | トークン Cookie 自体がセッションを兼ねる |
| `tokens` | **暗号化 Cookie** | §4 |
| `shortcuts` | localStorage | 端末間同期を失う（§6） |
| `issue_log`（30 秒窓の重複防止） | localStorage（`src/issues/submitGuard.ts`・P3 完了） | 同一端末の二重タップ・再送が本質的なケース |
| `request_ids`（26 時間窓の重複防止） | IndexedDB（`src/issues/sentRequestIds.ts`・P3 完了） | 複数タブが同時に再送しても予約が直列化される（readwrite トランザクション内で get → put）ため localStorage ではなく IndexedDB。当初は Service Worker との共有も理由に挙げていたが、SW の再送経路は #177 で撤去した |
| `rate_limits` / `shortcut_rate_limits` | Workers Rate Limiting binding（P3 完了） | クライアントには置けない（改変可能なので防御にならない）。キーは GitHub 数値ユーザー ID のハッシュ |
| Cron（`issue_log` 削除） | 廃止 | 消すべきデータが無くなる |

## 4. トークン Cookie の設計

### 形式

```
__Host-gh = base64url( keyVersion || iv(12B) || AES-256-GCM( JSON ) )
JSON = { "a": "<access token>", "ae": <unix秒>, "r": "<refresh token>", "re": <unix秒>,
         "x": <ログインの絶対期限・unix秒>, "u": <GitHub の数値ユーザー ID> }
```

- **鍵バージョンを先頭に持たせる**（P2 で実装済み・`crypto.ts` の `sealVersioned`/`openVersioned`）。これにより **暗号鍵のローテーションが可能** になる
  （旧鍵で復号できなければ再ログインさせるだけで、失われるデータは無い＝リサーチの R1 が解消する）
- サイズ試算: `ghu_` / `ghr_` は各 40 文字前後 → JSON 約 150 バイト → 暗号化 + base64url で **約 250 バイト**。
  Cookie の 4KB 上限に対して十分な余裕がある
- 属性: `HttpOnly; Secure; Path=/; SameSite=Lax`（`Strict` は OAuth コールバックを壊す）
- `Max-Age`: **ログインの絶対期限 `x`（30 日）** に合わせる。refresh token の有効期限（約 6 か月）ではない:
  Cookie 自体が自己完結型のクレデンシャルで失効レコードを持たないため、盗まれた Cookie がリフレッシュを
  繰り返して半年生き延びないよう上限を設ける（`x` はリフレッシュで延長しない）
- `u`（GitHub の数値ユーザー ID）は、レート制限のキー（HMAC でハッシュ化して Rate Limiting binding へ渡す）に使う。AEAD で認証済みの
  ため、クライアントが他人の ID を騙ることはできない
- **ログアウト・アカウント削除では GitHub の失効 API（`DELETE /applications/{client_id}/token`）を呼ぶ**。
  Cookie を消すだけでは、値をコピーされていた相手を止められない

### 有効期限の露出（`__Host-gh-exp`）

クライアントは HttpOnly Cookie を読めないため、**access token の有効期限だけ** を JS から読める Cookie に併置する。
中身は数値 1 個で、これ自体は個人データではない。クライアントはこれを見て、期限切れが近いときだけ
`/auth/refresh` を **先に 1 回だけ** 呼ぶ（§5）。

## 5. リフレッシュ競合への対処（本移行の最大の技術リスク）

GitHub のリフレッシュトークンは **単回使用ローテーション** で、P1 までは D1 の行ロックで直列化していた。
Cookie 化すると同じ競合が戻ってくるため、以下の三段構えで対処する（P2 で実装済み）。

1. **Web Locks API（`navigator.locks`）でリフレッシュを 1 本化する（主対策）**
   同一オリジンのタブ・Service Worker で共有されるロックのため、多タブからの同時リフレッシュを
   クライアント側で直列化できる（SW からのリフレッシュ経路は現在存在しない・#177）。ロック内で `__Host-gh-exp` を再確認し、
   他者が更新済みならリフレッシュをスキップする。
2. **サーバーは「復号 → 使用 → 必要なら Set-Cookie」の単純な流れに保つ**
   リフレッシュ結果は必ず同一レスポンスの `Set-Cookie` で書き戻す。API プロキシ内で暗黙にリフレッシュ
   しないことで、Set-Cookie の取りこぼし（並行レスポンスの上書き）を構造的に減らす。
3. **失敗時は即・再ログイン導線**（保険）
   `bad_refresh_token` は自動リトライせず再ログインへ誘導する。下書きは保全されるため利用者の損失はゼロ。

> **受容するトレードオフ**: 稀な同時実行（例: 複数端末で同時に長期間ぶりの起動）では再ログインが発生しうる。
> FR-3（ユーザー操作なしの自動更新）は「通常操作では満たす」水準になる。D1 の行ロックほど厳密ではない。

## 6. 失うもの（意図的に受け入れる）

| 失うもの | 影響 | 判断 |
|---------|------|------|
| スクリプト経由の反復起票（同一内容の連投）のサーバー側 **判定**（内容の保存・照合） | 正規の Cookie を持つ利用者が API を直接叩いた場合、内容を保存した厳密な冪等性判定はできない | 受容（P3・冪等性の判定材料をサーバーに置かない方針の帰結）。ただし **抑止そのものは #179 で Rate Limiting binding により復元済み**（下記） |
| ショートカットの端末間同期 | 機種変更・ブラウザデータ削除で再作成が必要 | 受容（エクスポート / インポートは将来の任意機能） |
| 複数端末をまたぐ重複起票の防止 | 別端末で同時に同一内容を起票すると 2 件できる | 受容（発生条件が極めて稀） |
| 「サーバーには届いたがレスポンスが届かなかった」再送の抑止 | 送信直後に通信が切れた場合、端末からは成否を判別できないため再送で 2 件できる | 受容（P3・サーバー予約でしか判別できず、保持ゼロと両立しない）。キュー滞留 24 時間超は自動再送を打ち切り手動確認へ回す（#91）ことで露出を抑える |
| 動的 manifest（#98 のユーザープリセット反映） | アイコン長押しメニューは汎用 3 件に戻る | **静的 manifest に戻す**（§7） |
| サーバー側の起票成功率 KPI（`issue_log` ベース） | 実測値をサーバーで集計できない | 受容（KPI は E2E の実機計測に寄せる） |

### 6.1 起票ガードの永続層なし復元（#179）

Issue #179 で検討した 3 案のうち、**1（同一内容の連投抑止）と 2（入力長・件数の上限）を採用し、3（レート制限の実効値見直し）は採らない**。

- **1（採用）**: `HMAC(userId + contentHash)` をキーにした、起票のボリューム制限（`ISSUE_RATE_LIMIT`）とは別目的の Rate Limiting binding（`ISSUE_DUPLICATE_SUBMISSION_LIMIT`・`simple: { limit: 1, period: 10 }`）を追加した（`wrangler.jsonc`）。サーバーに内容は一切保存せず、カウンタだけで「同一ユーザー・同一内容の起票は 10 秒に 1 回まで」を強制する。429 のエラーコードは、既存のクライアント側ガード（`src/issues/submitGuard.ts`）が検出したときと **同じ `duplicate_submission` を再利用する**（新規コードを起こさない）。利用者から見れば「同一内容を連続で送った」という事象は判定の場所（端末 or サーバー）に関わらず同一であり、表示を分ける理由がないため。既存のボリュームレート制限（`rate_limited`）とは意味が異なるので流用しない。i18n の追加は不要（`src/issues/submitError.ts` が既存の `duplicate_submission` 分岐で処理する）。
- **2（採用）**: `title` / `body` / `labels` の長さ・件数を Worker 側で検証し、GitHub へ転送する前に 400（`invalid_request`。既存の「repo/title 必須」チェックと同じコードを再利用）で弾く（`worker/index.ts`）。上限値は GitHub の実測上限（[dead-claudia/github-limits](https://github.com/dead-claudia/github-limits) を一次情報として 2026-07-28 に確認）に合わせた: title 256 文字・body 65536 文字・labels 100 件・label 名 1 件あたり 50 文字（`src/shortcuts/shortcutsStore.ts` の `SHORTCUT_LABEL_MAX_LENGTH` と同値）。
- **3（不採用）**: レート制限の実効値（10 件/分）は変更しない。Rate Limiting binding のカウンタがデータセンター単位で実効上限が緩みうる点は既知のトレードオフ（OQ-6）だが、1・2 の対策で「同一内容の連投」という主要な悪用パターンは抑止できるため、実効値の引き下げや GitHub 403 二次制限の検出・停止機構は費用対効果が低いと判断した。必要になれば別 Issue で再検討する。
- **既知の制約（#193 レビュー指摘）**: Rate Limiting binding にカウンタを解放する API がないため、GitHub 呼び出しが失敗（5xx 等）してもカウンタは消費されたまま戻せない。直後に利用者が正規の再送をすると `duplicate_submission` 429 になるが、この時点で Issue は作成されていない。この構造的制約は実装では解決できないため、UI 文言は「送信済みです」と断定せず「見送りました（再試行を促す）」表現に変更して対応した（`src/i18n/translations.ts` の `duplicateSubmission`）。

## 7. 動的 manifest（#98）の扱い

現状は Worker がセッションからユーザーのプリセット上位 3 件を読んで `manifest.webmanifest` を差し替えている。
サーバーが状態を持たなくなるため、選択肢は 2 つある。

| 案 | 評価 |
|----|------|
| **A. 静的 manifest に戻す（採用）** | プリセットは元々「ホーム画面に追加」の URL ベース（FR-16・無制限）が主導線。manifest shortcuts は 3 個上限・反映 24 時間周期で価値が限定的。**シンプルさを優先する本方針に合致** |
| B. クライアントが `?s=<プリセット>` 付き manifest URL を動的に設定 | private リポジトリ名が URL に載り、Cloudflare 側のログに渡りうる（保持ゼロの目的に逆行）。Chrome の manifest 再取得挙動も要検証 |

→ **A を採用**。#98 で得た「ユーザーごとのショートカット」の価値は FR-16 の URL ベース導線が引き続き担う。

## 8. 「保持ゼロ」を名乗るための付帯設定

アプリが D1 を持たなくなっても、Cloudflare 基盤側の記録は残る。以下を明示的に設定する。

- `wrangler.jsonc` に `observability` を明記し、**ログを無効化するか head sampling を 1〜5% に絞る**
  （既定は「新規 Worker で有効・サンプリング 100%」のため、未設定のままでは 100% 記録される）
  → **P4 で `enabled: true` + `head_sampling_rate: 0.05` + `logs.invocation_logs: false` を採用**
- **invocation log を無効化するのが必須**（サンプリングだけでは足りない）。invocation log は
  Request / Response と **ヘッダーごと** 記録するため（[2025-04-07 changelog](https://developers.cloudflare.com/changelog/post/2025-04-07-increase-trace-events-limit/)
  「request metadata, and headers are automatically captured」）、本アプリは認証を Cookie で行う以上、
  暗号化トークン Cookie がサンプリングに当たった分だけ Cloudflare 側に残ってしまう
- 無効化後に残るのは **例外（uncaught exception）と `console.*` 出力だけ**（`invocation_logs = false` は
  invocation log のみを止める）。本アプリのコードに `console.*` は無いため、実質はエラー記録のみ
- 保持は Cloudflare の上限に従う: **無料プラン 3 日 / 有料プラン 7 日**
  （[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) の pricing 表。
  本プロジェクトのアカウントに Workers Paid の契約は無いため現状は 3 日）
- D1 廃止により **Time Travel（復元履歴）も消滅** する
- プライバシーポリシーを「サーバーには保存しない / 端末内に保存する / Cloudflare 基盤の記録は 7 日」に全面改訂する（P4 で完了）

## 9. 移行フェーズ

各フェーズはそれぞれ単独でデプロイ可能な状態を保つ（アプリが壊れる中間状態を作らない）。

| Phase | 内容 | 主な変更 |
|-------|------|---------|
| **P1** ✅ | ショートカットのクライアント移行（完了・#163） | `/api/shortcuts` 廃止・localStorage を正本化・manifest を静的に戻す（§7） |
| **P2** ✅ | 認証のステートレス化（完了・2026-07-27・#164） | 暗号化トークン Cookie（鍵バージョン付き）・`/auth/refresh`・Web Locks 直列化・`/api/me` を GitHub 直取得へ。`users` / `sessions` / `tokens` / `shortcuts` は D1 から削除済み |
| **P3** ✅ | 重複防止とレート制限の移行（完了・2026-07-27・#165） | 30 秒窓を localStorage・client_request_id を IndexedDB へ・Rate Limiting binding 導入。`worker/store.ts` と保持期間 Cron を削除し、Worker から D1 の利用が消えた |
| **P4** ✅ | D1 撤去と対外文書の更新（完了・2026-07-27・#166） | バインディングと `migrations/` を削除・`observability` を 5% サンプリングで明示設定・プライバシーポリシーに「基盤の記録」「問い合わせ窓口」を追加・利用規約に端末内データ前提の記述を追加。Cloudflare 上の DB 実体はデプロイ確認後に削除し #166 に記録する |

### 移行時のデータ

**既存 D1 データは移行しない（破棄する）**。本アプリは未公開でユーザーはオーナー本人のみのため、
再ログインとショートカットの再作成で足りる（移行スクリプトを書く価値がない）。

## 10. 完了の定義

- [x] D1 バインディング・`migrations/`・`worker/store.ts` が存在しない（P4。Cloudflare 上の DB 実体の削除は #166 で記録）
- [x] Worker が永続化 API（D1 / KV / R2 / DO）をひとつも使っていない（P3）
- [x] ログイン → 起票 → ショートカット作成 → 再訪の E2E が通る（`npm run e2e` 79 件 green・P4）
- [x] トークンが JS から読めない（`document.cookie` に現れない）ことをテストで担保（`e2e/stateless-auth.spec.ts`）
- [x] 鍵バージョンを変えると再ログインが要求され、それ以外のデータが壊れないことをテストで担保（`worker/tokenCookie.test.ts`）
- [x] プライバシーポリシー・利用規約・要件定義（NFR-7 / NFR-14 / NFR-17・§6.2）が新構成と一致（P4）
