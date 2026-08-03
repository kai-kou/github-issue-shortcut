<!--entry
author: delivery-security
round: 2
kind: rebuttal
ts: 2026-08-03T10:21:51+09:00
-->

## delivery-security Round 2: 4 点に応答

### ① fetch vs 焼き込み → **dashboard-ux / data-pipeline に同意して決着（自分の Round 1 案を修正）**

**結論: ビルド時（ルーティン実行時）焼き込み。クライアントの `raw.githubusercontent.com` fetch は不採用。**

- data-pipeline §5 が既に明言済み: 「ページ配信時に WAE を直接叩かない（トークンをクライアントに渡さないため必須）」「ビルド時にデータブランチ 2 本を読んで静的生成」。dashboard-ux も `site/` は「静的スナップショット・JS 依存ゼロ」前提で設計済み。両者の結論は client fetch を要求していない。
- 技術的にも fetch 案は不要なコストしか生まない: `raw.githubusercontent.com` は ACAO:* で CORS 自体は通るが、①GitHub 側 CDN のキャッシュ遅延を制御できない ②匿名 fetch は GitHub 側のソフトレート制限の対象になりうる（低トラフィックでは実害薄いが、焼き込みなら **そもそも発生しない失敗モード**）。JS 依存ゼロ設計と両立しない（fetch には最低限の JS が要る）ため、client fetch は「勝る点が無いのに攻撃面と失敗モードだけ増える」選択。**Round 1 の自分の記述（データブランチを「ダッシュボードから取得」）を撤回し、焼き込み案に一本化する。**
- **Round 1 で自分が懸念した「案 A の main 汚染リスク」との整合**: あの懸念は「生の運用テレメトリ（コスト実額・素データ）が main に混ざる」ケース（#189/#202 型事故）に対するもの。今回は逆で、**そもそも公開が目的の集計値**（data-pipeline が index/blob 設計で既に「事故らない」形に絞り込み済み）を `site/` に置く。`site/` は元々 public 公開前提のディレクトリなので、ここに置くこと自体は事故ではない。**ただし焼き込み元の生データは引き続き隔離データブランチ（`telemetry/worker-usage` 系）に置き、`site/` に入るのは「安全な集計値だけ」というレイヤー分離を維持する**（privacy-identity の index 設計・data-pipeline の「blob2=prod フィルタ」等の前工程を経た値のみが site/ に到達する、という順序を Child C の Done Criteria に明記すべき）。
- **新たな指摘（A-1 との整合・要 scope-delivery 確認）**: `site/` は `main` 上にあり `pages.yml` は `push: main` 起動。**ルーティンが `site/` を直接 `main` へ push することはできない（A-1: main 直接 push 禁止・境界外リスト）**。データブランチへの `--push`（`record_worker_usage.py` 系）は main ではないため A-1 の対象外だが、**焼き込み後の `site/` 更新は他の自動変更と同じく「作業ブランチ → PR → セルフレビュー → 自動マージ」を通す必要がある**（既存の完全自律 PR フローでユーザー作業は発生しないので CP-6 的には問題ないが、更新頻度＝PR 頻度になる点は scope-delivery の見積もりに反映すべき）。

### ② `site/` の CSP 未整備 → **Epic スコープに含める。ただし Child C への小さな追記として（新規 Issue 不要）**

①の決着（焼き込み・fetch なし）により、当初懸念した「`connect-src` を外部ホストへ許可する必要」は**消滅**（実行時 fetch が無いので許可すべき外部接続先が無い）。それでも `site/` に `_headers` が一つも無い状態（今回確認済み）は放置すべきでない一般的な穴なので、**`public/_headers`（Worker 側 SPA）と同水準の最小 CSP（`default-src 'self'; connect-src 'none'` 相当・外部接続不要を明示）を `site/_headers` に新設**することを推奨する。これは 1 ファイル追加で完結する小粒な変更であり、別 Issue に切り出すほどの規模ではない（YAGNI・過剰なプロセス分割を避ける）。**scope-delivery の Child C（ダッシュボード最小版）の Done Criteria に 1 行追加**する形が最も軽い。担当は Child C を実装するセッション。

### ③ ルーティン依存の鮮度は完了条件を満たすか → **満たす。ただし Step 1.6 の「無条件実行」性質に依存させること**

- `docs/routines/sprint-session.md` Step 1.6 は `session-sprint-rules.md`「対象がないセッションは no-op」の対象外（既存の `record_worker_usage.py` 呼び出しは Sprint の作業有無に関わらず毎回実行される想定の運用行程）。WAE 取り込みも **同じ Step 1.6 に相乗り**させ、「今日やる Issue があるか」に鮮度を左右させない設計であれば、スケジュール（Routine の cron）が回っている限り人手なしで更新され続ける。「セッションが走らない日はデータが更新されない」問題は Routine 自体が止まっている場合（サブスクリプション停止等・D 区分の外部要因）にしか発生せず、これは `record_worker_usage.py` 系の既存運用と同一のリスクで、**本 Epic 固有の新規リスクではない**。
- dashboard-ux の「最終更新: {JST}（静的スナップショット・自動更新なし）」バッジが、鮮度低下時も嘘をつかない設計として既に効いている。**完了条件としては「Routine が走れば人手なしで最新化される」で十分**であり、「常にリアルタイム」は要求されていない（案 C＝ライブクエリを却下した Round 1 の結論と整合）。

### ④ 供給経路の実装はどの子 Issue か → **Child C に明示的に帰属。Child B は「データブランチまで」に限定**

scope-delivery の分割案は Child B を「取得ツール + テレメトリブランチ履歴化」、Child C を「ダッシュボード最小版」としているが、**「データブランチの集計値を `site/` へどう届けるか（焼き込みロジック）」は Child C 側に明記すべき**（Child B はデータ生成・隔離までが責務、Child C は「隔離データ → 公開表示」の変換・配信層を持つ、という境界）。Child C の Done Criteria に以下を追記することを提案:
- [ ] データ供給はビルド時（ルーティン実行時）の静的焼き込みのみ。クライアント実行時の fetch（`raw.githubusercontent.com` 等）・WAE 直接クエリを行わないことをコードレビューで確認
- [ ] `site/` への反映は他の自動変更と同じく PR 経由（A-1 準拠）で行われることを確認
- [ ] `site/_headers` に最小 CSP（`connect-src` 不要を明示）を追加

以上で 5 レンズの主要な相違点（fetch vs 焼き込み・CSP のスコープ・鮮度・帰属 Issue）は自分の観点からは解消。scope-delivery の Child A（privacy-identity の index 設計 consensus 待ち）着手可否のみ、自分のレンズ外なので判断を委ねる。
