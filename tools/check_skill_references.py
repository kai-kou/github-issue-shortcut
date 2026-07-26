#!/usr/bin/env python3
"""skill-audit スキル向け: SKILL.md / commands からの参照実在チェック（機械検証）

.claude/skills/*/SKILL.md・.claude/commands/*.md 本文中で言及される
ファイルパス（tools/*.py・docs/rules/*.md・.claude/**・content/** 等）を
正規表現で抽出し、リポジトリ上に実在するかを機械的に検証する。
併せて各ファイルの行数を集計し、肥大化閾値（既定 500 行）超過を報告する。

目視での参照実在チェック（陳腐化リンクの見落とし）を機械化するためのツール。
SSOT: .claude/skills/skill-audit/SKILL.md

使い方:
  python3 tools/check_skill_references.py               # 人間向けレポート
  python3 tools/check_skill_references.py --json         # 機械可読 JSON
  python3 tools/check_skill_references.py --bloat-threshold 500

終了コード:
  0 = リンク切れ・肥大化なし
  1 = リンク切れまたは肥大化ファイルを検出
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# バッククォート内のパスらしき文字列を抽出する（拡張子つき or 既知プレフィックスで始まる）
PATH_PATTERN = re.compile(
    r"`((?:tools|docs|content|\.claude|config)/[A-Za-z0-9_./\-]+\.(?:py|sh|md|json|ya?ml))`"
)

TARGET_GLOBS = [
    ".claude/skills/*/SKILL.md",
    ".claude/skills/*/reference.md",
    ".claude/commands/*.md",
]


def collect_target_files() -> list[Path]:
    files: list[Path] = []
    for pattern in TARGET_GLOBS:
        files.extend(sorted(REPO_ROOT.glob(pattern)))
    return files


PLACEHOLDER_TOKENS = ("YYYY", "XXXX", "{", "<", "__")


def extract_referenced_paths(text: str) -> set[str]:
    return {
        m.group(1)
        for m in PATH_PATTERN.finditer(text)
        if not any(tok in m.group(1) for tok in PLACEHOLDER_TOKENS)
    }


def check_file(path: Path, bloat_threshold: int) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    # wc -l と一致させる（改行文字数そのもの・末尾改行の有無で +1 しない）
    line_count = text.count("\n")
    referenced = extract_referenced_paths(text)
    missing = sorted(
        ref for ref in referenced if not (REPO_ROOT / ref).exists()
    )
    return {
        "file": str(path.relative_to(REPO_ROOT)),
        "line_count": line_count,
        "bloated": line_count > bloat_threshold,
        "referenced_count": len(referenced),
        "missing_references": missing,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="機械可読 JSON で出力")
    parser.add_argument(
        "--bloat-threshold",
        type=int,
        default=500,
        help="肥大化と判定する行数閾値（既定 500）",
    )
    args = parser.parse_args()

    results = [check_file(p, args.bloat_threshold) for p in collect_target_files()]
    broken = [r for r in results if r["missing_references"]]
    bloated = [r for r in results if r["bloated"]]

    if args.json:
        print(json.dumps({"results": results, "broken": broken, "bloated": bloated}, ensure_ascii=False, indent=2))
    else:
        print(f"検査対象: {len(results)} ファイル")
        if broken:
            print(f"\n❌ リンク切れ検出: {len(broken)} ファイル")
            for r in broken:
                print(f"  - {r['file']}: {', '.join(r['missing_references'])}")
        else:
            print("✅ リンク切れなし")
        if bloated:
            print(f"\n⚠️ 肥大化検出（>{args.bloat_threshold} 行）: {len(bloated)} ファイル")
            for r in bloated:
                print(f"  - {r['file']}: {r['line_count']} 行")
        else:
            print(f"✅ 肥大化なし（閾値 {args.bloat_threshold} 行）")

    return 1 if (broken or bloated) else 0


if __name__ == "__main__":
    sys.exit(main())
