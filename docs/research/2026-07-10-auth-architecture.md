# リサーチ: GitHub 認証アーキテクチャ（2026-07-10 実施）

> 専門リサーチチーム（認証・セキュリティ班）による調査結果の要約。全て 2026-07-10 時点の一次情報で検証済み。

## 1. OAuth App vs GitHub App（結論: GitHub App）

- GitHub 公式は「一般に GitHub Apps が OAuth apps より推奨される（fine-grained permissions・リポジトリ単位のアクセス制御・短命トークン）」と明言。
  出典: <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps>
- Issue 作成 `POST /repos/{owner}/{repo}/issues` に必要な権限は **「Issues: write」のみ**（Metadata: read は自動付与）。GitHub App user access token / installation token / fine-grained PAT で動作。
  出典: <https://docs.github.com/en/rest/issues/issues#create-an-issue>
- OAuth App の classic scope では `public_repo`（公開のみ）/ `repo`（私有含む・**コード全アクセス** という過剰権限）になる。
  出典: <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps>
- **重要トレードオフ**: GitHub App の user token は「App がインストールされたリポジトリ ∩ ユーザーがアクセスできるリポジトリ」にしか届かない（authorization と installation は別物）。任意の公開リポジトリへの起票が要件なら OAuth App の `public_repo` が必要。
  出典: <https://docs.github.com/en/apps/using-github-apps/authorizing-github-apps>

## 2. トークン仕様（GitHub App user access token）

- アクセストークン: **8 時間**（`expires_in: 28800`・prefix `ghu_`）。リフレッシュトークン: **6 ヶ月**（prefix `ghr_`）。
- **リフレッシュトークンは単回使用（ローテーション）**。並行リフレッシュは競合して失効する → リフレッシュ処理の直列化が必要（ユーザー単位の Durable Object が自然なロック）。
- トークン失効はアプリ設定でオプトアウト可能だが非推奨（将来必須化の示唆あり）。
  出典: <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens>

## 3. OAuth フローのセキュリティ（RFC 9700 準拠）

- **GitHub は 2025-07-14 に PKCE 対応**（S256 のみ・OAuth App / GitHub App 両対応・強制ではない）。`state` と PKCE の **併用** が推奨（RFC 9700: PKCE 未確認の AS には state 必須）。
  出典: <https://github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication/> / <https://datatracker.ietf.org/doc/html/rfc9700>
- Cookie 設計: セッション Cookie は `__Host-` prefix + `HttpOnly; Secure; Path=/; SameSite=Lax`。**`SameSite=Strict` は OAuth コールバック（cross-site top-level GET）で Cookie が送られず state 検証が壊れる** ため `Lax` にする。pre-auth Cookie（state + code_verifier 保持・10 分 TTL）も同様。
  出典: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie> / <https://github.com/oauth2-proxy/oauth2-proxy/issues/1663>
- セッション: 128bit 以上のランダム ID を発行し **サーバー側にはハッシュのみ保存**（Copenhagen Book / OWASP / cloudflare/workers-oauth-provider と同じ思想）。
  出典: <https://thecopenhagenbook.com/sessions> / <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
- トークンの保管: Cloudflare KV は暗号化済みだがアカウント権限で平文が見えるため、**アプリケーション層で AES-256-GCM（WebCrypto）暗号化**（マスターキーは Worker Secret・IV は毎回ランダム 96bit）。
  出典: <https://developers.cloudflare.com/workers/configuration/secrets/> / <https://github.com/cloudflare/workers-oauth-provider>

## 4. モバイル PWA での OAuth フロー注意点

- **ポップアップ（`window.open`）は standalone PWA で壊れる**（`window.opener` null 等）→ **フルページリダイレクト一択**。
  出典: <https://github.com/IdentityModel/oidc-client-js/issues/684> / <https://auth0.com/docs/libraries/lock/lock-authentication-modes>
- Android Chrome では、standalone PWA からの cross-origin 遷移は in-app browser（CCT 相当）で開き、**manifest scope 内の URL に戻ると自動で閉じて PWA 本体がコールバック URL へ遷移する**（公式ドキュメント記載の挙動）。WebAPK は Chrome とクッキー共有なので GitHub ログイン状態も引き継がれる。
  出典: <https://web.dev/learn/pwa/windows/> / <https://web.dev/articles/webapks>
