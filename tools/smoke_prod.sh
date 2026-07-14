#!/usr/bin/env bash
# 本番（またはプレビュー）デプロイのスモークテスト。
# モック IdP・ローカルランタイムで走る E2E（e2e/login.spec.ts）では検知できない
# 「本番の設定・プロビジョニング不良」を検知する層（#56）。
#   - TOKEN_ENCRYPTION_KEY 不正 → /auth/login 500 / /api/ready で encryptionKey=false
#   - GITHUB_CLIENT_ID 欠落     → /auth/login の client_id 空 / /api/ready で clientId=false
#   - remote D1 未マイグレーション → /api/ready で database=false（/auth/callback 500 の主因）
#
# 使い方: tools/smoke_prod.sh [BASE_URL]
set -uo pipefail
BASE="${1:-https://github-issue-shortcut.kinamocchi-tech.workers.dev}"
fail=0
note() { printf '%s\n' "$*"; }

# ステータス + ボディを 1 リクエストで取得（末尾行が HTTP ステータス）。
# curl -w は接続失敗時も 000 を出力するため `|| echo` の後付けはしない（二重出力の回避）。
req() { curl -sS -w $'\n%{http_code}' "$1" 2>/dev/null; }

# 1. /api/health → 200
out=$(req "$BASE/api/health"); code="${out##*$'\n'}"
if [ "$code" = "200" ]; then note "✅ /api/health 200"; else note "❌ /api/health $code"; fail=1; fi

# 2. /api/ready → 200（鍵妥当性・Client ID・D1 テーブルの自己診断）
out=$(req "$BASE/api/ready"); code="${out##*$'\n'}"; body="${out%$'\n'*}"
if [ "$code" = "200" ]; then note "✅ /api/ready 200 $body"; else note "❌ /api/ready $code $body"; fail=1; fi

# 3. /auth/login → 302 で github.com の認可 URL へ、かつ client_id が空でない
hdr=$(mktemp)
code=$(curl -sS -o /dev/null -D "$hdr" -w '%{http_code}' "$BASE/auth/login" 2>/dev/null)
loc=$(awk 'tolower($1)=="location:"{print $2}' "$hdr" | tr -d '\r'); rm -f "$hdr"
if [ "$code" = "302" ] \
  && printf '%s' "$loc" | grep -q "github.com/login/oauth/authorize" \
  && printf '%s' "$loc" | grep -qE "client_id=[^&]+"; then
  note "✅ /auth/login 302 → github authorize（client_id あり）"
else
  note "❌ /auth/login code=$code loc=$loc"; fail=1
fi

if [ "$fail" = "0" ]; then note "SMOKE PASS ($BASE)"; else note "SMOKE FAIL ($BASE)"; fi
exit "$fail"
