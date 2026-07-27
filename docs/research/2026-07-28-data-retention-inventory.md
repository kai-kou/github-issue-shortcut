# リサーチ: 最新実装・環境で「どのデータを・どこに・どう保持しているか」の全数棚卸し

- 作成日: 2026-07-28 JST
- 対象コミット: `e3da629`（保持ゼロ化 P4 完了時点の `main`）
- 対象範囲: `worker/`（Cloudflare Worker）・`src/`（PWA クライアント）・`vite.config.ts`（Service Worker）・`wrangler.jsonc`（実行環境設定）
- 関連: [ステートレス化設計](../design/stateless-architecture.md) / [公開リスク・コストのリサーチ](2026-07-27-public-release-risk-cost.md)

---

## 0. 結論（3 行）

1. **サーバー（Cloudflare Worker）に永続層は 1 つも無い**（D1 / KV / R2 / Durable Objects いずれのバインディングも存在しない）。保持しているのは「暗号化されたトークンを **運ぶ** Cookie」だけで、実体は利用者の端末にある。
2. **アプリのデータはすべて端末内** にある。内訳は Cookie 3 種・localStorage 9 キー・sessionStorage 1 キー・IndexedDB 2 DB・Cache Storage（SW precache）。
3. Cloudflare 基盤側に残りうるのは **例外ログのみ**（invocation log 無効・head sampling 5%・保持 3 日）と、**Rate Limiting のカウンタ**（キーは GitHub ユーザー ID の HMAC ハッシュ）。

---

## 1. 全体像

```text
利用者の端末（ブラウザ / PWA）
├ Cookie
│   ├ __Host-gh      : AES-256-GCM 暗号化した GitHub トークン一式（HttpOnly・JS から読めない）
│   ├ __Host-gh-exp  : access token の有効期限（UNIX 秒）だけ（JS から読める）
│   └ __Host-preauth : OAuth の state + PKCE verifier（暗号化・TTL 10 分・callback で破棄）
├ localStorage  : ショートカット（正本）・下書き・オフラインキュー・各種キャッシュ・UI 設定（計 9 キー）
├ sessionStorage: ログイン後の復帰先（TTL 10 分）
├ IndexedDB     : ① issue-shortcut（送信済み client_request_id）② workbox-background-sync（SW キュー）
└ Cache Storage : Service Worker の precache（アプリの静的アセットのみ。API 応答は入らない）
      │ HTTPS（Cookie 自動送信）
      ▼
Cloudflare Worker（永続層なし・リクエストごとに復号 → GitHub 呼び出し → 破棄）
├ Workers Secrets / Vars : GITHUB_CLIENT_SECRET・TOKEN_ENCRYPTION_KEY・GITHUB_CLIENT_ID・TOKEN_KEY_VERSION
├ Rate Limiting binding  : カウンタのみ Cloudflare 管理（キー = HMAC-SHA256(GitHub 数値ユーザー ID)）
└ Workers Logs           : 例外のみ・5% サンプリング・保持 3 日（invocation log は無効）
      │
      ▼
GitHub（起票された Issue 本体・OAuth 認可の状態はここが正本）
```

---

## 2. サーバー側（Cloudflare Worker）— 永続層ゼロ

### 2.1 バインディング（`wrangler.jsonc` / `worker/types.ts`）

| 種別 | 名前 | 保持されるデータ |
|------|------|----------------|
| Vars（公開値） | `GITHUB_CLIENT_ID` | GitHub App の Client ID（公開値・個人データではない） |
| Vars（公開値） | `TOKEN_KEY_VERSION` | トークン Cookie の鍵バージョン（現在 `1`） |
| Secrets | `GITHUB_CLIENT_SECRET` / `TOKEN_ENCRYPTION_KEY` | アプリの秘密鍵。利用者データではない |
| Rate Limiting | `ISSUE_RATE_LIMIT`（`namespace_id: 1001`・10 件 / 60 秒） | **カウンタのみ**。キーは `HMAC-SHA256(TOKEN_ENCRYPTION_KEY, "issue-rate-limit:{GitHub 数値ユーザー ID}")`（`worker/index.ts` の `rateLimitKey`） |
| Rate Limiting | `ISSUE_RATE_LIMIT_RELAXED`（`namespace_id: 1002`・1000 件 / 60 秒） | E2E 専用（`ISSUE_RATE_LIMIT_RELAXED_ENABLED=1` のときだけ使用。本番では参照されない） |
| Assets | `ASSETS` | ビルド済み静的アセット（`dist/client`）。利用者データではない |

