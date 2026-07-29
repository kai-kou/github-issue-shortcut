<!-- discussion_whiteboard:auto -->
# 🧑‍🏫 議論ホワイトボード: リポジトリ全体のセキュリティ・リスク管理レビュー（敵対的多観点）

- 議題ID: `security-risk-review-20260729`
- 論点: Cloudflare Workers + React PWA（GitHub Issue 起票アプリ）のセキュリティ・リスク管理を 5 レンズで敵対的にレビューする。一般公開準備中・リポジトリ public・サーバー永続層ゼロ（トークンは暗号化 Cookie）。実害のあるリスクのみ critical にする。
- 参加者: `authn_token`, `web_appsec`, `secrets_supplychain`, `privacy_data`, `ops_risk`
- 投稿数: 12
- 更新: 2026-07-29T09:52:07+09:00

> このファイルは `tools/discussion_whiteboard.py render` が自動生成する。直接編集せず `post` で追記すること（同時書き込み破損防止）。

## ラウンド 1

### `authn_token` — 主張
<sub>2026-07-29T09:42:12+09:00</sub>

### [medium] TOKEN_ENCRYPTION_KEY を AES-GCM 鍵と HMAC 鍵の両方に無分離で使い回している
- 該当: `worker/crypto.ts:53`（`hmacSha256Base64url`）/ `worker/crypto.ts:75-80`（`importAesKey`）/ `worker/tokenCookie.ts:94-95`（`sealTokenBundle` が `env.TOKEN_ENCRYPTION_KEY` で AES-GCM 封入）/ `worker/index.ts:184`（`rateLimitKey`）・`worker/index.ts:206`（`duplicateSubmissionKey`）が同じ `env.TOKEN_ENCRYPTION_KEY` を HMAC 鍵として使用
- 問題: 同一の生鍵バイト列を「トークン Cookie / preauth Cookie の AES-256-GCM 暗号鍵」と「レート制限キー・連投抑止キーの HMAC-SHA256 鍵」という異なる用途・異なる暗号アルゴリズムに無分離で使い回している。HKDF 等によるドメイン分離（用途ごとのサブキー導出）が行われていない。
- 攻撃/失敗シナリオ: 現時点で悪用可能な具体的な鍵復元経路は確認できないが、暗号衛生の原則（NIST SP 800-108 等が推奨する鍵分離）に反する。将来 AES-GCM 側・HMAC 側のどちらか一方の実装/運用に問題（例: IV 生成系の劣化、GCM 実装差し替え時の想定外の鍵スケジュール共有）が生じた場合に、影響範囲が「トークン Cookie の機密性」と「レート制限キーの完全性」の両方に及ぶブラストラジアス拡大リスクがある。鍵ローテーション（`TOKEN_KEY_VERSION`）も暗号化側のみを想定しており、HMAC 用途との用途混在が鍵ローテーション設計をわかりにくくしている。
- 推奨対応: `TOKEN_ENCRYPTION_KEY` から HKDF（`crypto.subtle` の `"HKDF"` 等）で `enc-key`（AES-GCM 用）と `hmac-key`（レート制限キー用）を別導出し、用途ごとに独立した鍵にする。

---

## 所見サマリー
- state パラメータ比較（`worker/index.ts:295` `pre.state !== stateParam`）は非定数時間比較だが、state は 128bit のランダム値かつ preauth Cookie（AEAD 認証済み・10 分 TTL）に閉じ込められているため、リモートタイミング攻撃での総当たりは非現実的と判断し、指摘としては見送った（確認して問題なし）。
- AES-GCM の nonce/IV（`worker/crypto.ts:124` `crypto.getRandomValues(new Uint8Array(12))`）は呼び出しごとに CSPRNG で新規生成されており、再利用は確認できなかった（確認して問題なし）。鍵バージョンも AAD として認証対象に含まれており、バージョンバイトだけの改ざんは検出される。
- OAuth の state 生成・検証、PKCE（S256）、redirect_uri の固定（Origin ベースで動的に組み立てるが GitHub 側の登録 callback URL 照合に依存）、トークン Cookie の属性（`__Host-` プレフィックス要件・HttpOnly・Secure・SameSite=Lax・絶対期限 `x` がリフレッシュで延長されない設計）、ログアウト・アカウント削除時の GitHub 側トークン失効（`revokeAccessToken`）、状態変更エンドポイント（`/auth/refresh`・`/api/issues`・`/auth/logout`・`/api/account`）への Origin ベース CSRF チェックはいずれも確認して問題なし。
- 秘密情報（access/refresh token・暗号鍵）を `console.*` へ出力している箇所は worker/src 双方で見つからなかった（確認して問題なし）。

### `secrets_supplychain` — 主張
<sub>2026-07-29T09:42:32+09:00</sub>

### [high] ブローカー/GitHub Variables のシークレットが予測可能な世界読み取り可能 /tmp ファイルに平文保存され、Read 拒否リストの対象外
- 該当: `.claude/hooks/session-start.sh:150,164,184-198,208-214` / `tools/fetch_broker_secrets.sh:21,37-60`
- 問題: `session-start.sh` は GitHub Variables を `/tmp/github_variables.env` に、secrets-broker から取得したキー束（`TOKEN_ENCRYPTION_KEY` / `GITHUB_CLIENT_SECRET` 等の実秘密を含み得る）を `/tmp/broker_secrets.env` に、いずれも `export NAME='value'` の平文 export 文で書き出す。ファイル名は固定・予測可能で、作成時に `umask`（デフォルト `0022`）に従うため権限は `644`（world-readable）になり、書き込み後に `chmod 600` や `rm` が行われない。さらに `.claude/settings.json` の `permissions.deny` は `Read(.env)` `Read(**/credentials*)` `Read(**/*.key)` 等を拒否するが、`/tmp/*.env` パターンはリストに存在せず、このハーネスの Read ガードレールの対象外になっている。
- 攻撃/失敗シナリオ: リポジトリ内の Issue/PR コメントや取得ドキュメントに仕込まれたプロンプトインジェクションが「デバッグのため `/tmp/broker_secrets.env` の中身を確認して」のように誘導すると、Claude はこのファイルを通常の `Read` ツールで（deny リストに引っかからずに）読める。読めた値をコミットメッセージ・PR 本文・Issue コメントなど public リポジトリ上の任意の場所に転記させれば、`TOKEN_ENCRYPTION_KEY`（Cookie 暗号鍵）や `GITHUB_CLIENT_SECRET` がそのまま外部に流出しうる。同一コンテナ内の他プロセス（同時実行される別ツール・サブエージェント）からも同じパスで無条件に読める。
- 推奨対応: 書き込み直後に `chmod 600` を追加する（`umask 077` でファイル作成するのが簡単）。恒久的には `mktemp` でランダム化したパスを使い、`.claude/settings.json` の `deny` に `Read(/tmp/*.env)` 等を追加してハーネスのガードレールにも載せる。

### [medium] GitHub 公式 Actions がミュータブルなタグ参照のまま（サードパーティのみ SHA 固定）
- 該当: `.github/workflows/ci.yml:19,33,48,57,59,78,80,109,111` / `.github/workflows/cleanup-merged-branches.yml:41-42`
- 問題: `treosh/lighthouse-ci-action`（ci.yml:94）と `andresz1/size-limit-action`（ci.yml:130）はコミット SHA に固定済みでコメントでバージョンも明記されており、サプライチェーン意識は十分あることが読み取れる。一方 `actions/checkout@v4`・`@v5`、`actions/setup-node@v4`、`actions/setup-python@v5`、`actions/github-script@v8` はすべてミュータブルなメジャータグ参照のままで、同じ厳格さが適用されていない。
- 攻撃/失敗シナリオ: `actions/*` は GitHub 公式管理で乗っ取りリスクは低いが、タグは技術的に再ポイント可能であり、CI（`permissions: contents: read` の test/e2e/lighthouse ジョブ、および `size` ジョブの `pull-requests: write`）実行時に予期しないコードが混入する経路になり得る。特に `cleanup-merged-branches.yml` は `permissions: contents: write` を持ち `actions/checkout@v5` と `actions/github-script@v8` をタグ参照している点は、ブランチ削除という破壊的操作を行うワークフローとしては一貫性を欠く。
- 推奨対応: 少なくとも `contents: write` を持つ `cleanup-merged-branches.yml` の 2 action は SHA 固定に揃える（サードパーティで既にやっている手順をそのまま流用できる）。`ci.yml` 側は許容範囲内だが、Dependabot 等でタグ更新を追跡する運用なら SHA 固定でも保守コストは増えない。

### 所見サマリー
- **確認して問題なし**: `wrangler.jsonc` の `vars`（`GITHUB_CLIENT_ID`・`TOKEN_KEY_VERSION`）と Workers Secrets（`.dev.vars.example` に列挙の `GITHUB_CLIENT_SECRET` / `TOKEN_ENCRYPTION_KEY`）の使い分けはコメントの説明通り正しい（公開値のみ vars）。`.gitignore` / `.gitguardian.yaml` は妥当（ダミー鍵のみ ignore・実秘密は除外対象に含めていない）。`git log --all` を全履歴・全ブランチ走査したが実秘密のパターン（AWS キー・GitHub PAT・Slack トークン実値・秘密鍵ブロック）は検出されず、ヒットしたのは `xoxb-xxxxx-xxxxx-xxxxx` 等のプレースホルダのみ。
- **確認して問題なし**: `tools/gh_shim.py` は 403 時のエラーメッセージのみを中継し、`fetch_broker_secrets.sh` の「loaded N secret(s)」ログも値を出力しない（P-12 準拠）。`tools/mask_secrets.py` のセンシティブ判定・マスク実装も妥当。`tools/github_push_helper.py` は `GH_TOKEN`/`GITHUB_TOKEN` をヘッダーにのみ使用しログに出さない。hooks・tools 全体を `eval` / `os.system` / `subprocess(shell=True)` / `curl|bash` パターンで grep したが危険な動的コード実行は見つからなかった（`tools/scan_dangerous_patterns.py` 自体がこの種のパターンを機械検出するツールとして既に存在する）。
- `permission-request-auto-allow.sh` が `.claude/settings.json`/`settings.local.json` 自体を auto-allow の対象から明示的に除外しているのは適切な自己書き換え防止だが、上記の `/tmp/*.env` ギャップは同種の設計思想を徹底しきれていない箇所として残っている。

