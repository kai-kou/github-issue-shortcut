<!--entry
author: correctness
round: 2
kind: rebuttal
ts: 2026-07-29T11:56:34+09:00
-->

## correctness — Round 2（他観点への応答）

### security 指摘 1（HSTS 未設定）→ スコープ外判定に同意（concession ではなく合意）

correctness の観点からは、HSTS 欠落は **本 PR が導入した新規ロジックの誤動作ではない**（既存挙動に対する回帰でも、差分内の分岐網羅漏れでもない）。security 自身が non-blocking と結論しているとおり、`__Host-` prefix Cookie が HTTPS 必須である点で実害は初回平文アクセス窓に限定される。correctness としてもこれを blocking にする根拠はなく、**別 Issue（#209 の追加改善）へ切り出す判定に同意** する。この PR の主張（① auth/login レート制限 ② セキュリティヘッダー ③ Actions SHA 固定 ④ ポリシー文言整合）はいずれも HSTS の有無に依存しない独立した主張であり、スコープを広げて blocking にする理由がない。

### security 指摘 2（/64 丸めは /56 攻撃者に不十分）→ critical 格上げに反対

round 1 で `clientIpBucket` を実地検証した結果、この関数は **コメントで自己申告している設計方針どおりに正確に動作している**（/64 境界での丸めのみを行い、それ以上は約束していない）。correctness の判定基準は「コードが意図した契約を満たしているか」であり、この関数は契約を満たしている。`/56`〜`/48` 割当を持つ攻撃者による分散が理論上可能である点は **設計上のトレードオフであって実装のバグではない**。既存の Cloudflare ゾーン Rate Limiting Rule も同じ /64 粒度を既定にしているという security の指摘は、この粒度が業界標準的な妥協点であることを裏付けており、correctness の立場からも「バグ」ではなく「今後の拡張余地」に分類すべきと判断する。critical 昇格には反対（security 自身の結論と一致）。

### simplicity 指摘（`stubLimiter` / `keyCapturingLimiter` の重複）→ 実害なしで合意（concession 寄り）

round 1 で両関数の実装を確認した限り、どちらも `RateLimit.limit()` のシグネチャを正しく満たし、`keys` 配列へのキー記録も正しく行っている。**テストの正しさ（correctness）には影響しない** — 重複していても両者は独立に正しく動作し、既存テストは両方とも意図どおりパスしている。ただし 1 点だけ correctness 寄りの注意を追加する: `stubLimiter(success, keys=[])` は成否を引数で切り替え可能な一方、`keyCapturingLimiter(keys)` は常に `success: true` 固定であるため、**将来どちらかを片方の代替として安易に統合すると、429 系テスト（`stubLimiter(false)` を使うテスト）が暗黙に `success: true` に変わって検知漏れを起こすリスク** がある。simplicity の提案どおり 1 つの factory に統一すること自体には反対しないが、統合時は `success` パラメータを必須にして両方の呼び出し箇所を明示的に書き換える形にすべきで、デフォルト値で暗黙に片方の意味を変えないよう注意を添える。現状の重複自体は実害のある欠陥ではない。

## 結論（correctness としての最終判定）

- HSTS: blocking にしない（別 Issue でよい）
- /64 vs /56: critical にしない（設計契約どおりの実装であり、コードのバグではない）
- stub 重複: 実害なし。simplicity の統合提案に賛成するが、統合時のテスト意味論の保持を注意点として付記する
