#!/usr/bin/env python3
"""large_change_audit.py — 大規模改善（大きめの改善）の監査ゲート判定 + 必須チェックリスト出力。

「規模が大きめの改善」では、実装 → セルフレビュー → PR で止めず、以下の監査を **必須** にする（SSOT:
`docs/rules/large-change-audit-rules.md`）:

  A. 議論型レビュー（discussion-review・敵対的相互検証）を Layer 2 として実行
  B. 挙動変更は実機検証（/verify 相当・実結果でのみ断定・L-113）
  C. 新規挙動の専用テストを追加（"既存グリーン" では不十分）
  D. 議論記録を content/discussions/<id>/ に永続化

本スクリプトは差分行数・変更ファイル・ラベルから「大規模改善か」を機械判定し、該当時に上記チェック
リストと、差分から観測できる不足（新規テストなし・議論記録なし）を出力する。`pre-pr-create-check.sh`
フック（PR 作成時）と pr-review-watcher / self-reviewer スキルから呼ばれる。判定のみでブロックはしない。

使い方:
  python3 tools/large_change_audit.py check --diff-lines 590 --changed-files "src/App.tsx,e2e/x.spec.ts"
  python3 tools/large_change_audit.py check --diff-lines 590 --changed-files "..." --labels "sp:5,type:improvement" --format hook
  python3 tools/large_change_audit.py --self-test
"""
from __future__ import annotations

import argparse
import sys

# 「大規模改善」の閾値（discussion_review_trigger.py の TRIGGER_DIFF_LINES と揃える）。
THRESHOLD_DIFF_LINES = 300
LARGE_SP_LABELS = {"sp:5", "sp:8"}
TRIGGER_LABELS = {"type:security", "type:breaking-change"}

# プロダクト（ランタイム）コードの判定。テスト・ドキュメント・ハーネス・ツールは挙動変更に数えない。
_PRODUCT_PREFIXES = ("src/", "worker/", "workers/", "functions/")
_PRODUCT_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".html", ".vue", ".svelte")
_UI_SUFFIXES = (".tsx", ".jsx", ".css", ".html", ".vue", ".svelte")
_EXEMPT_PREFIXES = ("docs/", ".claude/", "content/", "tools/", "e2e/", "tests/", "test/")


def is_test_file(path: str) -> bool:
    return (
        ".spec." in path
        or ".test." in path
        or path.startswith("e2e/")
        or path.startswith("tests/")
        or path.startswith("test/")
        or "__tests__/" in path
    )


def is_doc_or_harness(path: str) -> bool:
    return path.endswith(".md") or path.startswith("docs/") or path.startswith(".claude/")


def is_product_file(path: str) -> bool:
    """ランタイム挙動を持つプロダクトコードか（テスト・docs・ハーネス・ツール・設定記録を除く）。"""
    if is_test_file(path) or is_doc_or_harness(path):
        return False
    if path.startswith(_EXEMPT_PREFIXES) and not path.startswith(_PRODUCT_PREFIXES):
        return False
    if path.startswith(_PRODUCT_PREFIXES):
        return True
    return path.endswith(_PRODUCT_SUFFIXES)


def is_ui_file(path: str) -> bool:
    if is_test_file(path):
        return False
    if path == "index.html" or "manifest" in path.lower():
        return True
    return is_product_file(path) and path.endswith(_UI_SUFFIXES)


def evaluate(diff_lines: int, changed_files: list[str], labels: set[str]) -> dict:
    product = [f for f in changed_files if is_product_file(f)]
    tests = [f for f in changed_files if is_test_file(f)]
    ui = [f for f in changed_files if is_ui_file(f)]
    discussion = [f for f in changed_files if f.startswith("content/discussions/")]

    behavior_change = bool(product)
    big_labels = labels & (LARGE_SP_LABELS | TRIGGER_LABELS)

    reasons = []
    if diff_lines >= THRESHOLD_DIFF_LINES:
        reasons.append(f"差分 {diff_lines} 行（閾値 {THRESHOLD_DIFF_LINES}）")
    if big_labels:
        reasons.append(f"ラベル {sorted(big_labels)}")
    if len(product) >= 5:
        reasons.append(f"プロダクトコード {len(product)} ファイル変更")

    # 大規模改善 = プロダクト挙動の変更があり、かつ規模/影響が閾値を超える。
    # 純粋な docs / ルール / ハーネス / テストのみの変更は監査ゲート対象外（免除）。
    is_large = behavior_change and bool(reasons)

    return {
        "is_large_change": is_large,
        "behavior_change": behavior_change,
        "reasons": reasons,
        "product_files": product,
        "test_files": tests,
        "ui_files": ui,
        "has_new_tests": bool(tests),
        "has_discussion_record": bool(discussion),
        "diff_lines": diff_lines,
    }