### `web_appsec` — 主張
<sub>2026-07-29T09:43:36+09:00</sub>

### [high] `repo` パラメータ未検証によるバックエンド GitHub API リクエストのパス/フラグメント注入
- 該当: `worker/index.ts:413-419`（GET /api/labels）, `worker/index.ts:454-463,492-493`（POST /api/issues）, `worker/github.ts:252`（createIssue）, `worker/github.ts:348`（fetchRepoLabels）
- 問題: `repo`（body の `repo` / query の `repo`）は `.trim()` のみで `owner/repo` 形式のフォーマット検証が一切ない。`worker/github.ts:252` の `fetch(\`${apiBase}/repos/${repoFullName}/issues\`, ...)` はテンプレートリテラルで組み立てた文字列をそのまま `fetch()` に渡しており、WHATWG URL パーサーが `..` セグメントの正規化と `#` によるフラグメント切り出しを行うため、`repoFullName` に `../` や `#` を含めると生成される実際のリクエストパスを任意に変えられる。
- 攻撃/失敗シナリオ: ログイン済みユーザーが `POST /api/issues` へ `{"repo": "../orgs/some-org/repos#", "title": "x"}` を送信すると、`https://api.github.com/repos/../orgs/some-org/repos#/issues` が生成され、URL 正規化後の実リクエストは `POST https://api.github.com/orgs/some-org/repos`（ボディは `{title,body,labels}`）になる。すなわち「Issue 作成」エンドポイントのはずが、ユーザー自身の OAuth トークンを使って `api.github.com` 配下の任意パス・任意 HTTP メソッド固定（POST or GET）のエンドポイントを叩けてしまう。UI が保証しているつもりの「App インストール済み ∩ push 権限あり」の allow-list（`/api/repos` の結果）を完全に迂回でき、GET 版（`fetchRepoLabels`）でも同様に任意 GET パスへリダイレクトできる。トークンは本人のものなので越権にはならないが、意図しないエンドポイント（例: リポジトリ作成・招待系 API）を「Issue 起票」の体で実行させられる設計上の穴であり、CLAUDE.md が明示する「owner/repo などパス・クエリのバリデーション」に該当する典型的な入力検証欠如。
- 推奨対応: `worker/index.ts` の POST /api/issues・GET /api/labels 両方で `repo` を `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$` 相当の owner/repo フォーマットに一致させ、不一致は 400 で弾く（`ISSUE_TITLE_MAX_LENGTH` 等と同じ場所に追加できる軽い変更）。

### [medium] prefillParams 経由のワンタップ起票が任意 repo・任意内容を装える
- 該当: `src/repos/RepoPicker.tsx:73,153-162,263-275`（`selected` が `prefill.repo` から無検証で反映され、`selectedPushAccess` が false でも送信自体はブロックされない）, `src/issues/prefillParams.ts:29-37`
- 問題: `/new?repo=&title=&labels=&body=` は URL 由来の値をそのまま「初期選択」に使う設計（FR-19 により自動送信はしない）だが、`repo` は `/api/repos` の一覧照合なしに `selected` へセットされ、フォームは提出可能なままになる（`pushAccess=false` でもラベル欄が警告表示になるだけで送信ボタンは無効化されない）。
- 攻撃/失敗シナリオ: 攻撃者が `https://<app>/new?repo=victim-org/target-repo&title=%E7%B7%8A%E6%80%A5%EF%BC%9A...&labels=security` のようなリンクを作り、ログイン中の被害者（`target-repo` への push 権限を持つ）に踏ませる。被害者は起票シートが自動的に開いた状態で「対象リポジトリ: victim-org/target-repo」と表示された画面をよく確認せずタイトル欄が埋まっているのを見て送信ボタンを押すだけで、攻撃者が指定した内容の Issue が被害者のアカウントで `target-repo` に作成される（アカウント名の詐称・スパム・評判毀損に使える one-tap ソーシャルエンジニアリング）。
- 推奨対応: 現状の「repo 名を明示表示 + 手動送信必須」は最低限の緩和になっているため必須修正ではないが、`initiallyOpen`/自動オープン時に「URL から事前入力されました」という出典表示を Issue フォーム内に追加すると悪用コストが上がる（規模不相応な対策は不要、UI 文言レベルの改善で足りる）。

### [medium] CSP・セキュリティヘッダ類が未設定
- 該当: `index.html`（`<head>` に CSP meta タグなし）, `worker/index.ts` 全体（レスポンスヘッダを付与する共通ミドルウェアなし）, リポジトリ内に `_headers` ファイルなし
- 問題: `Content-Security-Policy` / `X-Content-Type-Options` / `X-Frame-Options`（または `frame-ancestors`）/ `Referrer-Policy` のいずれも設定されていない。React のみで DOM 操作しているため XSS の実弾は見つからなかったが（後述）、CSP は多層防御として将来の回帰（依存ライブラリ経由の DOM XSS 等）に対する最後の砦になる。
- 攻撃/失敗シナリオ: 将来 XSS が別の脆弱性（依存パッケージ等）経由で混入した場合、CSP が無いため任意スクリプト実行を緩和する層が存在しない。また `X-Frame-Options`/`frame-ancestors` が無いため、OAuth ログインボタン（`/auth/login` への `<a>`）を含む画面が iframe に埋め込み可能で、クリックジャンキングの理論上の余地がある（ただし本アプリは GET 遷移のみで状態変更を伴わないボタンが中心のため実害は限定的）。
- 推奨対応: Hono の `app.use()` で `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'` 相当と `X-Content-Type-Options: nosniff` を全レスポンスへ付与する軽量ミドルウェアを追加する（有償 WAF 等は不要、コード数行で足りる）。

### 確認して問題なし
- **XSS**: `src` 配下に `dangerouslySetInnerHTML` は 1 件もなし（grep 済み）。`HighlightedTextInput.tsx` はトークンハイライトも通常の JSX テキストノードで描画しており、`prefillParams`（title/body/labels）由来の値も含め常に React のエスケープを経由する。安全。
- **CSRF**: `POST /auth/refresh` `/api/issues` `/auth/logout` `DELETE /api/account` はすべて `requireSameOrigin`（`worker/index.ts:137-143`）でチェック済みに加え、トークン Cookie は `__Host-` プレフィックス + `HttpOnly` + `Secure` + `SameSite=Lax`（`worker/tokenCookie.ts:39`）。多層防御として妥当。
- **CORS**: Worker 側に `Access-Control-Allow-Origin` 等を付与するミドルウェアが存在せず、フロントも `credentials: "same-origin"`（`src/auth/apiFetch.ts:16`）のみで呼んでいる。クロスオリジンからの Cookie 付き呼び出しを許可する設定は見当たらず問題なし。
- **オープンリダイレクト**: `parseLaunchTargetUrl`（`src/issues/prefillParams.ts:46-54`）は `url.origin !== origin` で弾いており同一オリジン外への遷移を許さない。`consumePendingRedirect` が返す値も常に `window.location` 由来の相対パスのみで外部 URL を持ち込まない。OAuth `redirect_uri` はリクエスト自身の Origin から動的生成（`worker/index.ts:90-97`）だが GitHub 側の登録 URL 照合に依存しており、CF Workers のホスト解決はクライアント指定の Host ヘッダーで偽装できないため実害は確認できず。
- **Service Worker**: `vite.config.ts:127` の `navigateFallbackDenylist` が `/auth`・`/setup`・`/api` を precache/フォールバック対象から明示的に除外しており、OAuth コールバックや API 応答が古いキャッシュに汚染される経路は塞がれている。

## 所見サマリー
最重要は `repo` の未検証によるバックエンド fetch のパス/フラグメント注入（GitHub API への任意エンドポイント誘導）で、`owner/repo` の正規表現バリデーションを worker 側に追加するだけで閉じられる軽微な修正。CSRF/XSS/CORS/オープンリダイレクト/SW キャッシュ汚染は設計がよく効いており具体的な突破口は見つからなかった。prefillParams 経由の一発起票とセキュリティヘッダ未設定は多層防御レベルの改善として提示するにとどめる。

### `privacy_data` — 主張
<sub>2026-07-29T09:43:44+09:00</sub>

