<!-- discussion_whiteboard:auto -->
# 🧑‍🏫 議論ホワイトボード: リポジトリ全体のセキュリティ・リスク管理レビュー（敵対的多観点）

- 議題ID: `security-risk-review-20260729`
- 論点: Cloudflare Workers + React PWA（GitHub Issue 起票アプリ）のセキュリティ・リスク管理を 5 レンズで敵対的にレビューする。一般公開準備中・リポジトリ public・サーバー永続層ゼロ（トークンは暗号化 Cookie）。実害のあるリスクのみ critical にする。
- 参加者: `authn_token`, `web_appsec`, `secrets_supplychain`, `privacy_data`, `ops_risk`
- 投稿数: 5
- 更新: 2026-07-29T09:45:22+09:00

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
- 問題: `TOKEN_KEY_VERSION` は Git 連携の Cloudflare Workers Builds が `main` への push で自動デプロイする一方、`TOKEN_ENCRYPTION_KEY`（Workers Secret）は git 管理外でダッシュボード/`wrangler secret put` の手動操作が必要。この 2 つを**どちらを先に更新するか**の運用手順がどこにも書かれていない。`worker/crypto.ts:119-134`（`sealVersioned`）はその時点で読める `TOKEN_KEY_VERSION`（新）と `TOKEN_ENCRYPTION_KEY`（まだ旧のまま）の組み合わせで新規ログインの Cookie を封入してしまうため、鍵更新前に `TOKEN_KEY_VERSION` だけ先に反映されるデプロイ順序だと、その間にログインした利用者の Cookie は「新バージョン番号 + 旧鍵」で封入され、後で鍵が新しい値に切り替わった瞬間に復号できなくなる（`worker/crypto.ts:141-155` の `openVersioned` は version 一致を前提に鍵を試すため、鍵不一致は GCM 認証失敗で無条件に開封失敗＝強制再ログイン）。
- 攻撃/失敗シナリオ: これは外部攻撃者が起こす脅威ではなく、`TOKEN_ENCRYPTION_KEY` 漏洩時に実際にローテーションを実行しようとした運用者が、正しい順序（Secret 更新 → 確認 → `TOKEN_KEY_VERSION` を上げてデプロイ）を知らずに逆順で実行してしまい、更新直前にログインした一部利用者だけが原因不明の再ログインを強いられる、という運用ミスのシナリオ。個人開発 OSS で実害は「強制再ログイン」に留まり致命的ではないが、公開直後で利用者数が増える局面かつ Claude Code の自律実行（本リポジトリの CLAUDE.md 前提）で `wrangler secret put` はアカウント権限が要る A-6 の手動ステップになるため、手順書がないと有事に迷う。
- 推奨対応: `SECURITY.md` か `docs/design/stateless-architecture.md` に「鍵漏洩時は ① Workers Secret を新しい値に更新 → ② デプロイ完了を `/api/ready` で確認 → ③ `TOKEN_KEY_VERSION` を +1 して push」という順序を 5 行程度で明記する。

## 所見サマリー
- `POST /api/issues` のレート制限キーは認証済みユーザー限定（`resolveTokens` が先に 401 で弾く）で、匿名の起票濫用は成立しない。ただし正規トークンを持つ利用者は GitHub API を直接叩けば本 Worker のレート制限を完全にバイパスできる構造であり、この上限は「本アプリ経由の連投」に対する軽い抑止にすぎない点は `wrangler.jsonc` のコメント（データセンター単位 best-effort・OQ-6）で運営者も認識済み。追加の指摘は見送るが公開後は実運用で再評価が要る（確認して問題あり・ただし対応不要と判断されている既知のトレードオフ）。
- CSRF（`requireSameOrigin`・`worker/index.ts:137-143`）は状態変更エンドポイント（`/auth/refresh`・`/api/issues`・`/auth/logout`・`/api/account`）すべてに適用されており、`SameSite=Lax` Cookie と組み合わせて妥当（確認して問題なし）。
- エラーハンドリング（`issueCreationErrorResponse` 含む全 `catch` ブロック）はいずれも内部例外のスタックトレースや `err.message` の生値をそのまま返さず、`jsonError` の固定文言または GitHub 自身のエラーメッセージ（機密情報を含まない）のみを返しており、情報量は適切（確認して問題なし）。Hono の `app.onError` は未定義だが、全ルートが個別 try/catch で握っているため未捕捉例外が生の内部情報を漏らす経路は見当たらない。
- `/api/ready` は設定不備（暗号鍵不正・レート制限バインディング未設定・E2E 緩和フラグの本番混入）を自己診断し 503 を返す設計で、`tools/smoke_prod.sh` が 6 時間おきに実プロダクションへ叩いている。これはフォーク/セルフホスト時の設定ミス検知にも有効な既存資産（確認して問題なし）。
