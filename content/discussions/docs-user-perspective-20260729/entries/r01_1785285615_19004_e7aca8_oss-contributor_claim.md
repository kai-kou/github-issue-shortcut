<!--entry
author: oss-contributor
round: 1
kind: claim
ts: 2026-07-29T09:40:15+09:00
-->

# OSS ユーザー観点の検証結果

## 検証項目一覧

### 1. リンク切れ（README.md）
| リンク | 存在確認 | 状態 |
|--------|---------|------|
| CLAUDE.md | ✓ | OK |
| LICENSE | ✓ | OK |
| docs/project-mission.md | ✓ | OK |
| docs/requirements/ | ✓ | OK |
| docs/research/ | ✓ | OK |
| docs/rules/ | ✓ | OK |
| docs/research/2026-07-10-market-competitors.md | ✓ | OK |
| docs/research/2026-07-28-data-retention-inventory.md | ✓ | OK |
| docs/design/stateless-architecture.md | ✓ | OK |
| content/discussions/ | ✓ | OK |

**結果**: README.md の全相対リンク先が存在。broken links なし。

---

### 2. 画像・バッジの実在
| 画像パス | 存在確認 | 状態 |
|---------|---------|------|
| docs/assets/screenshots/issue-form.png | ✓ | OK |
| docs/assets/screenshots/smart-input.png | ✓ | OK |
| docs/assets/screenshots/login.png | ✓ | OK |

**結果**: README の 3 つのスクリーンショット全て存在。

---

### 3. 貢献導線ファイルの有無
| ファイル | 存在 | 状態 | 意見 |
|---------|------|------|------|
| CONTRIBUTING.md | ✗ | **NG** | OSS として公開予定なら必須 |
| .github/ISSUE_TEMPLATE/ | ✗ | NG | Issue テンプレートなし（自由形式） |
| .github/PULL_REQUEST_TEMPLATE.md | ✗ | NG | PR テンプレートなし |
| CODE_OF_CONDUCT.md | ✗ | NG | 行動規範なし |

**結果**: 貢献者向けのガイダンス一式が全て欠落。「一般公開前提」（docs/requirements/README.md 記載）と宣言しながら、外部貢献者が参入するための導線がない。

---

### 4. ライセンス表記の一貫性
| ファイル | 記載 | 状態 |
|---------|------|------|
| LICENSE | MIT | ✓ |
| README.md | MIT License | ✓ |
| package.json | (欠落) | **NG** |

**結果**: package.json に `"license": "MIT"` フィールドが欠落（npm package 公開時に問題になる可能性）。

---

### 5. ドキュメント間の数値・スコープ矛盾
| 項目 | README.md | docs/project-mission.md | 一致 |
|------|-----------|----------------------|------|
| 起票所要時間（タイトルのみ） | 5 秒以内 | 5 秒以内 | ✓ |
| 起票所要時間（全体） | 10 秒以内 | 10 秒以内 | ✓ |
| ショートカット起動時タップ数 | 3 タップ以内 | 3 タップ以内 | ✓ |
| 起票成功率 | 99% 以上 | 99% 以上 | ✓ |
| 初回セットアップ | 5 分以内 | 5 分以内 | ✓ |

**結果**: KPI 値が完全一致。数値矛盾なし。

---

### 6. ドキュメント更新日と現状の乖離
- README.md「目指している速さ」セクション: 「実測値ではありません」と明記。期待値と現状の区別が適切。
- docs/requirements/README.md 「決定事項」: 2026-07-10 時点の確認事項。その後の変更記録がなく、本日時点での実装状況との対応が不明。
- docs/research/ ファイル群: ファイル名に日付を含むため、新しい知見が出た場合の更新方針が不明瞭（新規ファイルか、既存ファイルの上書きか）。

**結果**: 既知の問題なし。ただし「決定事項」のうち「M4（TWA / Play 配布）は優先度低・実施判断保留」の現在の状態（実施判断がなされたか、保留のままか）が外部には不明。

---

### 7. 要件定義への相互リンク
docs/requirements/README.md の「根拠資料」セクションで参照される 4 つのリサーチ文書を全確認:
- ✓ ../research/2026-07-10-auth-architecture.md
- ✓ ../research/2026-07-10-cloudflare-stack.md
- ✓ ../research/2026-07-10-mobile-ux-pwa.md
- ✓ ../research/2026-07-10-market-competitors.md

**結果**: 全 broken links なし。

---

## 重大度別サマリー

### **Critical（外部貢献者の参入を妨げる）**
1. **CONTRIBUTING.md 欠落**: 「一般公開前提」を宣言しながら、貢献方法のガイドがない。初訪問者がコード参加を検討できない。

### **High（プロフェッショナル評価を損なう）**
2. **貢献ガイドラインスイート欠落**（ISSUE_TEMPLATE, PULL_REQUEST_TEMPLATE, CODE_OF_CONDUCT）: GitHub として形式的な体裁が不足。Issue/PR の質が管理されていない状態に見える。
3. **package.json の license 欠落**: npm 生態での適正さを疑われる。

### **Medium（ドキュメント保守性）**
4. **リサーチファイルの更新方針が暗黙的**: 日付ベースのファイル名に対し、「既存ファイルを更新するのか新規ファイルを作成するのか」の方針が明確でない。

---

## 推奨修正

### P1: 即時実装必須
- [ ] `CONTRIBUTING.md` 作成（コード参加方法・開発環境セットアップ・PR フロー・行動規範）
- [ ] `package.json` に `"license": "MIT"` を追加

### P2: 公開前に実装
- [ ] `.github/ISSUE_TEMPLATE/bug_report.md` 作成
- [ ] `.github/ISSUE_TEMPLATE/feature_request.md` 作成
- [ ] `.github/PULL_REQUEST_TEMPLATE.md` 作成
- [ ] `CODE_OF_CONDUCT.md` 作成

### P3: ドキュメント運用改善
- [ ] docs/requirements/ に「決定事項」の最終更新日を記載
- [ ] docs/research/ に「リサーチファイル更新ポリシー」を明示（既存更新 vs 新規作成の判定基準）