**D1 / KV / R2 / Durable Objects のバインディングは存在しない**（`migrations/` と `worker/store.ts` も削除済み）。したがって Worker のコードから書き込める永続ストアが存在しない。

- レート制限のキーが **無塩 SHA-256 ではなく HMAC** なのは、GitHub の数値ユーザー ID が公開かつ実質連番で、無塩だと総当たりで逆引きできてしまうため（`worker/crypto.ts` の `hmacSha256Base64url`）。
- 上限値は binding 側（`wrangler.jsonc`）に、`Retry-After` に使う窓長は `worker/index.ts` の `ISSUE_RATE_LIMIT_WINDOW_SECONDS = 60` に **二重管理**（binding から period を読む API が無いため）。片方だけ変えると不整合になる。

### 2.2 リクエスト処理中のデータ（すべて揮発）

`/api/me`・`/api/repos`・`/api/labels`・`/api/installations`・`/api/issues` はいずれも「Cookie 復号 → GitHub API 呼び出し → 応答を返す」だけで、途中の値をどこにも書かない。`/api/me` は GitHub の `/user` を **都度取得** する（旧 `users` テーブルの代替）。

`POST /api/issues` は `repo` / `title` / `body` / `labels` を受け取って GitHub へ転送するのみ。**`client_request_id` はサーバーへ送っていない**（P3 で重複防止が端末内へ移ったため、サーバーは重複判定の材料を一切持たない）。

### 2.3 Cloudflare 基盤側の記録（`wrangler.jsonc` の `observability`）

| 設定 | 値 | 意味 |
|------|----|------|
| `enabled` | `true` | Workers Logs は有効 |
| `logs.invocation_logs` | `false` | **リクエスト / レスポンスをヘッダーごと記録する invocation log を無効化**（有効だと暗号化トークン Cookie が Cloudflare 側に残る） |
| `head_sampling_rate` | `0.05` | 残る記録（uncaught exception・`console.*`）も 5% のみ |

アプリのコードに `console.*` は無いため、実質は **例外発生時の記録だけ**。保持期間は Cloudflare の上限（現行プランで最長 3 日 / 有料プランで 7 日）。D1 廃止により Time Travel（復元履歴）も消滅している。

---

## 3. Cookie（3 種）

| Cookie | 中身 | 属性 | 寿命 | 発行 / 破棄 |
|--------|------|------|------|------------|
| `__Host-gh` | `base64url(keyVersion(1B) ‖ iv(12B) ‖ AES-256-GCM(JSON))`。JSON は `{a: access token, ae: 期限, r: refresh token, re: 期限, x: ログイン絶対期限, u: GitHub 数値ユーザー ID}`（キーを 1 文字にしてサイズ節約・実測約 250 バイト） | `HttpOnly; Secure; Path=/; SameSite=Lax` | `Max-Age` = 絶対期限 `x` まで（**最長 30 日・リフレッシュで延長しない**） | `/auth/callback` と `/auth/refresh` で発行、`/auth/logout`・`DELETE /api/account`・リフレッシュ失敗時に破棄 |
| `__Host-gh-exp` | access token の有効期限（UNIX 秒）**だけ** | `Secure; Path=/; SameSite=Lax`（**HttpOnly ではない**） | 同上 | 同上。クライアントの先回りリフレッシュ判定に使う（`src/auth/tokenRefresh.ts`）。JS から書き換え可能なので認可の判断には使わない |
| `__Host-preauth` | OAuth の `state` と PKCE `verifier` を暗号化したもの | `HttpOnly; Secure; Path=/; SameSite=Lax` | `Max-Age` 10 分 | `/auth/login` で発行、`/auth/callback` の冒頭で必ず削除（使い捨て） |

