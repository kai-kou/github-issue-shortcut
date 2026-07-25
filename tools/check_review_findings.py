#!/usr/bin/env python3
"""観点別ファインダーの所見ファイルが揃っているかを機械検証する（Issue #140・L-120）。

サブエージェントの最終メッセージ本文は「最後の 1 ターン」しか親に届かず、相槌ターンで
上書きされて所見が消える。所見はファイルへ書かせ、Step 2（敵対的検証）へ進む前に
本スクリプトで「存在・非空」を機械判定する（空の戻り値を『指摘なし』と誤読しないため）。

使い方:
    python3 tools/check_review_findings.py <所見ディレクトリ> --expect correctness,docs,rootcause
    python3 tools/check_review_findings.py --self-test

終了コード: 0 = 全観点そろっている / 1 = 欠落・空あり（回復手順へ）
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

# 「なし」だけが書かれたファイルは正当な指摘ゼロ（未回収と区別する）
NO_FINDING_MARKERS = {"なし", "none", "no findings", "指摘なし"}


def inspect(path: Path) -> tuple[str, str]:
    """(status, detail) を返す。status は ok / empty / missing のいずれか。"""
    if not path.exists():
        return "missing", "ファイルが存在しない"
    text = path.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        return "empty", "中身が空"
    if text.lower() in NO_FINDING_MARKERS:
        return "ok", "指摘なし（明示）"
    return "ok", f"{len(text.splitlines())}行"


def check(run_dir: Path, expected: list[str]) -> int:
    failed = []
    for name in expected:
        path = run_dir / f"{name}.md"
        status, detail = inspect(path)
        mark = "OK  " if status == "ok" else "NG  "
        print(f"[{mark}] {name}: {detail} ({path})")
        if status != "ok":
            failed.append(name)

    if failed:
        print(
            f"\n[NG] 未回収の観点: {', '.join(failed)}\n"
            "  空・一言の戻り値を「指摘なし」と解釈しないこと（L-113）。\n"
            "  回復手順は .claude/skills/code-review/SKILL.md Step 1.5 を参照:\n"
            "   1. 生トランスクリプト（tasks/<agentId>.output）の assistant text を全件確認して回収\n"
            "   2. SendMessage でファイル書き出しのみ再指示\n"
            "   3. 2 回失敗したらメインセッションが直接レビューし、報告にその旨を明記",
            file=sys.stderr,
        )
        return 1

    print(f"\n[OK] {len(expected)} 観点すべて回収済み")
    return 0


def self_test() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        run_dir = Path(tmp)
        (run_dir / "ok.md").write_text("## 指摘\n- foo.py:1 バグ\n", encoding="utf-8")
        (run_dir / "none.md").write_text("なし\n", encoding="utf-8")
        (run_dir / "empty.md").write_text("   \n", encoding="utf-8")

        cases = [
            ("ok", "ok"),
            ("none", "ok"),
            ("empty", "empty"),
            ("missing", "missing"),
        ]
        for name, want in cases:
            got, _ = inspect(run_dir / f"{name}.md")
            if got != want:
                print(f"[FAIL] {name}: want={want} got={got}", file=sys.stderr)
                return 1

        if check(run_dir, ["ok", "none"]) != 0:
            print("[FAIL] 全回収ケースが NG 判定された", file=sys.stderr)
            return 1
        if check(run_dir, ["ok", "empty"]) != 1:
            print("[FAIL] 空ファイルが OK 判定された", file=sys.stderr)
            return 1

    print("[PASS] self-test")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="観点別レビュー所見の回収を検証する")
    parser.add_argument("run_dir", nargs="?", help="所見ファイルを集めたディレクトリ")
    parser.add_argument("--expect", help="期待する観点スラグのカンマ区切り（例: correctness,docs）")
    parser.add_argument("--self-test", action="store_true", help="自己テストを実行する")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    if not args.run_dir or not args.expect:
        parser.error("run_dir と --expect は必須（--self-test 時を除く）")

    run_dir = Path(args.run_dir)
    if not run_dir.is_dir():
        print(f"[NG] ディレクトリが存在しない: {run_dir}", file=sys.stderr)
        return 1

    expected = [s.strip() for s in args.expect.split(",") if s.strip()]
    if not expected:
        parser.error("--expect に観点スラグを 1 つ以上指定する")

    return check(run_dir, expected)


if __name__ == "__main__":
    sys.exit(main())
