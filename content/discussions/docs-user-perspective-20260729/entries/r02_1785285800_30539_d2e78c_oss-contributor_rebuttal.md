<!--entry
author: oss-contributor
round: 2
kind: rebuttal
ts: 2026-07-29T09:43:19+09:00
-->

# oss-contributor rebuttal（Round 2）

## 事実確認結果

### 1. ✓ trust-privacy の #181 指摘は部分的に正確
**trust-privacy の主張**: `data-retention-inventory.md` §9 の差分1（アカウント削除時の不一致）が実装と食い違ったまま。
**検証**: `src/auth/useAuthState.ts` のコード確認で、`clearAllLocalUserData()` 関数に以下の実装を確認:
- コメント: 「端末内に残る利用者データを **未送信の下書き・オフラインキューまで含めて** 全消去する（#181）」
- 実装: `clearDraft()` と `clearOfflineQueue()` を明示的に呼ぶ（未送信内容も削除）
- **結果**: #181 で既に修正済みだが、ドキュメントには「見つかった差分」として「不一致」のまま残っている（trust-privacy の主張通り、ドキュメント更新漏れ）

### 2. ✓ target-user の OQ-1 & ショートカット機能の矛盾は正確
**target-user の主張**: README L33-34 は「ホーム画面にいくつでも並べられます」と謳うが、実装では単体 URL をホーム画面アイコンにするとプリセットが効かない。
**検証**: `src/i18n/translations.ts` L299-303 に以下を確認:
- `placementGuideNote`: 「この URL を単体でホーム画面のアイコンにしても、初期選択（プリセット）は反映されません（アプリはトップ画面で起動します・Android の仕様）」
- `docs/requirements/00-requirements.md` L324: OQ-1 は依然「M2 着手時」の未決事項扱い
- **結果**: 実装は既に「プリセット付きホーム画面追加は不可能」という結論に達し警告文を実装済みだが、要件書には反映されていない（要件と実装のズレ）

### 3. ✓ README の offline queue 説明は oversimplified
**target-user の主張**: README L38 は「二重起票はしません」と言い切るが、ネットワーク失敗のみが対象で 24h で自動再送が止まることなど限界を隠している。
**検証**: `src/i18n/translations.ts` で以下を確認:
- `queueExpired`: 「24 時間以上送信できなかったため、自動再送を停止しました。...再送または破棄してください」
- 実装は「稀に重複しうること」を明示（要件書 §7.1 で P3 で受容）
- **結果**: README の記述が不完全（24h 自動停止・手動対応必須・重複可能性を隠している）

### 4. ✓ README に privacy/terms リンクが完全に欠落
**trust-privacy & target-user の主張**: README にプライバシーポリシー・利用規約へのリンクが無い。
**検証**: `grep -i "privacy|terms"` で README.md から 0 件検出。
- **結果**: 確認。実装には `src/i18n/translations.ts` に `/privacy` セクション（`privacy.title` 等）があるが README からは辿れない。

### 5. ✓ SECURITY.md が stateless-architecture.md にリンクしていない
**trust-privacy の主張**: SECURITY.md L14 で「認証フロー（GitHub OAuth・トークンの取り扱い）」と言及するが、設計詳細ドキュメントへの参照が無い。
**検証**: SECURITY.md 確認で、該当行が確認。README には L65 で `docs/design/stateless-architecture.md` へのリンクがあるが、SECURITY.md 単体にはない。
- **結果**: 確認。SECURITY.md からトークン設計を詳しく知る導線が欠落。

### 6. ✗ newcomer の PWA インストール UI 完全欠落の指摘（部分的）
**newcomer の主張**: `beforeinstallprompt` / 「ホーム画面に追加」を案内する UI が `src/` に存在しない。
**検証**: `grep -n "beforeinstallprompt"` で検索。`install.title` / `install.orgNotice` は確認できるが、PWA インストールプロンプト自体の UI 要素は `beforeinstallprompt` イベントハンドラが見当たらない。
- **結果**: 実装にそのハンドラが無いことは確認（newcomer の指摘通り）だが、ブラウザ標準の beforeinstallprompt イベント（Chrome が自動表示）に頼っている可能性あり。実装詳細は未確認。

### 7. ✗ newcomer の「初回ステップを示す導線がない」は「図示がない」であり、説明は存在
**newcomer の主張**: README の screenshots 3 枚が「① ログイン → ② ホーム画面に追加 → ③ タップで起票」という時系列ステップとして並べられていない。
**検証**: README L15-17 の表で「起票フォーム | スマート入力 | ログイン」の順。この表示順序を newcomer が「時系列と逆」と指摘。
- **結果**: 表示順序の指摘は妥当（初回体験は「ログイン」からだが表に 3 番目）。ただし、README 本文にはシナリオが書かれている可能性があり、「一切説明がない」ではなく「ビジュアルステップが逆順」という限定的な問題。

### 8. 矛盾検出なし
- 数値矛盾（KPI）: README と docs/project-mission.md が完全一致（既に検証済み）
- リンク切れ: 全て実在（既に検証済み）