設計上の要点:

- 鍵バージョンを先頭バイトに持たせ、**AAD として GCM の認証対象に含める** ため、バージョンバイトだけの差し替え改ざんは復号時に検出される（`worker/crypto.ts` の `sealVersioned` / `openVersioned`）。
- `TOKEN_KEY_VERSION` を +1 すると旧 Cookie は復号を試みずに弾かれ、**再ログインで済む**（端末内の下書き・ショートカットは失われない）。
- 絶対期限 `x`（30 日）は「盗まれた Cookie がリフレッシュを繰り返して refresh token の寿命（約 6 か月）まで生き延びる」のを止める最後の砦。
- ログアウト・アカウント削除では Cookie 破棄に加えて **GitHub 側のトークン失効 API** を呼ぶ（値をコピーされていた場合に備える）。

---

## 4. localStorage（9 キー）

| キー | 内容 | ユーザー紐付け | 寿命 / 上限 | 実装 |
|------|------|--------------|------------|------|
| `issue-shortcut:shortcuts-cache` | **ショートカットプリセットの正本**（`{userId, shortcuts:[{id, repo, labels, title, name}]}`） | あり（`userId` 不一致なら空配列に倒す） | 無期限。件数上限なし（1 件あたり repo 140 / title 500 / label 50 文字 × 20 個の上限） | `src/shortcuts/shortcutsStore.ts` |
| `issue-shortcut:auth-cache` | 起動時の即時表示用（`{me:{login, avatarUrl, githubUserId}, installed}`） | あり | 無期限（revalidate で更新・不一致時に消去） | `src/auth/authCache.ts` |
| `issue-shortcut:repos-cache` | リポジトリ一覧の SWR キャッシュ（`{userId, repos:[{id, fullName, private, pushAccess}]}`。**private リポジトリ名を含む**） | あり | 無期限 | `src/repos/reposCache.ts` |
| `issue-shortcut:repo-labels:{owner/repo}` | リポジトリごとのラベル一覧（name / color）。**リポジトリ数だけキーが増える** | なし（キーにリポジトリ名を含む） | 無期限 | `src/issues/repoLabelsCache.ts` |
| `issue-shortcut:recent-repos` | 最近使ったリポジトリ名（新しい順・**最大 5 件**） | なし | 無期限 | `src/repos/recentRepos.ts` |
| `issue-shortcut:draft` | 起票の下書き（`{repo, title, body}`・**常に 1 件のみ**） | なし | 送信成功まで（`clearDraft`） | `src/issues/draft.ts` |
| `issue-shortcut:offline-queue` | オフライン起票キュー（`{id, repo, title, body, labels, queuedAt, status, errorCode?, expired?}`。**本文を平文で保持**） | なし | 自動再送は 24 時間まで（`OFFLINE_QUEUE_TTL_MS`）。以降は `failed`（`queue_expired`）として **残り、手動で再送 / 破棄するまで消えない** | `src/issues/offlineQueue.ts` |
| `issue-shortcut:recent-submissions` | 二重送信防止の記録（`{key: SHA-256 ハッシュ, at}`）。**平文は保持しない**（共有端末・XSS 対策） | なし | 30 秒窓。読み書きのたびに窓外・未来日付を prune | `src/issues/submitGuard.ts` |
| `issue-shortcut:locale` | UI 言語（`ja` / `en`） | なし | 無期限 | `src/i18n/LanguageContext.tsx` |

共通の実装方針:

- 読み出しは **すべて型検証付きの純関数** で、未保存・破損 JSON・型不一致・別ユーザーはいずれも例外を投げず空値に倒す。
- 書き込み失敗（プライベートブラウジング・容量超過）は握り潰して機能継続する。**唯一の例外がショートカット** で、正本なので失敗を呼び出し側へ返す（`writePayload` が `false`）。
- `userId` 紐付けのある 3 キーは、別アカウントに切り替えたときに前ユーザーのデータ（private リポジトリ名を含む）が表示されないよう、読み出し時点で弾く。