def render_directive(ev: dict, fmt: str) -> str:
    if not ev["is_large_change"]:
        if fmt == "hook":
            return ""
        return "ℹ️ 大規模改善の監査ゲート対象外（挙動変更なし or 閾値未達）。通常フローで可。"

    lines = []
    head = "🔍 大規模改善を検出 — 監査ゲート必須（" + " / ".join(ev["reasons"]) + "）"
    lines.append(head)
    lines.append("SSOT: docs/rules/large-change-audit-rules.md。マージ前に以下を必ず満たすこと:")
    lines.append("  A. 議論型レビュー（discussion-review・敵対的相互検証）を Layer 2 として実行する")
    lines.append("     （python3 tools/discussion_review_trigger.py の判定に従い起動）。")
    lines.append("  B. 挙動変更は実機検証（/verify 相当・実結果でのみ断定・L-113）。UI はスクショ/E2E で観測。")
    lines.append("  C. 新規挙動の専用テストを追加する（\"既存グリーン\" では不十分・新経路の regression gate）。")
    lines.append("  D. 議論記録を content/discussions/<id>/ に永続化し、要点を PR 説明・完了報告に要約する。")

    missing = []
    if ev["behavior_change"] and not ev["has_new_tests"]:
        missing.append("新規/更新テストが差分に見当たらない（C 未達の疑い）")
    if not ev["has_discussion_record"]:
        missing.append("content/discussions/ の議論記録が差分にない（A/D 未実施の疑い）")
    if missing:
        lines.append("⚠️ 差分から観測した不足（要対応・自己判断で解消）:")
        for m in missing:
            lines.append(f"    - {m}")
    if ev["ui_files"]:
        lines.append(f"🖼 UI 変更あり（{len(ev['ui_files'])} ファイル）→ design-review + スクショ/E2E 観測を含めること。")
    lines.append("免除（docs/ルール/ハーネスのみ・機械的リネーム・自動整形）に該当する場合は、その理由を1行記録して可。")

    text = "\n".join(lines)
    if fmt == "hook":
        return "[large-change-audit] " + text
    return text


def _cmd_check(args: argparse.Namespace) -> int:
    labels = {x.strip() for x in args.labels.split(",") if x.strip()}
    changed = [x.strip() for x in args.changed_files.split(",") if x.strip()]
    ev = evaluate(args.diff_lines, changed, labels)
    out = render_directive(ev, args.format)
    if out:
        print(out)
    # 判定のみ・ブロックしない（exit 0）。呼び出し側が is_large を使う場合は --format json。
    if args.format == "json":
        import json

        print(json.dumps(ev, ensure_ascii=False))
    return 0


def _self_test() -> int:
    cases = [
        # (diff_lines, files, labels, expect_large, expect_missing_tests, expect_missing_record)
        (590, ["src/App.tsx", "src/nav/NavDrawer.tsx"], set(), True, True, True),
        (590, ["src/App.tsx", "e2e/nav-drawer.spec.ts", "content/discussions/x/whiteboard.md"], set(),
         True, False, False),
        (120, ["src/App.tsx"], {"sp:5"}, True, True, True),
        (120, ["src/App.tsx"], set(), False, None, None),  # 挙動変更ありだが小規模 → 対象外
        (800, ["docs/rules/foo.md", "CLAUDE.md"], set(), False, None, None),  # docs のみ → 免除
        (800, [".claude/hooks/x.sh", "docs/rules/y.md"], set(), False, None, None),  # ハーネス+docs → 免除
        (50, ["src/index.css"], {"type:breaking-change"}, True, True, True),  # ラベルで大規模
    ]
    ok = True
    for i, (dl, files, labels, exp_large, exp_mt, exp_mr) in enumerate(cases):
        ev = evaluate(dl, files, labels)
        if ev["is_large_change"] != exp_large:
            print(f"❌ case {i}: is_large={ev['is_large_change']} 期待 {exp_large}（{files}）")
            ok = False
            continue
        if exp_large:
            if (ev["behavior_change"] and not ev["has_new_tests"]) != exp_mt:
                print(f"❌ case {i}: missing_tests 判定不一致（{files}）")
                ok = False
            if (not ev["has_discussion_record"]) != exp_mr:
                print(f"❌ case {i}: missing_record 判定不一致（{files}）")
                ok = False
    print("✅ self-test PASS" if ok else "❌ self-test FAIL")
    return 0 if ok else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="大規模改善の監査ゲート判定")
    parser.add_argument("--self-test", action="store_true", help="内蔵ケースで判定ロジックを検証")
    sub = parser.add_subparsers(dest="cmd")
    c = sub.add_parser("check", help="大規模改善か判定し監査チェックリストを出力")
    c.add_argument("--diff-lines", type=int, default=0, help="差分行数（追加+削除）")
    c.add_argument("--changed-files", default="", help="カンマ区切りの変更ファイルパス")
    c.add_argument("--labels", default="", help="カンマ区切りのラベル（任意）")
    c.add_argument("--format", choices=["text", "hook", "json"], default="text")
    args = parser.parse_args()

    if args.self_test:
        sys.exit(_self_test())
    if args.cmd == "check":
        sys.exit(_cmd_check(args))
    parser.print_help()


if __name__ == "__main__":
    main()