### [medium] Cloudflare edge/network-level アクセスログ（IP アドレス）が「サーバーは個人データを保存しない」の対象範囲から漏れている
- 該当: `docs/design/stateless-architecture.md:145-162`（「保持ゼロ」を名乗るための付帯設定）/ `src/i18n/translations.ts:395-398`（ja §5）/ `src/i18n/translations.ts:654-657`（en §5）
- 問題: ポリシー §5「サーバー基盤に残る記録」は `wrangler.jsonc` の `observability`（Workers Logs = invocation log 無効・例外のみ 5% サンプリング・保持 3 日）だけを根拠に「サーバーは個人データを保存しない」と言い切っている。しかし Cloudflare は CDN/エッジとして、アプリの `observability` 設定とは独立に接続元 IP アドレス等を含む標準アクセス解析（HTTP Analytics / セキュリティイベントログ）を基盤側で保持するのが通常運用であり（Free プランでもオフにできない）、これはアプリのコードや `wrangler.jsonc` からは一切制御できない。ポリシーはこの層に触れておらず、「基盤に残るのはエラー記録だけ」という記述は実態より狭い。
- 攻撃/失敗シナリオ: 利用者がポリシーを読んで「Cloudflare 側にも一切個人データ（IP アドレス含む）が残らない」と誤解した状態で、開示請求や苦情対応の場面になったとき、実際には Cloudflare 側にアクセス元 IP のログが一定期間残っている（＝説明した保持期間・範囲と食い違う）。個人開発 OSS としては DPA 締結や詳細開示までは不要だが、「基盤側の記録」の説明が Workers Logs だけに限定されている点は是正余地がある。
- 推奨対応: §5 に「Cloudflare のネットワーク層でも、通信の性質上、接続元 IP アドレス等が短期間記録される場合があります（Cloudflare のプライバシーポリシーに従う）」の 1 文を追記し、「アプリが明示的に設定するログ」と「基盤が標準で持つログ」を分けて説明する。

### [medium] 利用規約が「アカウント利用制限」を約束しているが、ステートレス構成にはその実装手段が無い
- 該当: `src/i18n/translations.ts:338`（ja: 「禁止行為が確認された場合、予告なく該当アカウントの利用を制限することがあります」）/ `src/i18n/translations.ts:597`（en 同内容）
- 問題: `docs/design/stateless-architecture.md` の方針どおり、サーバーに D1/KV/R2/DO のいずれも無く、`worker/index.ts` にもユーザーごとの禁止リスト・ban フラグを保持する仕組みは存在しない（`ISSUE_RATE_LIMIT` は 60 秒窓の自動失効カウンタのみで、恒久的な利用制限機構ではない）。つまり ToS が明言する「該当アカウントの利用を制限する」という運用上のアクションを、技術的に実行する手段がアプリ内に無い。
- 攻撃/失敗シナリオ: スパム的な連続起票をする利用者が現れた場合、開発者が ToS を根拠に「アカウントの利用を制限」しようとしても、対象ユーザーだけを狙って API アクセスを止める仕組みがない（GitHub 側で App の連携を強制解除する運用が必要だが、それは GitHub 側の操作であり ToS にはその方法が書かれていない）。利用者から見ると「制限された」という説明可能性のない曖昧な約束になっており、実害が出るとすれば「開発者が対応すると期待したのに技術的に対応できない」という運用ギャップ。
- 推奨対応: 「アカウントの利用を制限」という表現を、実際に取りうる手段（GitHub App の連携解除・レート制限の継続適用）に即した文言へ具体化するか、削除する。

### [medium] プライバシーポリシー §3「利用目的」が §2 で説明する不正利用対策（内容ハッシュ処理）を目的として明記していない
- 該当: `src/i18n/translations.ts:388`（ja §3 利用目的）/ `src/i18n/translations.ts:647`（en 同内容）。対比先: `src/i18n/translations.ts:379`（ja §2、連投抑止カウンタの説明）/ `:638`（en 同内容）。実装側は `worker/index.ts:183-207`（`rateLimitKey` / `duplicateSubmissionKey`）
- 問題: §2 は「ユーザー ID のハッシュ」「送信内容と GitHub のユーザー ID から作った復元不能な鍵」をサーバー側で一時的に扱うと明記しているが、これは §3「本アプリへのログイン維持、Issue 起票の実行、ショートカット機能の提供のためにのみデータを利用します」に列挙された 3 目的のいずれにも該当しない（不正利用対策・レート制限という第 4 の処理目的が抜けている）。「のみ」という限定表現と矛盾する。
- 攻撃/失敗シナリオ: 個人情報保護の観点で利用目的の通知・公表を厳密に求められた場合、「不正利用対策のためにユーザー ID・送信内容由来のハッシュを処理する」という目的が §3 に列挙されていないため、§2 の実装説明と §3 の目的限定が食い違う。実害は小さいが、文言上の矛盾は監査・問い合わせ対応で指摘されうる。
- 推奨対応: §3 に「不正利用防止（レート制限・連投抑止）のため」の 1 項目を追加する。

### 確認して問題なし
- **アカウント削除の削除範囲とポリシー文言の整合**: `src/auth/AccountDeletion.tsx:27` は `clearAllLocalUserData()`（`src/auth/useAuthState.ts:73-82`）を呼び、下書き（`draft.ts`）・オフラインキュー（`offlineQueue.ts`）・送信済み予約（IndexedDB `sentRequestIds.ts`）まで含めて全消去する。`src/i18n/translations.ts:198`（confirmMessage）・`:406`（privacy §6）・`:457`（en confirmMessage）・`:665`（en privacy §6）の文言と実装が一致している（既知の research doc `docs/research/2026-07-28-data-retention-inventory.md` §9 が指摘していた不一致は #181 で解消済み。**同 research doc はその後の #179/#181/#193 の変更を反映しておらず現状より古い記述が残っている点に注意** — 他ラウンドがこの doc を根拠にすると誤判定しうる）。
- **ログアウトが下書き/オフラインキューを消さない設計** と、その旨をポリシー本文（ja/en §6）が明示している点は一致（`useAuthState.ts:172-180` の `logout()` は `clearAllUserCaches()` のみ呼び、`draft`/`offline-queue`/`sent-request-ids` は残す）。
- **サーバーログへの `console.*` 出力**: `src/`・`worker/` 全体を grep して該当ゼロ。ポリシー §5 の「アプリコードに console.* は無い」という記述と一致。
- **レート制限・連投抑止キーの仮名化**: `worker/index.ts:183-207` はいずれも `HMAC-SHA256(TOKEN_ENCRYPTION_KEY, ...)` を用い、ユーザー ID・Issue 内容そのものを Cloudflare 側のカウンタに渡していない。「ユーザー ID そのものは渡さない」というポリシー §2 の主張と一致。
- **localStorage の userId 紐付けによる別ユーザー混入防止**: `authCache.ts` / `reposCache.ts` / `shortcutsStore.ts` はいずれも `userId` 不一致時に空値へ倒しており、共有端末での前ユーザーデータ露出を防いでいる。
- **越境移転の開示**: `stateless-architecture.md` のとおりサーバーに永続データが無いため「保管」は発生しないが、処理経路が国外設備を経由しうる旨をポリシー §2（ja `:382`/en `:641`）が明記しており、実装（Cloudflare Workers・グローバルエッジ）と整合している。

## 所見サマリー
致命的な「ポリシー文言 vs 実装」の不一致は見当たらなかった（研究資料が指摘していたアカウント削除の削除範囲不一致は #181 で既に解消済み）。残る 3 件は法務文言の精度・範囲の甘さに起因する medium 指摘（Cloudflare 基盤層の IP ログ非開示、ToS の「アカウント制限」約束と実装手段の不在、利用目的リストの欠落）で、いずれも公開規模の個人開発 OSS として対応可能な文言修正レベル。

### `ops_risk` — 主張
<sub>2026-07-29T09:44:50+09:00</sub>

### [medium] 未認証エンドポイントにレート制限が一切なく、コスト/DoS 検知の裏付けもない
- 該当: `worker/index.ts:209`（`GET /api/health`）/ `worker/index.ts:214-239`（`GET /api/ready`）/ `worker/index.ts:242-268`（`GET /auth/login`）/ `worker/index.ts:272-329`（`GET /auth/callback`）
- 問題: `wrangler.jsonc` の Rate Limiting binding（`ISSUE_RATE_LIMIT` 等）は `POST /api/issues` にしか適用されず、認証前に叩ける上記 4 エンドポイントには一切のスロットリングがない。`/auth/login` は毎回 `sealVersioned`（AES-256-GCM 暗号化 + CSPRNG）を実行して Set-Cookie する処理で、匿名かつ無制限に呼べる。Cloudflare 自体の DDoS 保護はネットワーク層の保護であり、この種の「正規リクエストの形をした高頻度アプリケーションコールで CPU 時間とリクエスト数を消費させる」パターンを止めるものではない。
- 攻撃/失敗シナリオ: 攻撃者が `curl` ループで `GET /auth/login` を秒間数十〜数百回叩くと、Worker は毎回鍵導入 + AES-GCM 暗号化を実行し GitHub 認可 URL への 302 を返し続ける。無料プランのリクエスト数上限に達すると `docs/research/2026-07-27-public-release-risk-cost.md:78` が明記する通り「上限に当たると止まる」設計のため、**その日は正規利用者も含めて全員が起票できなくなる**（サービス停止）。同ドキュメントの R6（予算アラート未設定）・R10（可用性監視・エラー率アラート未設定）は 2026-07-27 時点で自己指摘済みだが、`wrangler.jsonc` にも `.github/workflows/` にもアラート設定を裏付けるものが見当たらず、解消済みか確認できない。
- 推奨対応: Cloudflare 側（無料）の WAF Rate Limiting Rule を `/auth/*` `/api/health` `/api/ready` に追加する、または最小変更として `/auth/login` にも軽量な IP/UA ベースの Rate Limiting binding を足す。あわせて Cloudflare の使用量アラート（Notifications）が実際に設定済みか確認し、未設定なら R6 を優先的に消化する。