---

## 5. sessionStorage（1 キー）

| キー | 内容 | 寿命 |
|------|------|------|
| `issue-shortcut:post-login-redirect` | 未ログインで `/new?...` に来た場合の復帰先（`{target, savedAt}`） | タブを閉じるまで。かつ **TTL 10 分**（超過分は復元しない）。読み出し時に必ず削除する使い捨て |

---

## 6. IndexedDB（2 DB）

### 6.1 `issue-shortcut`（v1）/ store `sent-request-ids`

- キー: `id`（= client_request_id・`crypto.randomUUID()`）、値: `{id, sentAt, done}`、インデックス `sentAt`（期限切れの一括削除用）
- **localStorage ではなく IndexedDB な理由**: Service Worker からも同じ記録を参照する必要があるため（localStorage は SW から読めない）。この理由でモジュール内に DOM API を一切使っていない。
- 判定（`evaluateClaim`）:
  - `done: true` かつ 26 時間以内（`SENT_REQUEST_ID_WINDOW_MS`）→ `sent`（重複なので送らない）
  - `done: false` かつ 60 秒以内（`IN_FLIGHT_TTL_MS`）→ `in-flight`（他経路が送信中。見送り）
  - それ以外・未来日付 → `claimed`（送ってよい）
- `claim` は同一 readwrite トランザクション内で get → put するため、2 タブ同時でも一方だけが予約を取る。
- prune は `claimRequestId` のたびに走り、期限切れ（26 時間超）と未来日付を削除する。

### 6.2 `workbox-background-sync`（Workbox が自動生成）/ キュー `issue-post-queue`

> ⚠️ **本節は調査時点（2026-07-28 午前）の観測記録であり、現在の実装には当てはまらない**。この直後に
> #177 で当該ルートごと撤去し、再送はページ側経路に一本化した。現在の正は `vite.config.ts` の
> コメントと `docs/requirements/00-requirements.md`（FR-22 のリスク行）を参照すること。

- `POST /api/issues` の失敗リクエストを保持し、オンライン復帰時に再送する想定（`maxRetentionTime: 24 * 60` 分）。
- 🔴 **現状このルートは 1 度も発火していない**: `urlPattern: /^\/api\/issues$/` を Workbox が **URL 全体（`url.href`）** に対して評価するため一致しない（既知の不具合 **#177**・`vite.config.ts` にコメント済み）。つまり実際にキューを保持しているのは localStorage 側（`issue-shortcut:offline-queue`）だけで、「ページを閉じていても再送」は効いていない。

### 6.3 3 つの重複防止窓の関係（順序が重要）

```text
submitGuard（localStorage・30 秒）  <  offlineQueue TTL（24 時間）  <  sentRequestIds（26 時間）
```

キュー滞留の上限（24h）を重複防止窓（26h）より **短く** 保つのが不変条件。逆転すると「予約が切れた後に同じ client_request_id で自動再送されて重複起票」する経路が開く（#91 の修正内容）。

---

## 7. Cache Storage（Service Worker）

- `vite-plugin-pwa` の `generateSW` により、アプリの静的アセット（JS / CSS / HTML / アイコン）を precache する。`registerType: "autoUpdate"`。
- `manifest.webmanifest` は precache から **除外**（`stripManifestFromSwPrecache` プラグイン）。
- `runtimeCaching` は `POST /api/issues` の Background Sync 定義のみで、**GET の API 応答をキャッシュする設定は無い**（＝ Issue・リポジトリ・ラベルのレスポンスが Cache Storage に残ることはない。SWR キャッシュは前述の localStorage 側が担う）。
- `navigateFallbackDenylist` により `/auth/*`・`/setup`・`/api/*` は SW のナビゲーションフォールバック対象外（OAuth コールバックがキャッシュ応答で壊れるのを防ぐ）。

---

## 8. 削除・失効のライフサイクル