- 対策 3 点: ①コールバック URL を manifest `scope` 内に置く ② pending state は sessionStorage でなく Cookie に保存 ③ **Service Worker のナビゲーションフォールバックから `/auth/*` を除外**（SW がコールバックをキャッシュ応答して認証が壊れる既知問題）。
  出典: <https://github.com/w3c/ServiceWorker/issues/1226> / <https://firebase.google.com/docs/auth/web/redirect-best-practices>
- `github.com/login/oauth/access_token` は CORS 非対応 → **トークン交換はサーバー側（Worker）必須**。純フロントエンドのみでは実装できない。
  出典: <https://github.com/isaacs/github/issues/330>

## 5. ライブラリ選定（Workers + Hono 前提）

| 候補 | 状況（2026-07） | 評価 |
|------|----------------|------|
| 手書き fetch + `hono/cookie`（署名 Cookie） | 常緑 | ◎ 依存ゼロ・~100 行。Simon Willison 例・gr2m 例あり |
| arctic 3.7.0 | 2025-05 以降休眠（安定） | ○ fetch ベース・GitHub App refresh 対応 |
| @octokit/auth-oauth-user 6.0.2 | Octokit org 活発 | ◎ 期限付き user token の **自動リフレッシュ** を唯一ネイティブにモデル化 |
| @hono/oauth-providers 0.8.5 | monorepo 活発 | ○ ログインフローのみ・GitHub 用 refresh ヘルパーなし |
| better-auth 1.6.23 | 非常に活発 | △ フル機能だが最重量・Workers で CPU/バンドル注意 |
| openauth 0.4.3 | 2025-04 以降休眠 | × 新規採用非推奨 |

出典: <https://til.simonwillison.net/cloudflare/workers-github-oauth> / <https://github.com/octokit/auth-oauth-user.js> / <https://github.com/honojs/middleware/tree/main/packages/oauth-providers>

## 6. GitHub API 制約（Issue 作成）

- `POST /repos/{owner}/{repo}/issues`: pull アクセスがあれば誰でも作成可。Issues 無効リポジトリは 410。
- **labels / assignees / milestone / type は push アクセスがないと「silently dropped」**（201 は返るが反映されない）→ UI 側で権限に応じた表示制御が必要。
- レート制限: user token 5,000 req/h。**二次制限: コンテンツ生成系 80 req/min・500 req/h**。Issue 作成は通知トリガーなので連続作成は注意。422 は spam 判定含む（盲目リトライ禁止）。
- 冪等性キーなし → タイムアウト時の再送は重複起票リスク。自前の重複防止（直近送信内容の記録）が必要。
- **API バージョン `2026-03-10` で単数 `assignee` パラメータ廃止** → 新規実装は `X-GitHub-Api-Version: 2026-03-10` を pin し `assignees` 配列を使う。
  出典: <https://docs.github.com/en/rest/issues/issues#create-an-issue> / <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api> / <https://docs.github.com/en/rest/about-the-rest-api/breaking-changes?apiVersion=2026-03-10>
- api.github.com は CORS 全開放（`Access-Control-Allow-Origin: *`）。
  出典: <https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests>

## 7. 推奨アーキテクチャ（認証編）

1. **GitHub App**（permissions: Issues=write）+ user access token（有効期限 ON のまま）
2. 認可フロー: フルページリダイレクト + `state` + PKCE S256。pre-auth 値は sealed cookie（`__Host-`/`HttpOnly`/`Secure`/`Lax`・10 分）
3. トークン交換・保管はサーバー側（Worker）。セッション ID Cookie（`__Host-`）+ サーバー側ストレージ（ハッシュ化 ID・AES-256-GCM 暗号化トークン）
4. リフレッシュはユーザー単位で直列化（単回使用ローテーション対策）
5. 「App 未インストールのリポジトリに起票できない」制約は、初回オンボーディングで App インストールへ誘導する UX で吸収する
