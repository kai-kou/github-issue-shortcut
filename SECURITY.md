# セキュリティポリシー

## 脆弱性の報告

本プロジェクトは個人開発の OSS です。セキュリティ上の脆弱性を発見した場合は、**公開 Issue を立てずに** 以下の方法で報告してください。

- GitHub の [Security Advisories](https://github.com/kai-kou/github-issue-shortcut/security/advisories/new)（Private vulnerability reporting）から非公開で報告する

報告の際は、再現手順・影響範囲・想定される攻撃シナリオを可能な範囲で含めてください。個人プロジェクトのため対応は best-effort ですが、内容を確認し次第、修正方針を検討します。

## 対象範囲

- 本リポジトリのアプリケーションコード（`src/`・`worker/`）
- 認証フロー（GitHub OAuth・トークンの取り扱い）

## 対象外

- 依存ライブラリ自体の脆弱性（各上流プロジェクトへ報告してください。Dependabot による更新は自動追従します）
- ローカル開発環境固有の設定に起因する問題