| 契機 | 消えるもの | **残るもの** |
|------|-----------|------------|
| ログアウト（`useAuthState.logout`） | `auth-cache` / `repos-cache` / `shortcuts-cache` / `repo-labels:*`、トークン Cookie（サーバー側で破棄 + GitHub のトークン失効） | `draft` / `offline-queue` / `recent-repos` / `recent-submissions` / `locale`、IndexedDB の `sent-request-ids` |
| アカウント削除（`AccountDeletion` → `DELETE /api/account`） | 同上（`clearAllUserCaches()` は上記 4 種のみ） | 同上 |
| 別ユーザーでログイン検知（`useAuthState`） | 同上 4 種 | 同上 |
| 匿名（未ログイン）と判明 | 同上 4 種（セッション失効時は保持） | 同上 |
| 鍵ローテーション（`TOKEN_KEY_VERSION` +1） | トークン Cookie が復号不能になり再ログインへ | 端末内データはすべて残る（設計どおり） |
| ログインの絶対期限（30 日） | トークン Cookie | 端末内データはすべて残る |
| 送信成功 | `draft`（内容一致時）・該当キューエントリ | — |

---

## 9. 設計・プライバシーポリシーとの突合（差分あり 1 件）

| 主張（プライバシーポリシー / 設計） | 実装 | 判定 |
|--------------------------------|------|------|
| サーバーは個人データを保存しない | 永続バインディングなし・処理中の値のみ | ✅ 一致 |
| トークンは暗号化 Cookie・JS から読めない | `HttpOnly` + AES-256-GCM。E2E（`e2e/stateless-auth.spec.ts`）で `document.cookie` に出ないことを担保 | ✅ 一致 |
| レート制限には「ユーザー ID そのものは渡さない」 | HMAC-SHA256 でハッシュ化して渡す | ✅ 一致 |
| 基盤の記録は例外のみ・5% サンプリング・最長 3 日 | `observability` の設定と一致 | ✅ 一致 |
| トークン Cookie は最長 30 日で失効 | `SESSION_MAX_AGE = 30 日`・リフレッシュで延長しない | ✅ 一致 |
| **アカウント削除で「送信履歴」を即時に削除する** | `clearAllUserCaches()` は auth / repos / shortcuts / labels の 4 種のみ。**`recent-submissions`（送信履歴のハッシュ）・IndexedDB の `sent-request-ids`・`offline-queue`（Issue 本文を平文で保持）・`draft`・`recent-repos` は残る** | ⚠️ **不一致**（下記） |

### 見つかった差分（要 Issue 化）

1. **アカウント削除の削除範囲がポリシーの記載より狭い**（`src/auth/AccountDeletion.tsx` → `clearAllUserCaches`）。
   - ポリシー日本語版: 「端末内に保存されたデータ（トークン Cookie・ショートカット設定・**送信履歴**・各種キャッシュ）を即時に削除し」
   - 実装で残るもののうち、プライバシー影響が大きいのは **`issue-shortcut:offline-queue`（未送信 Issue の本文を平文で保持）** と **`issue-shortcut:draft`（下書き本文）**。共有端末でアカウント削除した場合、次の利用者に前利用者の未送信内容が見える。
   - 一方で「削除ボタンで下書きまで消える」のはミッション（入力内容の保全を最優先）と衝突しうるため、**削除範囲の拡張か文言の修正か** は要判断（下書き・キューは「破棄しますか？」の確認を伴う削除にするのが妥当）。
2. `#177`（SW の Background Sync が発火していない）は **保持の観点でも**「SW キューには何も入っていない」ことを意味する。オフライン再送は実質クライアント側（localStorage + ページが開いていること）に依存している。

---

## 10. 付随して確認した「保持していないもの」

- サーバー側のセッションレコード・ユーザーテーブル・Issue ログ・request_id テーブル（すべて廃止済み）
- GET API 応答の Cache Storage キャッシュ（設定なし）
- アナリティクス・計測ビーコンの類（コードベースに存在しない）
- `console.*` によるログ出力（アプリコードに存在しない）
- 動的 `manifest.webmanifest`（P1 で静的へ戻し、private リポジトリ名が URL に載る経路を消した）