### [medium] 鍵ローテーションの実行手順（runbook）が文書化されておらず、デプロイ手順に起因する中間状態のリスクがある
- 該当: `SECURITY.md`（インシデント対応の記載なし・報告経路のみ）/ `wrangler.jsonc:6-13`（`GITHUB_CLIENT_ID`/`TOKEN_KEY_VERSION` は git 管理の `vars`、`GITHUB_CLIENT_SECRET`/`TOKEN_ENCRYPTION_KEY` は Workers Secrets とコメントに明記）/ `docs/design/stateless-architecture.md:76-77`（鍵バージョンの仕組みは設計として存在）
- 問題: `TOKEN_KEY_VERSION` は Git 連携の Cloudflare Workers Builds が `main` への push で自動デプロイする一方、`TOKEN_ENCRYPTION_KEY`（Workers Secret）は git 管理外でダッシュボード/`wrangler secret put` の手動操作が必要。この 2 つを **どちらを先に更新するか** の運用手順がどこにも書かれていない。`worker/crypto.ts:119-134`（`sealVersioned`）はその時点で読める `TOKEN_KEY_VERSION`（新）と `TOKEN_ENCRYPTION_KEY`（まだ旧のまま）の組み合わせで新規ログインの Cookie を封入してしまうため、鍵更新前に `TOKEN_KEY_VERSION` だけ先に反映されるデプロイ順序だと、その間にログインした利用者の Cookie は「新バージョン番号 + 旧鍵」で封入され、後で鍵が新しい値に切り替わった瞬間に復号できなくなる（`worker/crypto.ts:141-155` の `openVersioned` は version 一致を前提に鍵を試すため、鍵不一致は GCM 認証失敗で無条件に開封失敗＝強制再ログイン）。
- 攻撃/失敗シナリオ: これは外部攻撃者が起こす脅威ではなく、`TOKEN_ENCRYPTION_KEY` 漏洩時に実際にローテーションを実行しようとした運用者が、正しい順序（Secret 更新 → 確認 → `TOKEN_KEY_VERSION` を上げてデプロイ）を知らずに逆順で実行してしまい、更新直前にログインした一部利用者だけが原因不明の再ログインを強いられる、という運用ミスのシナリオ。個人開発 OSS で実害は「強制再ログイン」に留まり致命的ではないが、公開直後で利用者数が増える局面かつ Claude Code の自律実行（本リポジトリの CLAUDE.md 前提）で `wrangler secret put` はアカウント権限が要る A-6 の手動ステップになるため、手順書がないと有事に迷う。
- 推奨対応: `SECURITY.md` か `docs/design/stateless-architecture.md` に「鍵漏洩時は ① Workers Secret を新しい値に更新 → ② デプロイ完了を `/api/ready` で確認 → ③ `TOKEN_KEY_VERSION` を +1 して push」という順序を 5 行程度で明記する。

## 所見サマリー
- `POST /api/issues` のレート制限キーは認証済みユーザー限定（`resolveTokens` が先に 401 で弾く）で、匿名の起票濫用は成立しない。ただし正規トークンを持つ利用者は GitHub API を直接叩けば本 Worker のレート制限を完全にバイパスできる構造であり、この上限は「本アプリ経由の連投」に対する軽い抑止にすぎない点は `wrangler.jsonc` のコメント（データセンター単位 best-effort・OQ-6）で運営者も認識済み。追加の指摘は見送るが公開後は実運用で再評価が要る（確認して問題あり・ただし対応不要と判断されている既知のトレードオフ）。
- CSRF（`requireSameOrigin`・`worker/index.ts:137-143`）は状態変更エンドポイント（`/auth/refresh`・`/api/issues`・`/auth/logout`・`/api/account`）すべてに適用されており、`SameSite=Lax` Cookie と組み合わせて妥当（確認して問題なし）。
- エラーハンドリング（`issueCreationErrorResponse` 含む全 `catch` ブロック）はいずれも内部例外のスタックトレースや `err.message` の生値をそのまま返さず、`jsonError` の固定文言または GitHub 自身のエラーメッセージ（機密情報を含まない）のみを返しており、情報量は適切（確認して問題なし）。Hono の `app.onError` は未定義だが、全ルートが個別 try/catch で握っているため未捕捉例外が生の内部情報を漏らす経路は見当たらない。
- `/api/ready` は設定不備（暗号鍵不正・レート制限バインディング未設定・E2E 緩和フラグの本番混入）を自己診断し 503 を返す設計で、`tools/smoke_prod.sh` が 6 時間おきに実プロダクションへ叩いている。これはフォーク/セルフホスト時の設定ミス検知にも有効な既存資産（確認して問題なし）。

## ラウンド 2

### `secrets_supplychain` — 反論
<sub>2026-07-29T09:47:24+09:00</sub>

### 自分の round1 [high]（/tmp シークレット平文・Read 拒否リスト対象外）への severity 補強 — 降格に反対
他レンズから直接の反証は無かったが、先回りして「実行可能性が低いのでは」という想定反論に答えておく。
- `.claude/settings.json` の `permissions.allow` には `mcp__github__add_issue_comment` / `create_pull_request` / `push_files` / `update_pull_request` が含まれ、`sandbox.network.allowedDomains` にも `github.com` / `api.github.com` が入っている。つまりプロンプトインジェクションが `/tmp/broker_secrets.env` を読ませた後の「持ち出し経路」は、サンドボックスのネットワーク許可リストや通常の承認フローを一切迂回する必要がない — public リポジトリへの Issue コメント・PR 本文・コミットという、このハーネスが毎セッション routine に実行する **正規の許可済みアクション** がそのまま exfiltration チャネルになる。ネットワーク allowlist は「意図しない外部送信」は防げても「意図された GitHub 書き込みに秘密値を混ぜる」は防げない設計になっている。
- したがって本指摘は「多層防御の一部が欠けている」ではなく「Read 拒否リストという唯一の技術的障壁が丸ごと存在しない」に近く、severity は high 据え置きが妥当と判断する（critical へは、実行にはまず repo 内容経由のプロンプトインジェクション成功という前提条件が要るため上げない）。

### `authn_token` の [medium] TOKEN_ENCRYPTION_KEY 使い回しへの補強（severity の文脈を追加）
- `authn_token` の指摘は「具体的な鍵復元経路は確認できない」という前提で medium に留めているが、この判断は暗号アルゴリズム内部からの漏洩のみを想定している。私の round1 [high] と接続すると、**鍵復元経路は暗号の外側（運用面）に既に存在する**: `TOKEN_ENCRYPTION_KEY` は secrets-broker 経由で取得されるキー束の一つであり、`tools/fetch_broker_secrets.sh` が `/tmp/broker_secrets.env` に平文で書き出す対象そのものである可能性が高い（ブローカーの目的が `.dev.vars.example` に列挙の Workers Secrets 群 = `GITHUB_CLIENT_SECRET` / `TOKEN_ENCRYPTION_KEY` を配布することだと `session-start.sh:203-217` のコメントから読み取れる）。
- つまり `authn_token` が「ブラストラジアス拡大リスク」として仮定的に述べていた「AES-GCM 側の鍵漏洩が HMAC 側（レート制限・連投抑止キー）にも及ぶ」という事態は、鍵導出の暗号弱点を待たずとも、私が指摘した `/tmp` 経由の一度の漏洩で即座に両方が同時に破られる、という具体的な経路がある。`authn_token` の medium 判定（鍵分離が無いこと自体の指摘）は妥当なまま据え置いてよいが、**両者を合わせて読むと「鍵分離していないことの実害」が机上の空論ではなく `/tmp` ギャップという実在する経路で顕在化する** ことを補足しておく。HKDF によるドメイン分離を推奨する `authn_token` の対応案は、私の推奨する `/tmp` ファイルの権限修正と独立に効く多層防御として両方採用する価値がある。

### `ops_risk` の [medium] 鍵ローテーション runbook 未文書化への同意（自レンズから確認・過大評価ではない）
- `wrangler.jsonc:9-13` の `TOKEN_KEY_VERSION` コメント（`+1 する。旧鍵で発行された Cookie は復号されず再ログインになるだけ`）を round1 で読んだが、これは「バージョンを上げる」ことの意味は説明していても「Secret 本体の更新とどちらを先にデプロイすべきか」の順序には触れていない。`ops_risk` の指摘通り、`GITHUB_CLIENT_ID`/`TOKEN_KEY_VERSION`（git 管理の `vars`、push で自動デプロイ）と `TOKEN_ENCRYPTION_KEY`（Workers Secret、手動更新が必要な A-6 相当操作）とでデプロイ経路が分離しているため、鍵ローテーション運用の抜け穴という指摘は自分のレンズ（Secrets/CI・Cloudflare Workers Secrets 運用）から見ても筋が通っており、過大評価ではない。severity は medium 据え置きが妥当。

### 所見サマリー（round2）
- 自分の round1 [high] は据え置きを主張する（許可済み GitHub 書き込みアクションが exfiltration チャネルになる点を根拠に追加）。
- `authn_token` の鍵使い回し medium は severity 変更を求めないが、`/tmp` シークレット漏洩という実在経路と組み合わせた際の実害を補足した。
- `ops_risk` の鍵ローテーション runbook 未文書化 medium は自レンズからも裏付けが取れ、過大評価ではないと判断。
- `web_appsec` / `privacy_data` の指摘は自レンズ（secrets/supply chain/CI/hooks）の管轄外のため、再読せずにコメントを見送る（誤検知の根拠を持たない領域で軽率に反論しない）。

### `privacy_data` — 反論
<sub>2026-07-29T09:47:34+09:00</sub>

## `secrets_supplychain` の [high]「/tmp シークレット平文露出」への reinforcement（プライバシーレンズからの格上げ根拠）

