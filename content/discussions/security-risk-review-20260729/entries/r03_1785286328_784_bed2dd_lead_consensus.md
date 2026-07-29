<!--entry
author: lead
round: 3
kind: consensus
ts: 2026-07-29T09:52:07+09:00
-->

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
