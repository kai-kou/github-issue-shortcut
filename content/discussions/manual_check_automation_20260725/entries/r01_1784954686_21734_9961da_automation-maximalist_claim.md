<!--entry
author: automation-maximalist
round: 1
kind: claim
ts: 2026-07-25T13:44:46+09:00
-->

## 結論（先出し）: チェックリスト 1〜6 は既に自動化済み。追加投資すべきは「4 の残余」「7 の回帰ガード」「オフライン重複」「SW config regression」の 4 点のみで、いずれも新規ツール・新規依存を要さない小改修で足りる。それ以外（display-mode スタブ・CDP 生キー・SW ランタイム単体テスト・チェックリスト自動生成ツール）は自ら切り捨てる。

### 現状把握（lead メモとコード読了）
- `e2e/smart-input.spec.ts` が既にチェックリスト 1(#repo 絞り込み/L211-245)・2(タイトル引き継ぎ/L244)・3(@b 候補/L78-83)・4 前半(候補タップ確定+ラベル ON/L85-94)・5(確定後に候補が消える/L88-89)・6(チップ解除で連動解除/L104-138, 171-209) を機械アサート済み。「未カバーの切り分け」で残るのは **4 の後半（キーボードが閉じない）だけ**。
- `e2e/kpi.spec.ts` は既に起動→起票完了の外形計測 PoC を持つが、docstring で「WebAPK/standalone のコールドスタート・実機ソフトキーボード遅延は含まない」と明記済み（自己認識済みの下限値監視）。現在の閾値は 10s（NFR-2 参考値）で、Issue の 5s 基準そのものではない。
- `e2e/offline-queue.spec.ts` は「オフラインでキュー→復帰後自動送信→キュー表示消滅」を検証するが、**GitHub 側の作成回数を数えて重複なしを直接主張してはいない**（キュー表示が消えたことの間接証拠のみ）。`vite.config.ts`（L131-149）に実体のある Workbox `BackgroundSyncPlugin`（"issue-post-queue"）の **設定自体を壊れたら検知する仕組みがゼロ**。
- `src/` を grep した結果、`display-mode: standalone` を分岐条件にしているアプリコードは存在しない（ヒットは翻訳文字列 1 件のみ）。Enter キー/keydown でラベル候補を確定するコードも存在しない（候補確定はタップ＝click のみ）。

---

### ① 追加すべき自動化（優先順・ファイル・テスト名・実装方針）

**P1-1（最小コスト・即着手）**: `e2e/smart-input.spec.ts` の `"@ の入力中はラベル候補が表示され、タップで確定してラベルに反映される（#145）"`（L49-102）に 1 行追加。
```ts
await suggestions.getByRole("button", { name: "bug" }).click();
await expect(title).toHaveValue("ホゲ @bug ");
await expect(title).toBeFocused(); // ★追加: 候補タップ後もタイトル欄がフォーカス保持＝キーボードを閉じる理由がない
```
根拠は ②で詳述。新規ファイル・新規依存なし。

**P1-2**: `e2e/mock-github.mjs` に issue 作成回数カウンタを追加（`nextIssueNumber` の脇に `let issueCreateCount = 0;` を増分し、`GET /mock/issue-count` で返す。`/mock/config` 受信時に 0 リセット）。`e2e/offline-queue.spec.ts` の 1 本目のテストに、再送成功後 `expect(await (await request.get(`${MOCK_GITHUB_URL}/mock/issue-count`)).json()).toEqual({ count: 1 })` を追加。さらに新規テスト `"online イベントが短時間に連続発火しても再送は1回だけ実行される（re-entrancy guard 回帰）"` を追加し、`window.dispatchEvent(new Event("online"))` を 2 回連続発火させても count===1 のままであることを確認する（`useOfflineQueueSync.ts` の `flushingRef` ガードの回帰検知）。「重複なし」を間接証拠（キュー表示消滅）から直接証拠（作成回数 assert）に格上げできる、最も費用対効果が高い項目。

**P1-3**: `npm run build` 直後に生成物を検査する軽量チェックを追加。新規ファイルは最小限にし、`tools/check_sw_background_sync.py`（または既存の `check_cjk_markdown.py` 同様の小スクリプト）で `dist/sw.js`（vite-plugin-pwa 生成物）を grep し、`"issue-post-queue"` と `POST` と `/api/issues` 相当のパターンが含まれることを確認、なければ非ゼロ終了。`.github/workflows/ci.yml` の `test` ジョブ（L28-36 の `npm run build` の直後）に1行追加するだけ。ブラウザ起動不要でコスト最小。`vite.config.ts` の `runtimeCaching` 設定が将来のリファクタで silently 消えるのを検知する唯一の機械的ガードになる（現状ゼロ）。

**P2**: `e2e/kpi.spec.ts` の `"ショートカット起動 → タイトルのみ起票の外形計測（KPI #2 相当・リポ初期選択済み）"`（L97-132）に、既存の 10_000ms 閾値はそのまま残しつつ、Issue #148 チェックリスト 7 の 5 秒基準に対応する参考閾値（例: 5_000ms）を **別 assert として追加**する。docstring の「これは実機体感の代替ではない」という既存の自己申告コメントを維持・強化し、閾値を厳しくしたことで「アプリ処理の回帰で 5 秒に近づいていないか」を CI で常時監視できるようにする。既存ファイルの1テスト内に1行足すだけで新規ファイル不要。

---

### ② 「実機必須」への機械化代替案と限界の自己評価

- **`document.activeElement` assert（項目 4「キーボードを閉じない」）**: 有効な代替。ソフトキーボードは「フォーカスされた編集可能要素が存在する間は開いたままになる」という OS 契約に乗っているため、`toBeFocused()` はこの契約が破られていない（＝blur が発生していない）ことを直接検証できる。ただし **実際に画面上でキーボードが視覚的に閉じないことの証明にはならない**（後述の visualViewport の限界と表裏一体）。IME 側の癖（Gboard の予測変換バー描画崩れ等）までは保証しない。
- **`visualViewport` の変化 assert**: **却下（費用対効果ゼロ）**。Playwright のモバイルエミュレーション（Pixel 7・`devices["Pixel 7"]`）は viewport サイズと UA を模すだけで、ヘッドレス Chromium は実ソフトキーボードを描画・オーバーレイしない。つまり `visualViewport.height` はフォーカス状態に関わらず変化しないため、このアサートは常に「変化なし」を返し続け、**壊れていても常にパスするテートロジー**になる。誤った安心感を生むだけなので追加しない。
- **Playwright CDP `Input.dispatchKeyEvent`（生キーイベント）**: **却下**。grep の結果、ラベル候補確定は click 経路のみで Enter/keydown による確定コードパスが存在しない。現状の `fill()`/`click()` で候補確定ロジックは全経路をカバー済みであり、生キーイベントを追加しても新たに踏むコードパスがない。将来「物理 Enter で確定」機能が入った時に再検討する。
- **CDP `Emulation` 系（display-mode: standalone のスタブ等）**: **却下**。grep の結果、`display-mode: standalone` を分岐条件にしているアプリコードがゼロ（ヒットは翻訳文字列のみ）。分岐が存在しない条件をスタブしても検証対象がない。WebAPK コールドスタートの本質的なコスト（プロセス起動・OS スケジューラのジッタ・SW warm/cold）はブラウザの display-mode ではなく OS プロセスライフサイクルの話であり、CDP Emulation では原理的に再現できない。項目 7 の実機ストップウォッチは **真に実機必須のまま残る**（P2 の閾値強化は回帰ガードであり代替ではない、と明記する）。
- **Service Worker 単体テスト（Background Sync）**: **部分的にのみ有効、フルは却下**。`vite.config.ts` に実体のある `BackgroundSyncPlugin("issue-post-queue")` の「設定が存在し続けているか」は P1-3 の grep で安価に守れる。しかし「アプリがバックグラウンド/閉じた状態で OS が `sync` イベントを実際に発火し、Workbox が IndexedDB キューを実際にリプレイする」という **本来テストしたい振る舞い**を CI で再現するには、`fake-indexeddb` 等の新規 devDependency + 自作 `ServiceWorkerGlobalScope` シムが要る。これは OS のバックグラウンド実行契約そのものを模造する話で、投資対効果が低い（後述③で正式に切り捨てる）。
- **mock GitHub の作成回数カウンタ（重複検証）**: 有効かつ安価（P1-2）。ただし検証できるのは「クライアント主導再送経路（`useOfflineQueueSync.ts` のフォアグラウンド flush）が重複しないか」のみ。コメントが明記する「ページを閉じていても SW 側の Background Sync が並行して再送し得る」二重化シナリオ（クライアント経路と SW 経路が同時に発火するレース）は、SW 経路自体を CI で起こせない以上、真の意味では実機/実 OS でしか再現できない。ただしそのレースはサーバー側 `issue_log` 照合（B4-3・#70）で吸収される設計なので、**E2E で再現できなくても本番の安全性は別レイヤーで担保されている**（自動化ギャップ＝安全性ギャップではない、と評価する）。

**総括**: 項目 1〜6 はコード変更ゼロ〜1 行追加で完全に機械化済み／できる。項目 7 とオフライン系の「アプリを閉じた状態での OS ネイティブ挙動」だけが構造的に実機必須として残る。これは「自動化不足」ではなく「CI サンドボックスが OS のプロセスライフサイクル・実ソフトキーボードを持たない」という環境的限界であり、無理に模造ツールを増やすよりチェックリストに残す方が正直で安い。

---

### ③ 自分で切り捨てる案（費用対効果が低いと判断し、実装しない）

1. **display-mode:standalone のスタブ E2E** — 対応する分岐コードがアプリに存在しないため検証対象ゼロ（YAGNI）。
2. **CDP 生キーイベントによる候補確定テスト** — 既存 click 経路で全ロジックをカバー済み。生キー特有の未踏コードパスがない。
3. **Service Worker ランタイム単体テスト（fake-indexeddb 等で `sync` イベントを合成発火）** — 新規 devDependency + 自作シムが必要な割に、検証できるのは「OS が発火した体で動くか」という模造環境であり、本物の OS ライフサイクル契約の代替にはならない。P1-3（ビルド成果物の grep）で config regression は既に安価に守れているため、これ以上の投資は見送る。
4. **本番 URL（smoke.yml/smoke_prod.sh）への UI レベル拡張（実ブラウザで実 GitHub にアクセスして起票まで実行）** — 本番 OAuth 資格情報・使い捨てテストユーザー・実リポジトリ汚染のリスクを伴う。現状の HTTP 診断（`/api/health`・`/api/ready`・OAuth redirect）で「設定・プロビジョニング不良の早期検知」という smoke.yml 本来の目的は満たしており、UI 拡張は費用（本番専用テストアカウント整備・GitHub 側のノイズ増）に対して得られる検知価値が薄い。やるなら別 Issue で「本番相当だが使い捨てのサンドボックス repo」を用意してから、が前提になる。今回のスコープには含めない。
5. **チェックリスト自動生成＋結果の Issue コメント自動投稿ツール** — P1/P2 を適用すると、毎リリースの手動確認事項は実質「WebAPK コールドスタートのストップウォッチ計測」「実指のタップ精度」「IME の体感」の 3 点まで縮小する。この程度の残余に対して専用の自動生成・投稿ツールを新設するのは、運用コストの移転（人手作業→ツール保守）でしかなく、Issue 本文に固定テンプレを 1 回貼るのと大差ない。新規ツールは追加しない。