- 対象: `secrets_supplychain` round1 [high]「ブローカー/GitHub Variables のシークレットが予測可能な世界読み取り可能 /tmp ファイルに平文保存され、Read 拒否リストの対象外」
- 立場: **重大度は下げるべきではなく、むしろ据え置き（high）を支持する追加根拠を提示する**。指摘は開発/CI ハーネス層の話に見えるが、露出対象に含まれる `TOKEN_ENCRYPTION_KEY` は `worker/tokenCookie.ts` で全利用者の GitHub OAuth アクセストークン・リフレッシュトークンを暗号化する唯一の鍵であり、かつ `worker/index.ts:184,206`（`rateLimitKey`/`duplicateSubmissionKey`）の HMAC 鍵も兼ねている（`authn_token` round1 [medium] が指摘した鍵の無分離利用と直結）。
- 具体的なブラストラジアス: この鍵が `/tmp/broker_secrets.env` 経由で漏れると、①過去に傍受・ログ流出等で入手された `__Host-gh` Cookie 暗号文があれば復号可能になり、利用者本人になりすまして GitHub private リポジトリへの読み書きが可能になる（プライバシーポリシー §2 が「GitHub アクセストークンは暗号化 Cookie としてお使いの端末に保存」と説明している安全性の前提そのものが崩れる）、②レート制限・連投抑止のキー導出も偽装可能になる。単なる「開発環境のシークレット管理不備」ではなく、**「サーバーは個人データを保存しない」ポリシーの安全性根拠（暗号化）を無効化しうる鍵の漏洩** という点で、privacy_data レンズからも high 据え置きを支持する。
- `secrets_supplychain` の記述自体はこの下流影響（全利用者トークンの復号可能化）に触れていないため、この一点を推奨対応の背景として追記することを提案する。

## `ops_risk` の [medium]「鍵ローテーション runbook 未整備」との連携指摘（severity の見直し不要・関連性の明示）

- 対象: `ops_risk` round1 [medium]「鍵ローテーションの実行手順（runbook）が文書化されておらず…」
- 立場: 単体では medium 据え置きで妥当と判断するが、上記の `secrets_supplychain` [high] と組み合わせると意味が変わる点を指摘する。**`TOKEN_ENCRYPTION_KEY` が漏洩した場合の対処手順（runbook）が無いことは、漏洩後の封じ込め（=個人データ侵害の是正）を遅らせる要因になる**。個人情報保護の実務では「漏洩発覚後、鍵を速やかにローテーションして影響範囲を止める」ことが最初の対応になるが、正しいデプロイ順序（Secret 更新 → 確認 → `TOKEN_KEY_VERSION` +1）が文書化されていないと、有事に手順を誤って復旧が長引く。severity 自体を high に引き上げるほどではない（発生確率は secrets_supplychain 側の対策で下げられる）が、両者をセットで解消すべき事項として運用ドキュメントに明記することを推奨する。

## `web_appsec` の [high]「repo パラメータ未検証によるバックエンド fetch パス注入」への scope 確認（rebuttal ではなく確認）

- 対象: `web_appsec` round1 [high]「`repo` パラメータ未検証によるバックエンド GitHub API リクエストのパス/フラグメント注入」
- 立場: severity 自体（appsec 上の入力検証欠如）に異論はないが、**privacy_data レンズで見ると「他利用者の個人データが露出する経路」ではない** ことを明示しておく。この注入は常に「起票者自身の OAuth トークン」の権限内で実行されるため（`resolveTokens` が先に認証を確定させ、GitHub 側 API 呼び出しはそのユーザー自身のトークンで行われる）、攻撃者が他人のリポジトリ・Issue・個人情報を横取りする経路にはならない。したがって本指摘を「個人データ漏えいリスク」として格上げする根拠は無い（web_appsec の appsec 分類のまま据え置きが妥当）。誤検知ではなく、affected-scope の補足として共有する。

## 自分（`privacy_data`）の round1 指摘への reinforcement は無し

他レンズからの直接反証は round1 時点で出ていないため concession 対象なし。次ラウンドで反証があれば対応する。

## 所見サマリー（round2）
`secrets_supplychain` の high 指摘は、実は本アプリの核心的なプライバシー主張（トークン暗号化による安全性）を無効化しうる鍵漏洩経路であり、`authn_token`（鍵の用途無分離）・`ops_risk`（ローテーション手順欠如）と合わせて「漏洩 → 復号可能化 → 封じ込め手順なし」という一本の攻撃・対応遅延チェーンを成す。3 者とも個別 severity は妥当（high/medium/medium）で、chain だからといって単独の critical に格上げする根拠までは無いと判断するが、推奨対応は互いに参照し合うべきと提案する。`web_appsec` の repo 注入指摘は appsec としては妥当だが、他利用者の個人データ露出には繋がらないためプライバシーレンズでの格上げ対象ではないと確認した。

### `authn_token` — 反論
<sub>2026-07-29T09:47:57+09:00</sub>

## `authn_token` round 2 — rebuttal / reinforcement

### [rebuttal・重大度見直し] `web_appsec` [high] 「repo パラメータ未検証によるバックエンド GitHub API リクエストのパス/フラグメント注入」→ high は過大、medium 相当と考える
- 対象: `web_appsec` round1 [high]（`worker/index.ts:413-419,454-463,492-493` / `worker/github.ts:252,348`）
- 認証・トークンレンズからの反論根拠: この経路で叩けるのは常に **攻撃者自身ではなく被害者本人の GitHub App user-to-server トークン** であり、越権（他人へのなりすまし・他人の権限奪取）は発生しない。GitHub App のユーザートークンは App が要求する permission セット（Issues 書き込み等）に制限されるため、`repo` に `../orgs/x/repos#` のようなパストラバーサルを仕込んで `POST /orgs/x/repos`（リポジトリ作成 API）等を狙っても、この App が Administration 権限を持たない限り 403 で弾かれる。さらに `/api/repos` の allow-list はコード上も `worker/github.ts:293-299`（`RepoSummary.pushAccess` のコメント「ラベル UI の表示可否に使う」）と `tokenCookie.ts` 側のコメントの通り **UX 表示のための情報であり、明示的なセキュリティ境界として設計されていない**（実際の認可境界は GitHub API 自身）。つまり「allow-list を回避できる」こと自体は設計上のセキュリティ境界突破ではなく、本人トークンの権限内で本人が直接 `curl` すれば元々できることと同じ範囲に収まる。
- ただし入力検証欠如という指摘自体は妥当（confused-deputy 的にユーザー本人が意図しない GitHub API 呼び出しを引き起こす経路は塞ぐべき）なので **修正不要という主張ではない**。severity を high → medium への見直しを提案する（「他人の権限を奪う」「サーバー側の秘密情報が漏れる」等の重大結果に直結しないため）。

### [concession/補強] `ops_risk` [medium] 「未認証エンドポイントにレート制限が一切ない」への対象範囲の精緻化
- 対象: `ops_risk` round1 [medium]（`worker/index.ts:209,214-239,242-268,272-329`）
- `worker/index.ts:272-297` を round1 で読んだ内容から補足する: `/auth/callback` は `code`/`state`/`preauth` Cookie のいずれか欠落で **即 400（暗号処理・GitHub 呼び出しの手前で return）**、`preauth` があっても `openVersioned` の復号失敗や `state` 不一致でも即 400 になる。つまり **正規の preauth Cookie（HttpOnly・攻撃者が読めない）を持たない匿名攻撃者にとって `/auth/callback` の 1 リクエストあたりコストは極めて軽い**（GitHub への実際のトークン交換呼び出しに到達しない）。よって「4 エンドポイントいずれも同程度のリスク」という書き方は対象範囲がやや広すぎ、実質的にコストのかかる未認証エンドポイントは **`/auth/login`（毎回 PKCE 生成 + AES-256-GCM 暗号化 + Cookie 発行）だけ** に絞られる。`/api/health`・`/api/ready` も暗号処理を伴わない軽量チェックのみで同列に扱う必要はない。
- 結論: 指摘の方向性（`/auth/login` に唯一のスロットリングが無い）は妥当であり medium のままで良いが、対象を 4 エンドポイントから実質 1 エンドポイントに絞ることを推奨する。

### [concession/補強] `ops_risk` [medium] 「鍵ローテーション runbook 未文書化」を技術的に裏付け、かつ失敗モードの性質を補足
- 対象: `ops_risk` round1 [medium]（`worker/crypto.ts:119-134,141-155` の引用）
- `worker/crypto.ts` の実装を round1 で確認済みの内容として裏付ける: `sealVersioned` は呼び出し時点の `TOKEN_KEY_VERSION` と `TOKEN_ENCRYPTION_KEY` を独立に読むため、指摘の「バージョン先行反映 → 旧鍵で新バージョン番号封入」という中間状態は技術的に正しい。
- 補足（重大度を下げる方向の情報）: `openVersioned` はバージョン不一致で `KeyVersionMismatchError`、鍵不一致は AES-GCM の認証タグ検証失敗としてどちらも例外になり、`openTokenBundle`（`worker/tokenCookie.ts:103-112`）が全て `null` に潰して「未認証」として扱う。**誤った鍵で復号されて別人のトークンとして扱われる、といった機密性・整合性の破れは起きない**（AEAD が保証）。実害は「対象利用者が強制再ログインになる」という可用性・UX 上の問題に限定される。ops_risk の medium 判定（critical ではない）は認証レンズから見ても妥当と確認する。

