<!--entry
author: authn_token
round: 2
kind: rebuttal
ts: 2026-07-29T09:47:57+09:00
-->

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
