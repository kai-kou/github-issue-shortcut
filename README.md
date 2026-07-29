# GitHub Issue Shortcut

[![CI](https://github.com/kai-kou/github-issue-shortcut/actions/workflows/ci.yml/badge.svg)](https://github.com/kai-kou/github-issue-shortcut/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8.svg)](https://github-issue-shortcut.kinamocchi-tech.workers.dev)

**「思いついた瞬間」を逃さない。ホーム画面をタップして数秒で GitHub に Issue を立てる、Android 向けの PWA です。**

> **In English**: An Android PWA that turns a home-screen tap into a GitHub issue in seconds — sign in with GitHub, no personal access token needed. The app ships in Japanese and English; this README is Japanese only.

PAT（個人アクセストークン）の発行も管理も不要 — GitHub でログインするだけ。ショートカットがリポジトリとラベルを覚えているので、タップした時点で入力欄にカーソルが立っています。

**サーバーはあなたのデータを保存しません。** GitHub のトークンは暗号化した Cookie としてあなたの端末に置かれ、サーバーはリクエストのたびに復号して GitHub へ中継するだけです（データベースを持っていません）。ただし「ログを一切取っていない」わけではなく、Cloudflare 基盤側に例外ログが 5% サンプリングで最長 3 日残ることがあります。

👉 **[アプリを開く](https://github-issue-shortcut.kinamocchi-tech.workers.dev)**

要求する権限は **Issues の読み書きのみ**（ほかに GitHub が自動付与する Metadata の読み取りが付きます）。コードには一切アクセスしません — 実際に要求される権限は GitHub のインストール画面でご自身で確認できます。個人開発の OSS を Cloudflare Workers 上で運用しているため、可用性は保証していません。利用前に [プライバシーポリシー](https://github-issue-shortcut.kinamocchi-tech.workers.dev/privacy) と [利用規約](https://github-issue-shortcut.kinamocchi-tech.workers.dev/terms) を、データの扱いは「[安全性・データの扱い](#安全性データの扱い)」をご確認ください。

| ログイン | 起票フォーム | スマート入力（`@` でラベル候補） |
|---|---|---|
| <img src="docs/assets/screenshots/login.png" alt="GitHub でログインするだけで使い始められるトップ画面" width="240"> | <img src="docs/assets/screenshots/issue-form.png" alt="リポジトリとラベルを選んで Issue を起票する画面" width="240"> | <img src="docs/assets/screenshots/smart-input.png" alt="タイトル欄に @ を打つとラベル候補がインライン表示される画面" width="240"> |

## なぜ作ったか

GitHub Issues でタスクやアイデアを管理していると、**思いついた瞬間にスマホから書き留める** のが一番難しくなります。

- GitHub 公式アプリは起票まで **3〜4 タップ + 4 画面** かかり、ホーム画面からの直行導線がない
- `issues/new` のプレフィル URL をショートカットにする手はあるが、公式アプリがリンクを横取りしてプレフィルを落とすことがある
- HTTP Shortcuts 等で自作すると動くが、**PAT の手動発行・管理** が最大の摩擦になる
- iOS には専用アプリが複数あるのに、**Android × PWA でワンタップ起票できるツールは調べた限り見当たらない**

そこで「ホーム画面タップ → 数秒で起票」だけに特化した PWA を作りました。競合調査の詳細は [市場・競合リサーチ](docs/research/2026-07-10-market-competitors.md) にあります。

## 使い始めるまで

1. **GitHub でログインする** — [アプリを開く](https://github-issue-shortcut.kinamocchi-tech.workers.dev) と GitHub の認可画面に進みます
2. **起票したいリポジトリに GitHub App をインストールする**（初回のみ） — Organization のリポジトリでは、管理者でない場合はインストール申請となり承認待ちになることがあります
3. **ホーム画面に追加する** — Android Chrome のメニュー（⋮）→「アプリをインストール」、またはアドレスバーのインストールアイコンをタップします
4. **アイコンをタップして起票する** — 以降はホーム画面から直行できます

## できること

- **GitHub ログインだけで使える** — 要求する権限は上記のとおり Issues の読み書きのみです
- **ショートカット起動** — `/new?repo=owner/name&labels=bug&title=雛形` でリポジトリ・ラベル・タイトルを初期選択した状態で開けます。保存したショートカットはいくつでも作れ、ホーム画面上部の「保存済みショートカット」一覧からタップして開きます（この URL を単体でホーム画面のアイコンにした場合、Android の仕様で初期選択は反映されません）
- **アイコン長押しメニュー** — よく使うプリセットを最大 3 個、PWA のショートカットとして登録できます
- **共有シートから起票** — Android の共有シートに本アプリが出ます。記事の URL を共有すれば本文にプレフィルされます
- **スマート入力** — タイトル欄に `#repo` `@label` と打つとインラインで候補が出て、そのまま指定できます
- **ラベル権限の事前警告** — push 権限のないリポジトリではラベルが黙って捨てられるため、送信前に警告します
- **オフラインでも書ける** — 圏外での起票はキューに保存され、次にアプリのホーム画面を開いたときに自動で再送されます。再送の対象はネットワーク接続の失敗のみで、24 時間送信できないままだと自動再送は止まり、アプリ内の一覧から手動で再送・破棄します（同一内容の連続送信は抑止しますが、送信がサーバーに届いた後で応答が端末に返らなかった場合など、ごく稀に重複作成されることがあります）
- **送信に失敗しても入力は消えない** — 下書きを端末内に保全します
- **日本語 / English** の 2 言語対応

## 安全性・データの扱い

- **トークンの保管** — GitHub のトークンは暗号化した HttpOnly Cookie として端末に置かれ、JavaScript からは読めません。有効期限は最長 30 日で、リフレッシュしても延長されません
- **権限の取り消し** — ログアウト・アカウント削除のどちらでも GitHub 側のトークンを失効させます（アカウント削除は加えて端末内のデータを消します）。アプリを経由せず GitHub の [Authorized GitHub Apps](https://github.com/settings/apps/authorizations) から連携を解除することもできます
- **設計と裏取り** — サーバーが何も保存しない仕組みは [ステートレス化設計](docs/design/stateless-architecture.md)、保持データの全数棚卸しは [データ保持インベントリ](docs/research/2026-07-28-data-retention-inventory.md) にあります

## 目指している速さ

以下は本プロジェクトが目標としている値です（[プロジェクトミッション](docs/project-mission.md) の KPI と同一）。実測値ではありません。

| 指標 | 目標 |
|------|------|
| 起票所要時間（起動 → 作成完了） | 10 秒以内（タイトルのみなら 5 秒以内） |
| 起票までのタップ数（ショートカット起動時） | 3 タップ以内 |
| 起票成功率 | 99% 以上（失敗しても入力内容を失わない） |
| 初回セットアップ（ログイン → 初起票） | 5 分以内 |

## 技術構成

| レイヤー | 採用技術 |
|---------|---------|
| フロントエンド | Vite + React 19（SPA / PWA） |
| API | Hono（Cloudflare Workers 上で動作） |
| ホスティング | Cloudflare Workers（単一 Worker 構成） |
| 認証 | GitHub App（OAuth）+ 暗号化 HttpOnly Cookie |
| データ | 端末内（localStorage / IndexedDB）のみ。**サーバーは永続層を持たない**（D1 / KV / R2 / Durable Objects のいずれも使っていません） |
| CI | GitHub Actions（テスト・型チェック・E2E・Lighthouse） |
| デプロイ | Cloudflare Workers Builds（Git 連携・キーレス） |

サーバーが何も保存しない設計とデータの保持範囲は「[安全性・データの扱い](#安全性データの扱い)」からたどれます。

## 開発

```bash
npm ci             # 依存インストール
npm run dev        # ローカル開発サーバー（Vite）
npm run build      # 型チェック（tsc -b）+ ビルド
npm test           # ユニットテスト（vitest / @cloudflare/vitest-pool-workers）
npm run e2e        # E2E テスト（Playwright・GitHub API はモック）
```

デプロイは Cloudflare Workers Builds（Git 連携）が担当します。要件・アーキテクチャの詳細は [`docs/requirements/`](docs/requirements/) を参照してください。

## AI エージェントによる自律開発運用

本リポジトリは **Claude Code による自律開発運用**（[claude-code-base](https://github.com/kai-kou/claude-code-base) 由来のルール・スキル・ハーネス）を採用しています。Issue の起票から実装・レビュー・PR のマージまでの多くの工程を AI エージェントが自律実行しており、その運用ルール自体もリポジトリ内で管理しています。

- [`CLAUDE.md`](CLAUDE.md) — エージェントへの運用指示（大原則・確認境界・PR フロー）
- [`docs/rules/`](docs/rules/) — ルールの実体（自律運用ポリシー・レビュー体制・教訓集）
- [`content/discussions/`](content/discussions/) — 設計判断を専門エージェント同士が議論した記録

仕組みそのものに興味がある方は、こちらもご覧ください。

## ドキュメント

- [プライバシーポリシー](https://github-issue-shortcut.kinamocchi-tech.workers.dev/privacy) / [利用規約](https://github-issue-shortcut.kinamocchi-tech.workers.dev/terms) — 利用者向け
- [セキュリティポリシー](SECURITY.md) — 脆弱性の報告方法
- [要件定義](docs/requirements/) — FR / NFR・アーキテクチャ・マイルストーン計画（開発者向け）
- [プロジェクトミッション](docs/project-mission.md) — ミッション・KPI・判断基準
- [リサーチ](docs/research/) — 認証・技術スタック・市場調査・公開リスク

## ライセンス

[MIT License](LICENSE) の下で公開しています。