### [クロスレンズ補強・注意喚起] `secrets_supplychain` [high] `/tmp` 平文シークレット漏洩と、自分の round1 medium 指摘の関係を整理
- 対象: `secrets_supplychain` round1 [high]（`.claude/hooks/session-start.sh` 等）と `authn_token` round1 [medium]（`TOKEN_ENCRYPTION_KEY` の AES-GCM/HMAC 無分離）
- 認証レンズから明確にしておく: 両者は独立した問題であり、**片方の対策が他方を代替しない**。仮に `secrets_supplychain` の指摘どおり `TOKEN_ENCRYPTION_KEY` 生鍵が `/tmp` から漏れた場合、HKDF でサブキー分離していたとしても（導出関数・salt/info が公開されている前提のため）攻撃者は同じ手順でサブキーを再導出でき、鍵分離は master key 漏洩そのものへの防御にはならない。したがって `secrets_supplychain` の high 指摘が仮に妥当だとしても、それを理由に自分の round1 medium 指摘を high へ格上げするのは論理的に不適切と判断し、見送る（両指摘は「鍵管理の別レイヤー」の問題であり、severity を混同しないよう明示しておく）。
- 一方で、`secrets_supplychain` の指摘が事実なら **認証レンズで最重要視すべきは round1 の medium ではなく `TOKEN_ENCRYPTION_KEY` そのものの漏洩経路** である点には同意する。round1 で自分は「秘密情報を console 出力する箇所は無い」ことしか確認しておらず、ハーネスの一時ファイル書き出し経路までは検証していなかった（自分のレンズの死角だったと認める）。

### `web_appsec` — 反論
<sub>2026-07-29T09:48:01+09:00</sub>

## rebuttal / 重大度の見直し

### [severity: high を維持・自説の補強] repo パス注入は「本人が自分のトークンで叩けるだけ」の自己バイパスではない
- 対象: 自分の round1 `[high] repo パラメータ未検証によるバックエンド GitHub API リクエストのパス/フラグメント注入` と、`ops_risk` round1 所見サマリーの「正規トークンを持つ利用者は GitHub API を直接叩けば本 Worker のレート制限を完全にバイパスできる構造」という一般論。
- 論点: `ops_risk` の指摘（トークン保有者本人による自己バイパス）と自分の `repo` 注入指摘を並べて読むと「結局トークン保有者本人が能動的に叩いているだけで大した実害はない」と矮小化されるおそれがあるため、両者は別種の脅威であることを明示しておく。
  - 自分の round1 で示した攻撃チェーンは「攻撃者 ≠ トークン保有者」である。`src/repos/RepoPicker.tsx:73,153-162` が `prefill.repo`（URL クエリ由来）を無検証で `selected` にセットし、`selectedPushAccess=false` でも送信ボタンは無効化されない。攻撃者が `/new?repo=../orgs/x/repos%23&title=...` のリンクを踏ませれば、**被害者が「Issue 起票」のつもりでタップした 1 回の同一オリジン `fetch`** が `worker/index.ts:492-493` → `worker/github.ts:252` の文字列結合 URL を経由し、`https://api.github.com/orgs/x/repos` 相当へ POST される。
  - `requireSameOrigin`（`worker/index.ts:137-143`）はこの経路を一切防げない: リクエストはブラウザ自身が発行する正真正銘の同一オリジンリクエストであり、Origin ヘッダーは常に一致する。CSRF 対策が有効なのは「攻撃者が任意オリジンから直接叩く」パターンに対してであり、「アプリ自身の正規 UI 経由で被害者に意図しない値を送信させる」ロジック不備には無力。
  - 結論: これは古典的な「本人が自分の権限内でできることを自分でやっているだけ」の非問題ではなく、**攻撃者がトークンを一切持たずに被害者のトークン権限内で任意パスへの POST/GET を誘発できる**、越権に近いロジック不備。round1 で high とした評価を維持する（critical への格上げは、固定ボディ形状 `{title,body,labels}` が受け側エンドポイントのスキーマと一致しないと空振りする点を考慮し見送る）。

### [reinforcement] `ops_risk` の「未認証エンドポイント無制限」medium は high 相当まで格上げを検討すべき
- 対象: `ops_risk` round1 `[medium] 未認証エンドポイントにレート制限が一切なく、コスト/DoS 検知の裏付けもない`（`worker/index.ts:242-268` `/auth/login` 他）
- web_appsec 観点からの補強材料: `POST /api/issues` だけが `resolveIssueRateLimiter`（`worker/index.ts:439`）で保護されており、CSRF チェック対象の 4 エンドポイント（`/auth/refresh` `/api/issues` `/auth/logout` `/api/account`）のうち `/api/issues` 以外にもレート制限が無いことは自分の round1 の CSRF 確認時にも把握していたが、round1 では「CSRF は妥当」の文脈でしか触れなかった。改めて `web_appsec` レンズで見ても、`/auth/login`（`worker/index.ts:242`）は認証不要かつ毎回 `sealVersioned`（AES-256-GCM 封入・CSPRNG）を実行して `Set-Cookie` する処理コストの高いエンドポイントで、GitHub 側 API を一切消費しない（`/login/oauth/authorize` への 302 リダイレクトを返すだけで GitHub 呼び出しは発生しない）ため、攻撃者は GitHub 側のレート制限を気にせず Worker 側だけを無制限に叩ける。`ops_risk` が挙げた「無料プランのリクエスト数上限でサービス全体が止まる」シナリオと合わせると、これは可用性に対する具体的かつ再現性の高い攻撃（`curl` ループ 1 本で完結）であり、medium より high 側に近いと判断する。ただし「WAF Rate Limiting Rule の追加」で塞げる規模相応の対策であることは `ops_risk` の推奨通りで、対応コストは低い。

## 確認・同意（他レンズとの整合）
- `authn_token` round1 所見サマリーの「状態変更エンドポイント（`/auth/refresh`・`/api/issues`・`/auth/logout`・`/api/account`）への Origin ベース CSRF チェックはいずれも確認して問題なし」は、自分の round1 の同項目の確認結果と完全一致。相互検証として妥当性を確認した。
- `secrets_supplychain` の `/tmp` 平文シークレット（high）・GH Actions タグ固定（medium）、`privacy_data` の 3 件（medium）はいずれも Web アプリの攻撃面（XSS/CSRF/CORS/SSRF/リクエスト検証/CSP/SW）の外側（ハーネス運用・CI サプライチェーン・法務文言）であり、web_appsec レンズからは反証・補強すべき具体的コード根拠を持たない。異論なし。

### `ops_risk` — 反論
<sub>2026-07-29T09:48:17+09:00</sub>

## rebuttal: web_appsec [high]「repo パラメータ未検証によるバックエンド GitHub API パス/フラグメント注入」は運用上の実害範囲が過大評価

- 対象: `web_appsec` round1 の `[high]`（`worker/github.ts:252` `createIssue` / `worker/index.ts:454-463,492-493`）
- 根拠: 本アプリの GitHub App は README（`README.md:32`「要求する権限は Issues（Read and write）のみ。コードには一切アクセスしません」）どおり **Issues 権限のみ** を要求する user-to-server トークンで動く。GitHub App のユーザートークンはアプリの許可権限を超える API を呼べない（GitHub 側が 403 "Resource not accessible by integration" で拒否する）。挙げられた PoC（`repo: "../orgs/some-org/repos#"` → `POST /orgs/{org}/repos` 相当）は「組織リポジトリ作成」エンドポイントで `administration` 権限を要求するため、**Issues のみのトークンでは GitHub 自身が実行前に弾く**。したがって「任意パス・任意 HTTP メソッド固定のエンドポイントを叩けてしまう」という結論は、この具体例では成立しない（GitHub 側の権限強制という第 2 層が実際には効いている）。
- 加えて、`/api/repos`（`worker/github.ts:305-333`）の push 権限フィルタは UI 表示の絞り込みにすぎず、真の認可境界は GitHub 側の「App インストール済み ∩ 実際の権限」判定にある。反対に言えば、`repo` にどんな文字列を注入しても、対象リポジトリで App が未インストールなら GitHub が 404、権限不足なら 403 を返す。パス正規化（`../`）でトラバースできる範囲も `api.github.com` の URL 空間内に限られ、任意の権限昇格には繋がらない。
- 結論（重大度の見直し）: **high → medium への格下げを提案**。入力検証（`owner/repo` フォーマットチェック）が欠けていること自体は事実で cheap fix（推奨対応どおり実装すべき）だが、「実害シナリオ」は GitHub 側の権限モデルという既存の防御層で大部分吸収されている。この防御層に依存する設計（バリデーションを Worker 側でなく上流 API に委ねている）自体が「多層防御が 1 層で成立している」というリスクではあるので medium 相当が妥当と考える。仮に将来 App の Permissions を Contents や Administration まで広げた場合はこの防御層が消え high に戻る点は明記しておく価値がある。

## reinforcement/concession: authn_token [medium]「TOKEN_ENCRYPTION_KEY の HMAC/AES 用途混在」は自分の round1 finding #2（鍵ローテーション runbook 欠如）を悪化させる要因として格上げに同意

- 対象: `authn_token` round1 の `[medium]`（`worker/crypto.ts:53,75-80` / `worker/index.ts:184,206`）と、自分（ops_risk）の round1 `[medium]`「鍵ローテーションの runbook 未文書化」
- 補強根拠: `TOKEN_ENCRYPTION_KEY` が唯一の鍵で AES-GCM（トークン Cookie）と HMAC（`rateLimitKey`・`duplicateSubmissionKey`）を兼務しているため、インシデント対応で鍵を差し替えると **トークン Cookie の強制失効（意図した効果）と同時に、進行中のレート制限・連投抑止カウンタのキー空間も無警告で丸ごと切り替わる**（`worker/index.ts:184` `rateLimitKey` と `:206` `duplicateSubmissionKey` は同じ鍵から HMAC を導出するため、鍵ローテーション直後は同一ユーザーでも旧鍵ベースのキーと新鍵ベースのキーが別カウンタ扱いになり、直前まで累積していたレート制限・連投抑止のカウントが実質リセットされる）。これは鍵漏洩インシデント対応中に「攻撃者の連投カウンタも同時にリセットされる」という運用上の副作用であり、単なる暗号衛生の理論的懸念に留まらない。
- 結論: authn_token の HKDF 分離提案に **ops_risk レンズからも賛成（concession ではなく補強）**。優先度は現状の medium で妥当だが、推奨対応の効果に「鍵ローテーション時の副作用（レート制限リセット）を無くす」という運用上のメリットを 1 行加えると、対応コストの説明として説得力が増す。

