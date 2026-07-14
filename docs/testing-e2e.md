# E2E テスト方針（OAuth ログインフロー）

> NFR-15（起票フローの E2E 確認）に対する E2E 自動化の分担。Issue #52。

## 何を自動化したか（クラウド CI で自動実行）

**Playwright（Chromium・Pixel モバイルエミュレーション）+ モック GitHub OAuth** で、
ログインフロー全体を実コード（ブラウザ ↔ Worker ↔ D1）で検証する。実 GitHub には触れない。

- 対象: `/auth/login`（state + PKCE 生成）→ 認可（モック）→ `/auth/callback`（トークン交換・
  ユーザー取得・トークン暗号化保存・セッション Cookie 発行）→ `/api/me`（ログイン表示）→ `/auth/logout`。
- 構成:
  - `wrangler dev` がビルド済み SPA + Worker + ローカル D1（`migrations/` 適用）を配信。
  - `e2e/mock-github.mjs` がモック IdP（authorize / access_token / user）を提供。
  - Worker の `GITHUB_OAUTH_BASE` / `GITHUB_API_BASE`（`worker/github.ts` で差し替え可能・
    既定は実 GitHub）をモックに向ける。本番挙動は変えない。
- 実行: `npm run e2e`（`playwright.config.ts` の webServer が上記を起動）。CI は `.github/workflows/ci.yml` の `e2e` ジョブ。
- ローカル実行はプリインストール Chromium を `E2E_CHROMIUM_PATH` で指定可能。

### なぜモック IdP か（リサーチ根拠・#52）

OAuth E2E のベストプラクティスは「フィーチャーテストは常にモック IdP、実プロバイダテストは
PR ゲート外でスケジュール実行」。実 GitHub OAuth をブラウザ自動化すると、CI 環境の IP / UA /
headless シグナルで bot 検知・2FA が誘発され不安定になるため、PR ゲートには入れない。

## どうしても実機手動が残る範囲

以下は実機 Android またはアカウント権限が物理的に必要なため自動化対象外（NFR-15 の手動確認）:

- **実機 Android の PWA 固有挙動**: ホーム画面追加（WebAPK）・standalone 表示での
  Chrome Custom Tab 経由の OAuth リダイレクト往復（#21 の PWA 化と併せて確認）。
- **実 GitHub アカウントでの認可**: 本番 URL での実ログイン（`docs` / Issue #14 の手順）。

Android エミュレータを CI で動かす方法（`reactivecircus/android-emulator-runner`）も存在するが、
native アプリ instrumentation 向けで PWA/WebAPK の standalone OAuth 検証は重く前例が薄いため、
費用対効果で採用しない（実機手動に委ねる）。

## 参照

- `playwright.config.ts` / `e2e/login.spec.ts` / `e2e/mock-github.mjs`
- `docs/requirements/00-requirements.md` NFR-15・§4.2
- Issue #52・#14
