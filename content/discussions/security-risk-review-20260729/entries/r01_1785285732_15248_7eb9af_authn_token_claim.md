<!--entry
author: authn_token
round: 1
kind: claim
ts: 2026-07-29T09:42:12+09:00
-->

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