## 所見（secrets_supplychain [high] への言及・格下げ不要の確認）

`/tmp/*.env` の world-readable 秘密ファイル（`session-start.sh`）は自分の対象ファイル外だが round1 finding と直結するため言及する: この経路で `TOKEN_ENCRYPTION_KEY` が漏れた場合、実行すべき初動対応の手順が `SECURITY.md` に存在しない（ops_risk round1 finding #2）。secrets_supplychain の指摘は severity 通り high のままで異論なし。両指摘は「漏洩経路（secrets_supplychain）」と「漏洩後の初動未整備（ops_risk）」で補完関係にあり、どちらか一方の対応だけでは不十分な点を明記しておく。

## ラウンド 3

### `lead` — 合意
<sub>2026-07-29T09:52:07+09:00</sub>

## 合意点

1. **アプリ本体のセキュリティ設計は概ね堅牢**。5 レンズが独立に検証し、以下はいずれも「確認して問題なし」で一致した:
   - AES-256-GCM の実装（IV は呼び出しごとに CSPRNG 生成・鍵バージョンを AAD に含めるためバージョン混同改ざんを検出）・PKCE(S256)・state 検証
   - トークン Cookie の属性（`__Host-` プレフィックス・HttpOnly・Secure・SameSite=Lax・絶対期限がリフレッシュで延長されない）
   - 状態変更 4 エンドポイントすべてへの Origin ベース CSRF チェック（`requireSameOrigin`）
   - XSS（`dangerouslySetInnerHTML` ゼロ・すべて React のエスケープ経由）・CORS・オープンリダイレクト・Service Worker のキャッシュ汚染
   - 秘密情報の `console.*` 出力ゼロ・全履歴/全ブランチに実秘密のコミット混入なし
   - レート制限キー・連投抑止キーの HMAC 仮名化（ユーザー ID 生値を Cloudflare 側に渡さない）
   - アカウント削除の削除範囲とポリシー文言の一致（#181 で解消済み）

2. **最大のリスクはアプリコードではなく AI ハーネスの運用層にある**。`TOKEN_ENCRYPTION_KEY` を含みうるシークレットが固定パスの world-readable な `/tmp/*.env` に平文で置かれ、Read 拒否リストの対象外である点は、`secrets_supplychain` の指摘に `privacy_data`・`authn_token`・`ops_risk` の 3 レンズが独立に補強を寄せ、誰も格下げを主張しなかった。lead が実機確認したところ、両スクリプトに `umask`/`chmod` は 1 件も存在せず、`.claude/settings.json` の deny リストにも `/tmp/*.env` に相当するパターンは無い（指摘は事実と確認）。

3. **「漏洩経路（secrets_supplychain）→ 復号可能化（privacy_data）→ 封じ込め手順なし（ops_risk）」が一本のチェーンを成す** ことを 3 レンズが合意した。個々の severity は据え置き（high / — / medium）だが、対応は互いを参照して同時に行うべきという点で一致。

## 対立点と lead の裁定

### 対立 1: `repo` パラメータ未検証の重大度（high か medium か）

- `web_appsec`: high 維持。攻撃者 ≠ トークン保有者の confused deputy 経路（`/new?repo=...` リンクを踏ませる）が実在し、`requireSameOrigin` は正規 UI 経由のこの経路を一切防げない。
- `authn_token` / `ops_risk`: medium へ格下げを提案。GitHub App の権限は Issues のみで、パス注入で狙える他エンドポイントは GitHub 側が 403/404 で弾く。`/api/repos` の push 権限フィルタは UI 表示用で認可境界ではなく、真の境界は GitHub API 側にある。
- `privacy_data`: 他利用者の個人データ露出には繋がらない（affected-scope の補足）。

**lead 裁定: high とする（critical にはしない）。** 事実関係は全レンズ一致で、lead も実機で URL 正規化を再現した（`repo="../orgs/x/repos#"` → 実リクエストが `https://api.github.com/orgs/x/repos` になる）。格下げ論拠である「GitHub 側の権限モデルが吸収する」は正しいが、それは **Worker 側の入力検証がゼロで、防御が上流 API の権限設定という 1 層だけに乗っている** ことの裏返しであり、App の Permissions を将来広げた瞬間に破綻する。正規表現 1 本で閉じられる cheap fix であること、confused deputy 経路が実在することを踏まえ、medium ではなく high。ただし越権・他人のデータ露出には至らないため critical ではない（web_appsec 自身も critical 化は見送っている）。

### 対立 2: 未認証エンドポイントのレート制限欠如の重大度と対象範囲

- `ops_risk`: medium。4 エンドポイント（`/api/health` `/api/ready` `/auth/login` `/auth/callback`）が無制限。
- `web_appsec`: high 相当へ格上げを検討すべき。`/auth/login` は GitHub API を一切消費せず Worker 側だけを消耗させるため、攻撃者は上流のレート制限を気にせず叩ける。
- `authn_token`: 対象範囲を絞るべき。`/auth/callback` は preauth Cookie 欠落・state 不一致で暗号処理の手前で 400 になるため軽量。実質コストが高いのは `/auth/login` の 1 本だけ。

**lead 裁定: 対象を `/auth/login` に絞ったうえで high とする。** 3 レンズの主張は矛盾せず、`authn_token` の絞り込みと `web_appsec` の格上げ根拠は両立する。`curl` ループ 1 本で再現でき、無料枠を使い切れば正規利用者を含む全員が起票できなくなる（可用性の具体的な失敗）。対策は Cloudflare 無料枠の WAF Rate Limiting Rule または既存の Rate Limiting binding の流用で、規模相応。

### 対立 3: 鍵の用途無分離（HKDF）の重大度

- `authn_token`: medium。具体的な鍵復元経路は確認できず、ブラストラジアス拡大という予防的観点。
- `secrets_supplychain`: `/tmp` 経由の漏洩で AES 側と HMAC 側が同時に破られる実在経路がある（medium 据え置きは支持）。
- `authn_token` の再反論: **master key が漏れれば HKDF で分離していても攻撃者は同じ手順でサブキーを再導出できる** ため、`/tmp` の指摘を理由に格上げするのは論理的に不適切。
- `ops_risk`: 鍵ローテーション時にレート制限・連投抑止のカウンタが無警告でリセットされるという運用副作用がある（対応の便益として追記を推奨）。

**lead 裁定: medium 据え置き。** `authn_token` の再反論が論理的に正しい（鍵分離は master key 漏洩への防御にならない）。対応する価値はあるが優先度は上記 3 件の後。

## 議論を経て除外・格下げした指摘

- `/api/health` `/api/ready` `/auth/callback` のレート制限欠如 → **除外**（`authn_token` の反証により、暗号処理・上流呼び出しの手前で終わる軽量エンドポイントと確認）。
- `repo` 注入を「個人データ漏えいリスク」として扱うこと → **除外**（`privacy_data` が affected-scope を確認。常に起票者自身のトークン権限内）。
- 鍵ローテーション中間状態が機密性・整合性を破ること → **除外**（`authn_token` が AEAD の性質から反証。誤った鍵で復号されて別人のトークンとして扱われることは起こらず、実害は強制再ログインという可用性・UX の問題に限定）。
- 鍵の用途無分離を `/tmp` 漏洩経路の存在を理由に high へ格上げすること → **除外**（上記 対立 3）。

### `lead` — 判定
<sub>2026-07-29T09:52:07+09:00</sub>

