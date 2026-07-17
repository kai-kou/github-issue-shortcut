<!--entry
author: harnesslens
round: 2
kind: concession
ts: 2026-07-17T12:21:10+09:00
-->

## harnesslens r2 — uxlens critical 3件の機械チェック観点での検証

コーディネーター指示により、uxlens r1 の critical 1〜3 が「機械チェック・テストの観点から誤検知でないか」を自分の round 1 分析（対象ファイル再読なし）のみで検証した。結論: **3件とも誤検知ではない**。むしろ 3件とも「そもそも機械的検証手段が一切存在しない領域」であることが分かり、critical 分類を harnesslens 観点からも補強する。

1. **critical 1（初回セットアップ・GitHub 認証の設計パターン欠落）**: `docs/design/design-guidelines.md` §5 の機械チェックマップ（静的チェック 5 項目・E2E 4 テスト）にオンボーディング/認証画面は一切含まれない。`e2e/design-guidelines.spec.ts` の `gotoIssueFormScreen()` はログイン→リポジトリ選択を素通りするだけで、その画面自体の UX 基準を検証してはいない。したがって「誤検知」という概念が成立しない領域（そもそもテストが存在しない）。むしろ自分が r1 で挙げた指摘（1〜5）はいずれも「不完全ながら既存のチェッカー/テストの穴」だったのに対し、この項目は**セーフティネットが完全にゼロ**という点でリスクは同等以上。critical 支持。

2. **critical 2（フォーカス管理・WCAG 2.4.3/2.4.11 の欠落）**: 同様に `check_design_rules.py` の a〜e のいずれもフォーカス移動・視認性を検証しておらず、`e2e/design-guidelines.spec.ts` もタップターゲット/font-size/ダークモード smoke のみでキーボードフォーカスは未計測（`page.evaluate(() => document.activeElement)` 相当の assert が存在しない）。§5 マップの「後続導入」欄にも axe-core は挙がっているが、フォーカス管理はそこにも明記がない。誤検知ではない。concede。

3. **critical 3（fact_check ランク [A]→[B] の転記ミス）**: これは `content/research/design-uiux-20260717_deep_research.md` の `fact_check_flags` との突合であり、そもそも自分のチェッカー（`.css`/`.tsx`/`index.html` の正規表現検査）・E2E（ブラウザ挙動計測）のどちらの対象でもない。CJK チェッカーも半角スペース規約のみで主張ランクの整合性は見ない。この主張の真偽（[A] が正しいか [B] が正しいか）自体は自分は round 1 で該当リサーチ ISON/MD を読んでいないため独自に裏付けられないが、「機械チェック観点で誤検知か」という問いには明確に答えられる: **このクラスの指摘（Markdown 本文の出典ランク精度）を検出する機械チェックは現状ゼロ**なので、誤検知が起こりようがない。指摘の真偽は uxlens の領分（fact-check）に委ね、機械層としては「検証手段が無いことを裏付ける」形で支持する。

補足: 上記 3 件はいずれも自分の r1 指摘（`check_design_rules.py`/E2E の実装ギャップ）と競合・矛盾しない。対象レイヤーが完全に別（uxlens=ドキュメント完全性・出典精度、harnesslens=既存チェッカーの実効性）であり、両立する。
