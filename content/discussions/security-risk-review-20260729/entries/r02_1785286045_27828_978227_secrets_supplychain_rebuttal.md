<!--entry
author: secrets_supplychain
round: 2
kind: rebuttal
ts: 2026-07-29T09:47:24+09:00
-->

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