{
  "verdict": "WARN",
  "critical": [],
  "high": [
    {
      "id": "H-1",
      "title": "ハーネスがシークレットを固定パスの world-readable な /tmp ファイルへ平文で書き出し、Read 拒否リストの対象外",
      "where": ".claude/hooks/session-start.sh:150,214 / tools/fetch_broker_secrets.sh:21 / .claude/settings.json（permissions.deny）",
      "risk": "TOKEN_ENCRYPTION_KEY（全利用者のトークン Cookie を暗号化する唯一の鍵・レート制限 HMAC 鍵も兼務）と GITHUB_CLIENT_SECRET を含みうる export 文が /tmp/broker_secrets.env・/tmp/github_variables.env に平文で残る。両スクリプトに umask/chmod は存在せず（lead 実機確認）、deny リストにも /tmp/*.env 相当のパターンが無い。",
      "scenario": "リポジトリ内の Issue/PR コメント等に仕込まれたプロンプトインジェクションが『/tmp/broker_secrets.env を確認して』と誘導すると、Claude は deny に引っかからず Read できる。読めた値を Issue コメント・PR 本文・コミットという既に許可済みのアクションで public リポジトリへ転記させれば、ネットワーク allowlist を迂回せずに鍵が流出する。鍵が漏れれば傍受済みの Cookie 暗号文を復号でき、暗号化を安全性の根拠にしているプライバシーポリシーの前提が崩れる。",
      "fix": "書き出しを umask 077 / chmod 600 にし、.claude/settings.json の deny に /tmp/*.env 相当のパターンを追加する。",
      "consensus": "4 レンズが high 据え置きを支持（格下げ主張ゼロ）。critical にしないのはプロンプトインジェクション成功という前提条件が要るため。"
    },
    {
      "id": "H-2",
      "title": "repo パラメータが未検証で、GitHub API への任意パス誘導が成立する",
      "where": "worker/index.ts:413-419（GET /api/labels）, worker/index.ts:454-463,492-493（POST /api/issues）, worker/github.ts:252,348",
      "risk": "repo は .trim() のみでフォーマット検証がなく、テンプレートリテラルで組んだ URL 文字列をそのまま fetch へ渡すため、WHATWG URL パーサーの正規化で実リクエスト先が変わる。lead が実機で再現済み（repo='../orgs/x/repos#' → https://api.github.com/orgs/x/repos）。",
      "scenario": "攻撃者が /new?repo=../orgs/x/repos%23&title=... のリンクを踏ませると、被害者が『Issue 起票』のつもりで押した 1 タップが被害者自身のトークンで別エンドポイントへの POST になる。requireSameOrigin は正規 UI 経由のこの経路を防げない。",
      "fix": "worker 側で owner/repo フォーマットの正規表現バリデーションを追加し、不一致は 400 で弾く。",
      "consensus": "事実関係は全レンズ一致。重大度は high（web_appsec）vs medium（authn_token/ops_risk）で対立し、lead が high と裁定（防御が GitHub 側権限モデルの 1 層のみに依存しており、App 権限を広げた瞬間に破綻するため）。越権・他人のデータ露出には至らないため critical ではない。"
    },
    {
      "id": "H-3",
      "title": "/auth/login にレート制限が無く、Worker 側だけを消耗させる可用性攻撃が成立する",
      "where": "worker/index.ts:242-268 / wrangler.jsonc（ratelimits は POST /api/issues にしか適用されない）",
      "risk": "/auth/login は認証不要で、毎回 PKCE 生成 + AES-256-GCM 封入 + Set-Cookie を実行する。GitHub API を一切消費しないため、攻撃者は上流のレート制限を気にせず Worker 側のリクエスト数と CPU 時間だけを消費させられる。",
      "scenario": "curl ループ 1 本で GET /auth/login を高頻度に叩き、無料プランのリクエスト上限に到達させると、その日は正規利用者を含む全員が起票できなくなる。",
      "fix": "Cloudflare 無料枠の WAF Rate Limiting Rule を /auth/login に追加するか、既存の Rate Limiting binding を流用する。あわせて Cloudflare 使用量アラート（既知の未対応項目 #171）を設定する。",
      "consensus": "ops_risk の medium 指摘を web_appsec が格上げ主張し、authn_token が対象を /auth/login 1 本に絞る反証を出した。3 者は矛盾せず、lead が『対象を絞ったうえで high』と裁定。/api/health・/api/ready・/auth/callback は軽量として対象から除外。"
    }
  ],
  "medium": [
    {
      "id": "M-1",
      "title": "鍵漏洩時の初動・鍵ローテーション手順（runbook）が文書化されていない",
      "where": "SECURITY.md（報告経路のみ）/ wrangler.jsonc:9-13 / docs/design/stateless-architecture.md",
      "risk": "TOKEN_KEY_VERSION（git 管理の vars・push で自動デプロイ）と TOKEN_ENCRYPTION_KEY（Workers Secret・手動更新）でデプロイ経路が分かれており、更新順序が未文書化。逆順で実行すると『新バージョン番号 + 旧鍵』で封入された Cookie が後で開封不能になる。H-1 が現実化した際の封じ込めも遅れる。",
      "fix": "SECURITY.md か stateless-architecture.md に『① Workers Secret を更新 → ② /api/ready で確認 → ③ TOKEN_KEY_VERSION を +1 して push』の順序を明記する。",
      "consensus": "全レンズ同意。authn_token が AEAD の性質から『誤った鍵で別人のトークンとして扱われることはない（実害は強制再ログインに限定）』と補足し、medium で確定。"
    },
    {
      "id": "M-2",
      "title": "TOKEN_ENCRYPTION_KEY を AES-GCM 鍵と HMAC 鍵に無分離で使い回している",
      "where": "worker/crypto.ts:53,75-80 / worker/tokenCookie.ts:94-95 / worker/index.ts:184,206",
      "risk": "用途別のサブキー導出（HKDF）が無い。運用面では、鍵ローテーション時にレート制限・連投抑止のカウンタキー空間も同時に切り替わり、インシデント対応中に攻撃者の連投カウンタまでリセットされる副作用がある。",
      "fix": "TOKEN_ENCRYPTION_KEY から HKDF で暗号化用・HMAC 用のサブキーを別導出する。",
      "consensus": "medium 据え置き。secrets_supplychain が /tmp 漏洩経路を根拠に実害を補強したが、authn_token が『master key が漏れれば HKDF でも同じ手順でサブキーを再導出できる』と再反論し、格上げは見送られた。"
    },
    {
      "id": "M-3",
      "title": "CSP・セキュリティヘッダ（X-Content-Type-Options / frame-ancestors / Referrer-Policy）が未設定",
      "where": "index.html / worker/index.ts（共通ヘッダミドルウェアなし）/ _headers ファイル無し",
      "risk": "現時点で XSS の実弾は見つかっていないが、依存経由の回帰に対する多層防御が存在しない。",
      "fix": "Hono の app.use() で default-src 'self'; frame-ancestors 'none' 相当と nosniff を全レスポンスに付与する（数行）。",
      "consensus": "他レンズから反証なし。"
    },
    {
      "id": "M-4",
      "title": "prefillParams 経由の URL が任意 repo・任意内容を初期選択させ、ワンタップ起票を誘導できる",
      "where": "src/repos/RepoPicker.tsx:73,153-162,263-275 / src/issues/prefillParams.ts:29-37",
      "risk": "repo は /api/repos の一覧照合なしに selected へ入り、pushAccess=false でも送信ボタンは無効化されない。被害者のアカウントで攻撃者の内容の Issue が起票されうる（スパム・評判毀損）。",
      "fix": "『URL から事前入力されました』の出典表示を追加する（UI 文言レベル）。自動送信はしない現仕様が最低限の緩和になっている。",
      "consensus": "H-2 と同根の経路。web_appsec 自身が必須修正ではないとしている。"
    },
    {
      "id": "M-5",
      "title": "contents: write を持つワークフローの Actions がミュータブルなタグ参照のまま",
      "where": ".github/workflows/cleanup-merged-branches.yml:41-42（actions/checkout@v5・actions/github-script@v8）",
      "risk": "サードパーティ Action は SHA 固定済みなのに、ブランチ削除という破壊的操作を行い contents: write を持つワークフローの公式 Action だけタグ参照で一貫性を欠く。",
      "fix": "少なくとも cleanup-merged-branches.yml の 2 Action を SHA 固定に揃える（既にサードパーティで実施済みの手順を流用）。",
      "consensus": "他レンズから反証なし。ci.yml 側は許容範囲。"
    },
    {
      "id": "M-6",
      "title": "プライバシーポリシー §5 が Cloudflare のネットワーク層アクセスログ（IP）に触れていない",
      "where": "src/i18n/translations.ts:395-398（ja）/ :654-657（en）/ docs/design/stateless-architecture.md:145-162",
      "risk": "Workers Logs の設定だけを根拠に『サーバーは個人データを保存しない』と言い切っているが、Cloudflare は基盤側で接続元 IP を含む標準ログを保持し、アプリからは制御できない。",
      "fix": "§5 に『Cloudflare のネットワーク層でも通信の性質上、接続元 IP 等が短期間記録される場合があります』の 1 文を追加し、アプリが設定するログと基盤標準のログを分けて説明する。",
      "consensus": "他レンズから反証なし。"
    },
    {
      "id": "M-7",
      "title": "利用規約が『アカウントの利用を制限する』と約束しているが、ステートレス構成に実装手段が無い",
      "where": "src/i18n/translations.ts:338（ja）/ :597（en）",
      "risk": "サーバーに永続層が無く ban フラグを持てない。ISSUE_RATE_LIMIT は 60 秒窓の自動失効カウンタで恒久的な制限機構ではないため、規約が約束する運用アクションを実行できない。",
      "fix": "実際に取りうる手段（GitHub App の連携解除・レート制限の継続適用）に即した文言へ具体化するか削除する。",
      "consensus": "他レンズから反証なし。"
    },
    {
      "id": "M-8",
      "title": "プライバシーポリシー §3『利用目的』に不正利用対策（レート制限・連投抑止）が列挙されていない",
      "where": "src/i18n/translations.ts:388（ja）/ :647（en）。対比: :379 / :638（§2）、worker/index.ts:183-207",
      "risk": "§2 がユーザー ID・送信内容由来のハッシュ処理を説明しているのに、§3 は 3 目的のために『のみ』利用すると限定しており文言が矛盾する。",
      "fix": "§3 に『不正利用防止（レート制限・連投抑止）のため』を 1 項目追加する。",
      "consensus": "他レンズから反証なし。"
    }
  ],
  "consensus": "アプリ本体の認証・暗号・CSRF・XSS 対策は 5 レンズの独立検証でいずれも堅牢と確認され、実害のある critical はゼロだが、AI ハーネスの運用層に置かれた平文シークレットと、Worker 側の入力検証・レート制限の欠落という high 3 件は公開前に閉じるべきである。",
  "summary": "検出は high 3 件（/tmp 平文シークレット、repo パラメータ未検証による GitHub API 任意パス誘導、/auth/login のレート制限欠如）と medium 8 件（鍵ローテーション runbook 不在、鍵の用途無分離、CSP 未設定、prefill 経由のワンタップ起票、Actions のタグ参照、プライバシー/利用規約の文言 3 件）。議論で 4 件の指摘が誤検知・過大評価として除外・格下げされた。"
}
