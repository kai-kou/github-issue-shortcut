/**
 * 全レスポンスに付与するセキュリティヘッダー（#209）。
 *
 * 既知の脆弱性を塞ぐための実装ではない。セキュリティレビュー（#204）で `src/` 配下に
 * `dangerouslySetInnerHTML` が 1 件も無く、`prefillParams` 由来の値も含めてすべて React の
 * エスケープを通ることを確認済みで、XSS の実弾はゼロだった。ここで用意するのは
 * **依存ライブラリ経由の DOM XSS のような将来の回帰に対する最後の砦**（多層防御）。
 *
 * 🔴 **`public/_headers` と二重管理になっている点に注意**。
 * 静的アセット（`index.html` / JS / CSS）は Worker を経由せず Cloudflare の asset server が
 * 直接返す（`wrangler.jsonc` の `run_worker_first` が `/api/*` `/auth/*` `/setup` だけを Worker に
 * 回す）ため、**ページ本体の CSP は `_headers` でしか付けられない**。逆に Worker が返す
 * JSON・リダイレクトには `_headers` が効かない。片方だけ直すと守れない経路ができるので、
 * 値を変えるときは必ず両方を更新すること（`worker/securityHeaders.test.ts` が一致を機械検証する）。
 */

export const CONTENT_SECURITY_POLICY = [
  // 既定はすべて同一オリジン。ビルド成果物にインライン script / style は無く
  // （`dist/client/index.html` は外部 JS / CSS への参照と `/registerSW.js` だけ）、
  // `'unsafe-inline'` を一切許可せずに済む構成になっている。
  "default-src 'self'",
  // `<base>` を差し込んで相対 URL の解決先を奪う攻撃を防ぐ。
  "base-uri 'self'",
  // フォームの送信先を同一オリジンに固定する。
  "form-action 'self'",
  // クリックジャッキング対策（`X-Frame-Options: DENY` の後継）。埋め込みを一切許可しない。
  "frame-ancestors 'none'",
  "object-src 'none'",
  // アバター画像だけは外部ホストから読む（`GET /api/me` が返す GitHub の `avatar_url`）。
  // `data:` は Vite が小さなアセットをインライン化した場合に備える。
  // 注: E2E のモックアバター（`http://localhost:8788/avatar.png`）はこの許可リストに載らず
  // ブロックされるが、そもそも 404 を返す設計（`e2e/mock-github.mjs`）なので挙動は変わらない。
  // README 用スクリーンショット（`e2e/screenshots.spec.ts`）だけは差し替え画像を表示する必要が
  // あるため、当該 spec が `bypassCSP` を有効にしている。
  "img-src 'self' data: https://avatars.githubusercontent.com",
].join("; ");

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  // Content-Type を無視した MIME スニッフィングによる誤実行を防ぐ。
  "X-Content-Type-Options": "nosniff",
  // `frame-ancestors` を解さない古いブラウザ向けの保険（CSP と重複するが害はない）。
  "X-Frame-Options": "DENY",
  // 共有シート経由の `/new?title=...&body=...` には利用者が書いた Issue の本文が載る。
  // 外部サイトへ Referer として漏らさないよう、送出を同一オリジンに限定する。
  "Referrer-Policy": "same-origin",
};
