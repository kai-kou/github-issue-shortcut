#!/usr/bin/env python3
"""ビルド成果物の Service Worker に Background Sync 設定が残っていることを検査する（#148）。

オフラインキューの「アプリを閉じていても後で再送される」保証は、`vite.config.ts` の
`workbox.runtimeCaching`（`POST /api/issues` を `NetworkOnly` + `backgroundSync` でキューイング）に
依存している。この設定は E2E では検証できない（Playwright は SW の `sync` イベントを起こせない）ため、
リファクタで静かに消えても誰も気づかないという穴があった。

本スクリプトは生成された `dist/client/sw.js` を検査し、Background Sync のキュー名と対象エンドポイントが
残っていることだけを確認する。SW が実際に発火するかは実機確認の領分（docs/testing-e2e.md）。

使い方:
    npm run build && python3 tools/check_sw_background_sync.py

終了コード: 0 = OK / 1 = 設定欠落・成果物なし
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SW_PATH = Path("dist/client/sw.js")

# 生成物に現れるパターン。`urlPattern` は正規表現リテラルとして埋め込まれるため、
# スラッシュがエスケープされた形（`api\/issues`）にもマッチできる正規表現で照合する。
REQUIRED_PATTERNS = {
    r"issue-post-queue": "Background Sync のキュー名（vite.config.ts の backgroundSync.name）",
    r"api\\?/issues": "キュー対象のエンドポイント（runtimeCaching の urlPattern）",
    r"\bPOST\b": "キュー対象のメソッド（runtimeCaching の method）",
}


def main() -> int:
    if not SW_PATH.exists():
        print(f"❌ {SW_PATH} がありません。先に `npm run build` を実行してください。", file=sys.stderr)
        return 1

    content = SW_PATH.read_text(encoding="utf-8", errors="replace")
    missing = [
        (pattern, desc)
        for pattern, desc in REQUIRED_PATTERNS.items()
        if not re.search(pattern, content)
    ]

    if missing:
        print(f"❌ {SW_PATH} に Background Sync の設定が見つかりません:", file=sys.stderr)
        for pattern, desc in missing:
            print(f"   - {pattern!r}: {desc}", file=sys.stderr)
        print(
            "   vite.config.ts の workbox.runtimeCaching（POST /api/issues の backgroundSync）が\n"
            "   消えている可能性があります。オフラインキューの再送保証が失われるため確認してください。",
            file=sys.stderr,
        )
        return 1

    print(f"✅ {SW_PATH}: Background Sync 設定（issue-post-queue / POST /api/issues）を確認")
    return 0


if __name__ == "__main__":
    sys.exit(main())
