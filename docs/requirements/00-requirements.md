# GitHub Issue Shortcut 要件定義書

- 作成日: 2026-07-10
- ステータス: Draft（M0 開始前のベースライン）
- 対象読者: 本プロジェクトの開発エージェント（Claude Code）およびオーナー

本書は要件定義の本体である。要件は「〜できること」「〜であること」の形式で検証可能に記述し、[RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119) に準じて **MUST**（必須）/ **SHOULD**（推奨・原則実施）/ **MAY**（任意）を付す。根拠となる調査は `docs/research/` 配下のリサーチ文書（[関連ドキュメント](#11-関連ドキュメント)参照）に依拠する。

---

## 1. 概要

### 1.1 背景

GitHub Issues を個人タスク管理・アイデアキャプチャに使う文化は確立されているが、モバイル（特に Android）での即時起票には大きな摩擦がある。GitHub 公式アプリは起票まで 3〜4 タップ + 4 画面を要し、ホーム画面からの直行導線がない。既存の回避策（プレフィル URL・HTTP Shortcuts・自動化サービス）は PAT 手動管理・UI の貧弱さ・遅延や課金のいずれかを抱える。近い競合はすべて iOS ネイティブであり、「Android × PWA × ワンタップ起票」は空白地帯である（詳細: [市場・競合リサーチ](../research/2026-07-10-market-competitors.md)）。

### 1.2 目的

「思いついた瞬間」を逃さず、Android スマホのホーム画面から数秒で特定の GitHub リポジトリに Issue を起票できる、最速・最短の起票体験を提供する（[プロジェクトミッション](../project-mission.md)）。KPI は以下の通り。

| 指標 | 目標 |
|------|------|
| 起票所要時間（起動 → Issue 作成完了） | 10 秒以内（タイトルのみなら 5 秒以内） |
| 起票までのタップ数（ショートカット起動時） | 3 タップ以内 |
| 起票成功率（送信 → GitHub 反映） | 99% 以上（失敗時は入力内容を失わない）。定義: 送信試行（ユーザーが送信を実行した回数）に対する GitHub API 201 応答の割合。issue_log で計測し、集計窓は直近 7 日 |
| 初回セットアップ（ログイン → 初起票） | 5 分以内 |

### 1.3 プロダクト定義

GitHub Issue Shortcut は、Android スマホのホーム画面から数秒で特定 GitHub リポジトリに Issue を起票する Web アプリ（PWA）である。**最初から一般公開を前提** とし、誰でも GitHub ログインで利用できる。

### 1.4 スコープ

- GitHub ログイン（GitHub App による認可）と、それに伴うセッション・トークン管理
- Issue 作成（タイトル必須・本文任意・ラベル任意）に特化した最短フロー
- PWA としてのインストール・ホーム画面起動・ショートカット起動（URL パラメータで repo / label 初期選択）
- Web Share Target による共有シートからの起票
- スマート入力（`#repo` / `@label` トークン）・オフラインキュー（段階的追加）
- TWA 化による Google Play 配布（M4）
- 一般公開に必要な法務・運用要件（利用規約・プライバシーポリシー・データ削除・不正利用対策）

### 1.5 非スコープ（将来バックログ）

- Issue の一覧・検索・編集・クローズ・アサイン・コメント
- GitHub 以外のサービス（GitLab・Gitea 等）対応
- iOS 最適化（動作は妨げないが検証・最適化対象は Android Chrome）
- ホーム画面ウィジェット・プッシュ通知
- チーム向け機能・課金機能

### 1.6 マイルストーン定義

本書の機能要件はマイルストーン M0〜M4 に対応付ける。

| マイルストーン | ゴール |
|------|------|
| M0 | プロジェクト基盤: Workers + Vite + React + Hono の骨格・CI/CD・D1 スキーマ・デプロイ導線 |
| M1（MVP） | GitHub ログイン + Issue 作成のみ最短で完結。PWA インストール可能。一般公開に必要な最低限の法務ページ |
| M2 | ラベル・ショートカット起動（URL パラメータ）・manifest shortcuts・Web Share Target |
| M3 | スマート入力・ボトムシート UI・オフラインキュー・楽観的 UI |
| M4 | TWA 化・Google Play 配布 |

## 2. 用語定義

| 用語 | 定義 |
|------|------|
| 起票 | GitHub リポジトリに新規 Issue を作成すること |
| GitHub App | GitHub の統合アプリ形式。fine-grained permissions と短命トークンを持つ。本アプリは Issues: write 権限のみ要求する |
| user access token | GitHub App がユーザーに代わって API を呼ぶためのトークン（`ghu_`・有効期限 8 時間） |
| リフレッシュトークン | user access token を再発行するためのトークン（`ghr_`・6 ヶ月・単回使用ローテーション） |
| インストール（GitHub App） | ユーザー / Organization が GitHub App にリポジトリへのアクセスを許可する操作。認可（authorization）とは別概念 |
| PWA | Progressive Web App。manifest と Service Worker を備え、ホーム画面インストール・オフライン動作が可能な Web アプリ |
| WebAPK | Android Chrome が PWA インストール時に生成する軽量 APK。アプリ一覧・intent filter・manifest shortcuts に対応 |
| manifest shortcuts | Web App Manifest の `shortcuts`。アイコン長押しメニューに表示される起動導線（Android Chrome は最大 3 個） |
| ショートカット起動 | `/new?repo=...&labels=...` のような URL パラメータ付き起動で、リポジトリ・ラベルが初期選択された状態で起票画面を開くこと |
| Web Share Target | インストール済み PWA を Android の共有シートの送信先にする仕組み |
| app shell | 事前キャッシュされる UI の骨格。再訪時のサブ秒起動を実現する |
| セッション | 本アプリ独自のログイン状態。128bit 以上のランダム ID を Cookie で保持し、サーバー側にはハッシュのみ保存する |
| 下書き保全 | 送信失敗・中断時に入力内容を失わず復元可能に保持すること |
| silently dropped | GitHub API が権限不足のパラメータ（labels 等）をエラーにせず黙って無視する挙動 |

## 3. ユーザー・利用シナリオ

### 3.1 ペルソナ A: オーナー自身（個人開発者・ユーザー第 1 号）

- Android スマホ + Chrome。GitHub Issues で個人プロジェクトと生活タスクを一元管理している
- 通勤中・家事中に思いついたアイデア・バグ・TODO を、忘れる前に該当リポジトリへ起票したい
- 定番の起票先（2〜3 リポジトリ × ラベル）が決まっており、毎回の選択操作を省きたい

シナリオ A-1（定番リポジトリへの即時起票）:
ホーム画面のショートカット（例:「blog に idea ラベルで起票」）をタップ → 起票画面がリポジトリ・ラベル選択済みで開く → タイトルを入力して送信 → 完了トーストを確認して閉じる。所要 10 秒以内・3 タップ以内。

シナリオ A-2（ブラウザからの共有起票）:
Chrome で気になる記事を開く → 共有シートから本アプリを選択 → タイトル・本文（URL）がプレフィルされた起票画面が開く → リポジトリを確認して送信。

### 3.2 ペルソナ B: 公開ユーザー（初見の開発者）

- Zenn / Qiita / Show HN 経由で本アプリを知った Android ユーザーの開発者。PAT の発行・管理はしたくない
- 信頼できるか分からないサービスに GitHub の広い権限を渡したくない（最小権限であることが導入の決め手）
- まず 1 リポジトリで試し、良ければホーム画面に追加して常用する

シナリオ B-1（初回セットアップ）:
LP にアクセス →「GitHub でログイン」→ GitHub の認可画面（要求権限が Issues: write のみであることを確認）→ 対象リポジトリへの App インストール → 起票画面でテスト起票 → PWA インストール導線からホーム画面へ追加。ログインから初起票まで 5 分以内。

シナリオ B-2（退会）:
設定画面から「アカウント削除」を実行 → 本アプリ側のデータ（セッション・トークン・設定）が削除され、GitHub 側の App 連携解除手順が案内される。

## 4. 機能要件

### 4.1 機能要件一覧

| ID | 要件 | レベル | MS |
|----|------|--------|----|
| FR-1 | GitHub App の認可フロー（フルページリダイレクト + state + PKCE S256）で GitHub ログインができること | MUST | M1 |
| FR-2 | ログアウトができ、サーバー側セッションが無効化されること | MUST | M1 |
| FR-3 | user access token の期限切れ時、ユーザー操作なしにリフレッシュトークンで自動更新されること（ユーザー単位で直列化） | MUST | M1 |
| FR-4 | 初回オンボーディングで GitHub App のインストール（対象リポジトリの選択）へ誘導できること。Organization リポジトリでは非管理者はインストール申請となり承認待ちが発生するため、その旨をユーザーに案内表示すること | MUST | M1 |
| FR-5 | App がインストール済みかつユーザーがアクセス可能なリポジトリの一覧から起票先を選択できること | MUST | M1 |
| FR-6 | タイトル（必須）と本文（任意）を入力して Issue を作成できること | MUST | M1 |
| FR-7 | 起票成功時に作成された Issue の URL を提示し、タップで GitHub 上の Issue を開けること | MUST | M1 |
| FR-8 | 起票失敗・中断時に入力内容が下書きとして保全され、再開時に復元できること | MUST | M1 |
| FR-9 | GitHub API のエラー（認証切れ・権限不足・レート制限・Issues 無効・spam 判定）を種類別にユーザーが理解できるメッセージで表示できること | MUST | M1 |
| FR-10 | PWA としてインストール可能であること（manifest・Service Worker・HTTPS・アイコン） | MUST | M1 |
| FR-11 | 利用規約・プライバシーポリシーのページを提供し、ログイン導線から参照できること | MUST | M1 |
| FR-12 | アカウント削除（本アプリ内データの全削除 + GitHub 側連携解除の案内）ができること | MUST | M1 |
| FR-13 | 直前に選択したリポジトリ・入力状態を記憶し、次回起動時に再現できること | SHOULD | M1 |
| FR-14 | push アクセスを持つリポジトリに対し、ラベルを選択して Issue に付与できること。push アクセスがない場合はラベル UI を出さない（silently dropped の防止） | MUST | M2 |
| FR-15 | URL パラメータ（例: `/new?repo=owner/name&labels=a,b`）でリポジトリ・ラベルが初期選択された状態で起票画面を開けること | MUST | M2 |
| FR-16 | ユーザーがショートカット設定（リポジトリ × ラベルのプリセット）を作成・編集・削除でき、対応する起動 URL を取得できること | MUST | M2 |
| FR-17 | manifest `shortcuts` に既定のショートカット（最大 3 個）を定義し、アイコン長押しメニューから起票画面を直接開けること | SHOULD | M2 |
| FR-18 | Web Share Target として共有シートに表示され、共有されたテキスト / URL をタイトル・本文にプレフィルできること（Android では URL が `text` に入るケースの抽出処理を含む） | MUST | M2 |
| FR-19 | プレフィル起動（FR-15 / FR-18）では自動送信せず、必ずユーザーの送信操作を要すること | MUST | M2 |
| FR-20 | スマート入力: 入力中の `#repo` `@label` トークンをインライン認識し、リポジトリ・ラベルを指定できること | SHOULD | M3 |
| FR-21 | メタデータ（リポジトリ・ラベル）をキーボード上部のチップ / ボトムシート UI で 1 タップ追加できること | SHOULD | M3 |
| FR-22 | オフラインまたはネットワーク失敗時、起票リクエストをキューに保存し、回復時に再送できること（4xx/5xx の API エラーは再送対象外とし FR-9 で処理） | SHOULD | M3 |
| FR-23 | 送信時に楽観的 UI で即時完了表示し、失敗時は下書き復元と再試行導線を提示すること | SHOULD | M3 |
| FR-24 | 同一内容の二重送信を防止できること（送信中の再タップ抑止 + サーバー側で直近送信内容（issue_log）との重複照合。GitHub API に冪等性キーがないため）。オフラインキュー再送との整合は M3（OQ-8）で扱う | MUST | M1 |
| FR-25 | TWA（Bubblewrap）として Google Play で配布できること。manifest shortcuts がネイティブ App Shortcuts に変換されること | MAY | M4 |
| FR-26 | 起票所要時間・成功率の計測イベント（プライバシーポリシー記載の範囲）を送出できること | SHOULD | M2 |

### 4.2 認証フロー（FR-1〜FR-4 詳細）

根拠: [認証アーキテクチャリサーチ](../research/2026-07-10-auth-architecture.md) §3・§4・§7。

1. `GET /auth/login`: Worker が `state`（ランダム 128bit 以上）と PKCE `code_verifier` を生成し、pre-auth Cookie（`__Host-` prefix・`HttpOnly; Secure; Path=/; SameSite=Lax`・TTL 10 分）に保存して GitHub の認可 URL（`code_challenge` S256 付き）へ **フルページリダイレクト** する。ポップアップ（`window.open`）は standalone PWA で壊れるため使用しないこと（MUST）。
2. GitHub 認可画面: 要求権限は Issues: write（+ 自動付与の Metadata: read）のみであること（MUST）。
3. `GET /auth/callback`: manifest `scope` 内の URL であること（MUST・in-app browser からの自動復帰のため）。Worker は pre-auth Cookie の `state` を検証し、`code` + `code_verifier` をサーバー側でトークンに交換する（`github.com/login/oauth/access_token` は CORS 非対応のためフロントエンドでの交換は不可）。
4. セッション確立: セッション ID（128bit 以上のランダム値）を `__Host-` セッション Cookie で発行し、サーバー側（D1）には **ハッシュのみ** 保存する。access / refresh トークンは AES-256-GCM（WebCrypto・マスターキーは Worker Secret・IV は毎回ランダム 96bit）で暗号化して保存する（MUST）。
5. トークンリフレッシュ: API 呼び出し時に期限切れ（8 時間）を検知したら refresh token（単回使用ローテーション）で更新する。並行リフレッシュによる失効を防ぐため、ユーザー単位で直列化すること（MUST。D1 上のロック行または Durable Object）。
6. App インストール誘導: 起票先リポジトリが「App インストール済み ∩ ユーザーがアクセス可」に含まれない場合、GitHub App のインストールページへ誘導する UX を提供すること（MUST）。GitHub App の Setup URL を本アプリに設定し、インストール / 承認完了後にアプリへ復帰させ、リポジトリ一覧を再取得すること（MUST・M1）。
7. Service Worker のナビゲーションフォールバックから `/auth/*` を除外すること（MUST。SW がコールバックをキャッシュ応答して認証が壊れる既知問題の回避）。

### 4.3 起票フロー（FR-5〜FR-9・FR-24 詳細）

1. 起票画面は認証済みなら起動直後に入力可能な状態で表示される。コールドローンチでのキーボード自動表示は Android では不可能なため、入力欄の初回タップを起点に同期的に `focus()` してキーボードを開く（「起動 → 1 タップ → キーボード」。詳細は §7.2）。
2. 送信は `POST /api/issues`（Worker が `POST /repos/{owner}/{repo}/issues` へプロキシ）。`X-GitHub-Api-Version: 2026-03-10` を pin し、assignee 単数パラメータは使用しないこと（MUST）。
3. 送信中は送信ボタンを無効化し（二重タップ防止）、サーバー側でも直近送信内容（リポジトリ + タイトル + 本文のハッシュ・短時間ウィンドウ・issue_log）と照合して重複起票を防ぐこと（MUST・FR-24）。オフラインキュー（FR-22）の再送との整合は M3 で設計する（OQ-8 の検討結果を反映）。
4. 成功（201）: Issue 番号と URL を含む完了表示を出し、下書きをクリアする。
5. 失敗: 入力内容を下書きとして保持したまま（MUST・FR-8）、エラー種別ごとに表示する（FR-9）。
   - 401 / トークン失効: 自動リフレッシュ → 失敗時は再ログイン導線（下書きはログイン往復後も復元）
   - 403 レート制限 / 二次制限: 「時間を置いて再試行」の案内（`Retry-After` 尊重・自動リトライはしない）
   - 404 / 権限不足: リポジトリアクセス・App インストール状態の確認導線
   - 410: 「このリポジトリは Issues が無効」と表示
   - 422: spam 判定を含むため **盲目リトライ禁止**（MUST）。内容の見直しを促す
   - ネットワーク失敗: M1 では手動再試行、M3 でオフラインキュー（FR-22）に接続

### 4.4 ショートカット起動フロー（FR-15〜FR-18 詳細）

1. `/new?repo={owner}/{repo}&labels={a,b}&title=&body=` を起動 URL の正とし、manifest shortcuts・ユーザー作成ショートカット・Web Share Target のすべてがこの URL 形式に合流すること（SHOULD・導線ごとの分岐を作らない）。
2. パラメータのリポジトリがユーザーのアクセス範囲外・App 未インストールの場合は、エラーではなく選択 UI + インストール誘導にフォールバックすること（MUST）。
3. ラベルパラメータは push アクセスがある場合のみ適用し、ない場合は UI 上で「付与されない」ことを明示すること（MUST・silently dropped 対策）。
4. Web Share Target は GET + クエリパラメータで受け、`text` フィールドに URL が入る Android の挙動に対応して URL 抽出を行うこと（MUST・FR-18）。
5. manifest shortcuts は 3 個上限・更新反映が約 24 時間周期であることを踏まえ、ユーザー個別のプリセットは manifest ではなく「ホーム画面に追加」用の URL 提供（FR-16）で無制限に作れるようにすること（SHOULD）。

## 5. 非機能要件

| ID | 分類 | 要件 | レベル |
|----|------|------|--------|
| NFR-1 | パフォーマンス | 再訪時（app shell precache 済み）の起動から入力可能まで 1 秒未満（サブ秒）であること。中位 Android 実機 + 4G 相当で計測（基準機: 開発者所有の中位 Android 実機。機種名は M0 で確定し本文書を更新） | MUST |
| NFR-2 | パフォーマンス | ショートカット起動から Issue 作成完了まで 10 秒以内（タイトルのみ 5 秒以内）・3 タップ以内で完了できること | MUST |
| NFR-3 | パフォーマンス | 初期バンドルを常に監視し、起票フローに不要なコードを遅延ロードすること（起動速度 > リッチ UI の優先順位）。初期ロード JS は gzip 後 200KB 以下を予算とする | SHOULD |
| NFR-4 | セキュリティ | 認可フローは state + PKCE S256 併用・フルページリダイレクトであること | MUST |
| NFR-5 | セキュリティ | Cookie は `__Host-` prefix + `HttpOnly; Secure; Path=/; SameSite=Lax` であること（`Strict` は OAuth コールバックで state 検証が壊れるため禁止） | MUST |
| NFR-6 | セキュリティ | セッション ID は 128bit 以上のランダム値とし、サーバー側にはハッシュのみ保存すること | MUST |
| NFR-7 | セキュリティ | GitHub トークンは AES-256-GCM でアプリケーション層暗号化して保存し、平文をログ・クライアントに出さないこと。鍵は Workers Secrets で管理すること | MUST |
| NFR-8 | セキュリティ | GitHub への要求権限を Issues: write のみに保ち、追加権限を要求しないこと（最小権限） | MUST |
| NFR-9 | セキュリティ | API は認証必須とし、CSRF 対策（SameSite + Origin 検証等）を備えること | MUST |
| NFR-10 | 可用性 | 送信失敗時に入力内容が失われないこと（下書き保全はリリースゲート） | MUST |
| NFR-11 | 可用性 | Cloudflare / GitHub の障害時にも、アプリ自体の状態（下書き・設定）が壊れず、障害である旨を表示できること | SHOULD |
| NFR-12 | アクセシビリティ | 主要フロー（ログイン・起票）がスクリーンリーダーとキーボードで操作可能で、タップターゲット 48dp 以上・コントラスト WCAG AA を満たすこと | SHOULD |
| NFR-13 | i18n | UI は日本語・英語の 2 言語に対応し、ブラウザ言語で初期選択・手動切替ができること | SHOULD |
| NFR-14 | コスト | Cloudflare 無料枠（Workers・D1 5M 行読取/日・100K 行書込/日・static assets 配信無料）内で運用できる設計であること。枠超過が近づいたら検知できること | MUST |
| NFR-15 | 運用 | 起票フロー（ログイン → 起票 → GitHub 反映）の E2E 確認なしに main へマージしないこと（CI ゲート） | MUST |
| NFR-16 | 互換性 | 一次サポートは Android Chrome（WebAPK）。デスクトップ / iOS ブラウザでも基本フロー（ログイン・起票）が動作すること | SHOULD |
| NFR-17 | プライバシー | 収集データはプライバシーポリシー記載の範囲に限定し、Issue 本文等のユーザーコンテンツを分析目的で保存しないこと | MUST |

## 6. システムアーキテクチャ

根拠: [Cloudflare 技術スタックリサーチ](../research/2026-07-10-cloudflare-stack.md)。

### 6.1 構成図

```text
[Android Chrome / ホーム画面ショートカット / 共有シート]
        │ HTTPS
        ▼
Cloudflare Workers（単一 Worker）
├── static assets: Vite + React SPA（PWA: vite-plugin-pwa / Workbox・SPA フォールバック）
├── API: Hono（/api/*, /auth/*）… run_worker_first
│     ├── GitHub App 認可（state + PKCE・トークン交換・リフレッシュ直列化）
│     └── Issue 作成プロキシ（POST /repos/{owner}/{repo}/issues・API version pin）
├── D1: users / sessions / tokens / shortcuts / issue_log
└── Workers Secrets: GitHub App client secret・トークン暗号鍵

開発: wrangler v4（wrangler.jsonc）/ TypeScript / @cloudflare/vitest-pool-workers
CI/CD: GitHub Actions（test → deploy）・デフォルトブランチ main
将来: TWA（Bubblewrap）で Play 配布（M4）
```

- 単一 Worker + static assets 構成であること（MUST）。Pages は採用しない（投資凍結）。
- セッション・トークンの保存先は D1 であること（MUST）。KV は結果整合・1 key 1 write/秒の制約により認証データには使用しない。リフレッシュ直列化に必要なら Durable Object をユーザー単位で導入してよい（MAY）。

### 6.2 データモデル案（D1）

| テーブル | 主な列 | 備考 |
|------|------|------|
| users | id (PK), github_user_id (UNIQUE), login, avatar_url, created_at, deleted_at | GitHub ユーザーと 1:1 |
| sessions | id_hash (PK), user_id (FK), created_at, expires_at, last_used_at | セッション ID はハッシュのみ保存 |
| tokens | user_id (PK/FK), access_token_enc, access_expires_at, refresh_token_enc, refresh_expires_at, updated_at | AES-256-GCM 暗号化・ユーザー単位 1 行（ローテーション直列化の単位） |
| shortcuts | id (PK), user_id (FK), name, repo_owner, repo_name, labels (JSON), position, created_at | ユーザー作成のショートカット設定（M2） |
| issue_log | id (PK), user_id (FK), repo, content_hash, created_at | 二重送信防止（FR-24）と成功率計測用の最小記録。タイトル・本文の平文は保存しない |

アカウント削除（FR-12）時は上記全テーブルの該当ユーザー行を削除すること（MUST）。

### 6.3 API エンドポイント一覧案

| メソッド / パス | 概要 | 認証 |
|------|------|------|
| GET /auth/login | 認可開始（state + PKCE 生成 → GitHub へリダイレクト） | 不要 |
| GET /auth/callback | コールバック。state 検証・トークン交換・セッション発行 | pre-auth Cookie |
| POST /auth/logout | セッション破棄 | 必要 |
| GET /api/me | ログインユーザー情報 | 必要 |
| GET /api/repos | 起票可能リポジトリ一覧（App インストール済み ∩ アクセス可・push 権限有無を含む） | 必要 |
| GET /api/repos/:owner/:repo/labels | ラベル一覧（M2） | 必要 |
| POST /api/issues | Issue 作成プロキシ（重複防止・エラー正規化を含む） | 必要 |
| GET/POST/PUT/DELETE /api/shortcuts | ショートカット設定 CRUD（M2） | 必要 |
| DELETE /api/account | アカウント削除（FR-12） | 必要 |

- トークンリフレッシュは専用エンドポイントを設けず、API 呼び出し時にサーバー側で透過的に行うこと（SHOULD）。
- エラーレスポンスは `{ error: { code, message } }` 形式に正規化し、FR-9 の表示分岐が code のみで行えること（SHOULD）。

## 7. 外部依存と制約

### 7.1 GitHub API 制約（[認証アーキテクチャリサーチ](../research/2026-07-10-auth-architecture.md) §2・§6）

| 制約 | 要件への反映 |
|------|------|
| labels / assignees / milestone は push アクセスがないと silently dropped（201 だが未反映） | 権限に応じた UI 表示制御（FR-14・§4.4-3）。「付けたつもりのラベルが付かない」を UI で防ぐこと（MUST） |
| レート制限: user token 5,000 req/h・二次制限 80 req/min・500 req/h（コンテンツ生成系） | 自動リトライで制限を悪化させない・`Retry-After` 尊重・ユーザーへの明示（FR-9）（MUST） |
| 422 は spam 判定を含む | 盲目リトライ禁止（MUST）。オフラインキューの再送対象からも除外（FR-22） |
| 冪等性キーなし → タイムアウト再送で重複起票リスク | 自前の重複防止（FR-24・issue_log）（MUST） |
| API バージョン 2026-03-10 で単数 assignee 廃止 | `X-GitHub-Api-Version: 2026-03-10` を pin（MUST） |
| user token の到達範囲は「App インストール済み ∩ ユーザーがアクセス可」 | 任意の公開リポジトリへは起票できない。オンボーディングでインストール誘導（FR-4）で吸収 |
| トークン: access 8h / refresh 6 ヶ月・単回使用ローテーション | 自動リフレッシュ + ユーザー単位直列化（FR-3）（MUST） |
| トークン交換エンドポイントは CORS 非対応 | トークン交換はサーバー側（Worker）実装（MUST） |

### 7.2 PWA / Android 制約（[モバイル UX リサーチ](../research/2026-07-10-mobile-ux-pwa.md)）

| 制約 | 要件への反映 |
|------|------|
| コールドローンチ時のキーボード自動表示は不可能（`autofocus` / `focus()` はジェスチャ外で無効） | 「起動 → 1 タップ → キーボード」を正式フローとする（§4.3-1）。KPI の 3 タップにこの 1 タップを含めて設計すること（MUST） |
| manifest shortcuts は最大 3 個・更新反映約 24 時間 | 既定ショートカットは 3 個以内（FR-17）。個人プリセットは URL ベース（FR-16）で提供（SHOULD） |
| Web Share Target で共有 URL が `text` に入る（`url` は空のことが多い） | text からの URL 抽出処理（FR-18）（MUST）。manifest 変更時は再インストールが必要な場合がある旨をリリースノートで案内（SHOULD） |
| standalone PWA でポップアップが壊れる / cross-origin 遷移は in-app browser | 認証はフルページリダイレクト・コールバックは manifest scope 内（§4.2）（MUST） |
| SW がコールバックをキャッシュすると認証が壊れる | ナビゲーションフォールバックから `/auth/*` を除外（§4.2-7）（MUST） |
| SW 起動コスト約 250ms（低速機 500ms+） | app shell precache でサブ秒（NFR-1）。認証依存の動的部分は navigation preload を検討（SHOULD） |
| Workbox Background Sync はネットワーク失敗のみ再送（4xx/5xx 対象外）・約 24h 保持 | オフラインキュー（FR-22）は API エラーと分離。24h 超の未送信は下書きへ戻す（SHOULD） |
| キーボードとボトムシートの共存 | `interactive-widget=resizes-content` を viewport に設定（M3・SHOULD） |
| クエリパラメータ付き複数ホーム画面ショートカットが WebAPK で開くかは未検証 | M2 で実機検証する（§10 オープンクエスチョン） |

### 7.3 Cloudflare 制約（[Cloudflare 技術スタックリサーチ](../research/2026-07-10-cloudflare-stack.md) §3）

- KV は結果整合（反映最大 60 秒超・ネガティブルックアップもキャッシュ）・1 key 1 write/秒・無料枠 1,000 writes/日 → 認証・トークン用途に使用しないこと（MUST）
- D1 無料枠（5M 行読取/日・100K 行書込/日・5GB）内に収まるアクセスパターンであること（NFR-14）
- 無料プランの Worker バンドルサイズ制限（3MiB）を超えないこと（MUST）

## 8. 一般公開に伴う要件

| ID | 要件 | レベル | MS |
|----|------|--------|----|
| PR-1 | 利用規約を公開し、無保証・自己責任・禁止行為（スパム起票等）・サービス変更/終了の可能性を明記すること | MUST | M1 |
| PR-2 | プライバシーポリシーを公開し、収集データ（GitHub アカウント情報・暗号化トークン・ショートカット設定・最小限の計測イベント）・保存先（Cloudflare）・保持期間・削除方法を明記すること | MUST | M1 |
| PR-3 | アカウント削除機能（FR-12）で本アプリ側データを即時削除し、GitHub 側の連携解除（App の authorization 取消・インストール削除）の手順を案内すること | MUST | M1 |
| PR-4 | 不正利用対策: 本アプリ経由の起票にアプリ側レート制限（例: ユーザーあたり分間・時間あたり上限）を設け、GitHub の二次制限（80 req/min）より十分低く抑えること | MUST | M1 |
| PR-5 | 不正利用対策: 422（spam 判定）が続くユーザーを検知し、一時的に送信を抑止できること | SHOULD | M2 |
| PR-6 | GitHub App を公開設定（public）にし、App の説明・権限理由・ホームページ URL・プライバシーポリシー URL を整備すること | MUST | M1 |
| PR-7 | 問い合わせ・不具合報告の導線（GitHub リポジトリの Issues 等）を提供すること | SHOULD | M1 |
| PR-8 | すべての利用者に GitHub 認可を必須とし、匿名での API 利用経路を持たないこと（責任追跡性） | MUST | M1 |

## 9. リスクと対応方針

| リスク | 影響 | 対応方針 |
|------|------|------|
| GitHub 公式がモバイル起票 UX を改善し優位性が薄れる | 中 | 速度（サブ秒起動・3 タップ）とショートカット無限作成の差別化を維持。実用ツール / OSS として価値が残る設計（市場リサーチ §4） |
| リフレッシュトークンの並行更新で失効 → 強制再ログイン多発 | 高 | ユーザー単位直列化（FR-3）を M1 の必須要件とし、E2E テストで並行リフレッシュを検証 |
| 悪用（スパム起票）で GitHub App が制裁・停止される | 高 | PR-4 / PR-5 / PR-8。422 の監視と自動抑止。App 停止は全ユーザー影響のため最優先で防ぐ |
| クエリパラメータ付きホーム画面ショートカットが WebAPK で開かない | 中 | M2 冒頭で実機検証。ダメなら manifest shortcuts（3 個）+ アプリ内切替 + 共有シートで代替 |
| 無料枠（D1 書込 100K/日等）超過 | 低 | NFR-14。issue_log 等の書込を最小化・使用量アラートを設定 |
| manifest 更新（shortcuts / share_target）が既存インストールに反映されない・遅延 | 中 | manifest 変更を伴うリリースは検証項目化し、再インストール案内を用意（§7.2） |
| Cloudflare / GitHub の仕様変更（API バージョン・トークン仕様） | 中 | API バージョン pin + 変更検知（deprecation ヘッダの監視）。リサーチ文書の日付を根拠に定期見直し |
| 一人開発 + 自律エージェント開発での品質劣化 | 中 | NFR-15（E2E ゲート）とドメイン品質ゲート（project-mission.md）を CI で強制 |
| Organization リポジトリで非管理者のインストールが承認待ちとなり、初回セットアップが中断する | 中 | FR-4 の案内表示で承認待ちである旨を明示し、承認完了後は Setup URL（§4.2-6）でアプリへ復帰・リポジトリ一覧を再取得させる |

## 10. 未決事項（オープンクエスチョン）

| # | 事項 | 期限の目安 |
|---|------|------|
| OQ-1 | クエリパラメータ付き「ホーム画面に追加」ショートカットのタップ時挙動（standalone WebAPK かブラウザタブか）の実機検証 | M2 着手時 |
| OQ-2 | 認証ライブラリの最終選定: 手書き fetch + `hono/cookie` か `@octokit/auth-oauth-user`（自動リフレッシュ内蔵）か | M1 実装開始時 |
| OQ-3 | リフレッシュ直列化の実装方式: D1 行ロックで足りるか、ユーザー単位 Durable Object を導入するか | M1 実装開始時 |
| OQ-4 | 計測イベント（FR-26）の実装方式: 自前 D1 集計か Workers Analytics Engine か。プライバシーポリシー文面との整合 | M2 |
| OQ-5 | i18n（NFR-13）の初期リリース範囲: M1 から 2 言語か、M1 は日本語のみで M2 から英語追加か | M1 スコープ確定時 |
| OQ-6 | アプリ側レート制限（PR-4）の具体値（分間 / 時間あたり上限）と実装層（Worker ミドルウェア） | M1 実装開始時 |
| OQ-7 | カスタムドメインの選定。本番 URL は workers.dev サブドメインで暫定開始し、M1 の一般公開前にカスタムドメインへ移行する（GitHub App のコールバック URL / Setup URL の更新を含む）。`__Host-` Cookie と TWA（Digital Asset Links）はドメイン確定が前提 | M1 公開前 |
| OQ-8 | オフラインキュー（FR-22）採用時の重複防止（FR-24）との整合: キュー再送を issue_log 照合とどう組み合わせるか | M3 設計時 |
| OQ-9 | セッション TTL の設計（案: refresh token の 6 ヶ月に揃え、失効時は再ログイン誘導。アイドル失効は設けない） | M1 実装開始時 |
| OQ-10 | GitHub App の表示名・公開名（ユーザーに見える名称） | M1 公開前 |

## 11. 関連ドキュメント

- [プロジェクトミッション](../project-mission.md) — ミッション・KPI・判断基準
- [README.md](./README.md) — 要件定義ドキュメント一式の構成・決定事項
- [01-lean-canvas.md](./01-lean-canvas.md) — リーンキャンバス
- [02-inception-deck.md](./02-inception-deck.md) — インセプションデッキ
- [03-user-story-map.md](./03-user-story-map.md) — ユーザーストーリーマップ
- [04-milestones.md](./04-milestones.md) — マイルストーン計画
- リサーチ（2026-07-10 実施）
  - [認証アーキテクチャ](../research/2026-07-10-auth-architecture.md) — GitHub App・トークン仕様・OAuth セキュリティ・GitHub API 制約
  - [Cloudflare 技術スタック](../research/2026-07-10-cloudflare-stack.md) — Workers / D1 / ツーリング・無料枠
  - [モバイル UX / PWA](../research/2026-07-10-mobile-ux-pwa.md) — キーボード制約・ショートカット導線・オフラインパターン
  - [市場・競合](../research/2026-07-10-market-competitors.md) — 競合分析・ユースケース実態・差別化
