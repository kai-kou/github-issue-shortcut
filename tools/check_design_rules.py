#!/usr/bin/env python3
"""check_design_rules.py（本プロジェクト固有）

モバイル最速 GitHub Issue 起票 PWA 向けデザインルールの静的チェッカー。
一次情報で確定済みの基準（Issue 本文参照）を機械チェックする:

  a. フォームコントロール（input/textarea/select/button）の font-size が
     16px 未満（iOS Safari の自動ズームを誘発する）
  b. <input>（type=hidden/checkbox/radio 除く）・<textarea> に
     enterkeyhint 属性が無い（モバイル入力最適化の機会損失）
  c. placeholder のみでラベル代わりにしている（同一ファイルに <label が無い。
     NN/g: ラベルは入力欄の上に常時表示すべき）
  d. animation/transition を使っているのに prefers-reduced-motion: reduce の
     無効化指定が同一ファイルに無い
  e. viewport meta に maximum-scale=1 / user-scalable=no があり手動ズームを
     禁止している（WCAG 1.4.4 違反）

全て **Warning レベル**（`--strict` 指定時のみ違反があれば exit 1。既定は
違反があっても exit 0・PR をブロックしない）。`tools/check_cjk_markdown.py` /
`tools/self_review_check.py` の作法（encoding 指定・argparse・exit code）に倣う。

設計方針（YAGNI）: 素朴な正規表現ベースの静的チェックであり、AST パースは
行わない。JSX 式（`{x > y}` 等）を含むタグ属性の誤検出はあり得るが、
Warning のみで PR をブロックしないため許容する。

使い方:
  python3 tools/check_design_rules.py                 # src/**/*.tsx, src/**/*.css, index.html を検査
  python3 tools/check_design_rules.py <file> ...       # 指定ファイルのみ検査
  python3 tools/check_design_rules.py --strict         # 違反があれば exit 1
  python3 tools/check_design_rules.py --self-test      # セルフテスト

他ツールからの再利用: `file_violations(path, text) -> list[(line, msg)]`
（`tools/self_review_check.py` が変更ファイルに対して呼び出す）。

終了コード: 0=違反なし or Warning のみ（既定） / 1=--strict 指定時に違反あり / 2=ツール異常
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

FORM_TAGS = ("input", "textarea", "select", "button")

# --- a. CSS font-size ---------------------------------------------------
# 入れ子を持たない「セレクタ { 宣言 }」の最内ブロックのみを拾う。
# @media { input { ... } } のようなネストでも、内側の input ブロックは
# finditer が左から順に試行する過程で正しく拾える（外側の @media 自体は
# 「[^{}]*」が内側の { で止まるためマッチしない＝無視される）。
BLOCK_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")
FONT_SIZE_RE = re.compile(r"font-size\s*:\s*([\d.]+)\s*(px|rem|em|%)?", re.IGNORECASE)


def _selector_targets_form_control(selector: str) -> bool:
    """セレクタがフォームコントロール要素（input/textarea/select/button）を直接指すか判定する。

    コンパウンドセレクタ（`input.foo:hover`）や子孫セレクタ（`.wrapper input`）は対象とし、
    クラス/ID名の一部に偶然 "input" 等の文字列を含むだけのセレクタ（`.custom-input-box`）は
    除外する（トークン先頭一致のみ許可）。
    """
    for part in selector.split(","):
        tokens = re.split(r"[\s>+~]+", part.strip())
        for tok in tokens:
            tok = tok.strip()
            if not tok:
                continue
            if re.match(r"^(?:input|textarea|select|button)(?=$|[:.\[])", tok, re.IGNORECASE):
                return True
    return False


def check_css_font_size(text: str) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    for m in BLOCK_RE.finditer(text):
        selector, body = m.group(1), m.group(2)
        sel_stripped = selector.strip()
        if not sel_stripped or sel_stripped.startswith("@"):
            continue
        if not _selector_targets_form_control(sel_stripped):
            continue
        fm = FONT_SIZE_RE.search(body)
        if not fm:
            continue
        num, unit = fm.group(1), (fm.group(2) or "").lower()
        try:
            val = float(num)
        except ValueError:
            continue
        if unit == "px":
            px = val
        elif unit == "rem":
            px = val * 16
        else:
            # em・% ・単位なしは基準（親要素の font-size）が不明なため判定スキップ
            continue
        if px < 16:
            offset = m.start(2) + fm.start()
            line = text.count("\n", 0, offset) + 1
            out.append((
                line,
                f"font-size が {px:g}px 相当（16px 未満・iOS Safari 自動ズームの恐れ）: "
                f"セレクタ `{sel_stripped}`",
            ))
    return out


# --- d. CSS prefers-reduced-motion --------------------------------------
ANIM_RE = re.compile(r"\b(?:animation|transition)\s*:", re.IGNORECASE)


def check_css_reduced_motion(text: str) -> list[tuple[int, str]]:
    if "prefers-reduced-motion" in text.lower():
        return []
    m = ANIM_RE.search(text)
    if not m:
        return []
    line = text.count("\n", 0, m.start()) + 1
    return [(line, "animation/transition を使用していますが prefers-reduced-motion: reduce の無効化指定がありません")]


# --- b. TSX enterkeyhint --------------------------------------------------
TAG_RE = re.compile(r"<(input|textarea)\b[^>]*>", re.IGNORECASE)
TYPE_ATTR_RE = re.compile(r"""type\s*=\s*["']?(hidden|checkbox|radio)["']?""", re.IGNORECASE)


def check_tsx_enterkeyhint(text: str) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    for m in TAG_RE.finditer(text):
        tag = m.group(0)
        tagname = m.group(1).lower()
        if tagname == "input" and TYPE_ATTR_RE.search(tag):
            continue
        if "enterkeyhint" in tag.lower():
            continue
        line = text.count("\n", 0, m.start()) + 1
        out.append((line, f"<{tagname}> に enterkeyhint 属性がありません（モバイル入力最適化を検討）"))
    return out


# --- c. TSX placeholder-only label ---------------------------------------
PLACEHOLDER_TAG_RE = re.compile(r"<(?:input|textarea)\b[^>]*\bplaceholder\s*=", re.IGNORECASE)
LABEL_RE = re.compile(r"<label\b", re.IGNORECASE)


def check_tsx_placeholder_label(text: str) -> list[tuple[int, str]]:
    m = PLACEHOLDER_TAG_RE.search(text)
    if not m:
        return []
    if LABEL_RE.search(text):
        return []
    line = text.count("\n", 0, m.start()) + 1
    return [(line, "placeholder のみをラベル代わりにしている可能性（NN/g: ラベルは入力欄の上に常時表示を推奨）")]


# --- e. index.html viewport ------------------------------------------------
VIEWPORT_BAD_RE = re.compile(r"maximum-scale\s*=\s*1(?:\.0+)?\b|user-scalable\s*=\s*no", re.IGNORECASE)


def check_html_viewport(text: str) -> list[tuple[int, str]]:
    m = VIEWPORT_BAD_RE.search(text)
    if not m:
        return []
    line = text.count("\n", 0, m.start()) + 1
    return [(line, "viewport meta に maximum-scale=1 または user-scalable=no があります（WCAG 1.4.4 違反・ズーム禁止をしない）")]


def file_violations(path: str, text: str) -> list[tuple[int, str]]:
    """1 ファイル分の (行番号, メッセージ) 違反一覧を返す（拡張子/ファイル名でチェックを振り分け）。

    tools/self_review_check.py から変更ファイルごとに呼び出される再利用エントリポイント。
    """
    p = Path(path)
    suffix = p.suffix.lower()
    out: list[tuple[int, str]] = []
    if suffix == ".css":
        out += check_css_font_size(text)
        out += check_css_reduced_motion(text)
    elif suffix == ".tsx":
        out += check_tsx_enterkeyhint(text)
        out += check_tsx_placeholder_label(text)
    elif p.name == "index.html":
        out += check_html_viewport(text)
    return out


def discover_default_files() -> list[str]:
    """引数省略時の既定対象: src/**/*.tsx, src/**/*.css, index.html（リポジトリルート基準）。"""
    files: list[str] = []
    src = Path("src")
    if src.is_dir():
        files += [str(p) for p in sorted(src.rglob("*.tsx"))]
        files += [str(p) for p in sorted(src.rglob("*.css"))]
    if Path("index.html").is_file():
        files.append("index.html")
    return files


def check_files(paths: list[str]) -> int:
    """指定ファイルを検査して結果を出力し、総違反件数を返す（exit code はここでは決めない）。"""
    total = 0
    for path in paths:
        p = Path(path)
        if not p.is_file():
            print(f"[design] スキップ（不在）: {path}", file=sys.stderr)
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError) as e:
            print(f"[design] スキップ（読み込み失敗: {e}）: {path}", file=sys.stderr)
            continue
        violations = file_violations(path, text)
        total += len(violations)
        for line, msg in violations:
            print(f"[design] {path}:{line}: {msg}")

    if total:
        print(f"\n[design] Warning: デザインルール違反候補 {total} 件（Warning・非ブロッキング）")
    else:
        print("[design] OK（デザインルール違反候補なし）")
    return total


def self_test() -> int:
    cases: list[tuple[str, str, int]] = [
        # (テスト名, 入力テキスト, 期待違反件数)
        ("font-size px 未満", "input { font-size: 14px; }", 1),
        ("font-size rem 未満", "textarea { font-size: 0.9rem; }", 1),
        ("font-size 16px 以上", "input { font-size: 16px; }", 0),
        ("font-size em はスキップ", "button { font-size: 1em; }", 0),
        ("非フォームセレクタは対象外", ".title { font-size: 12px; }", 0),
        (
            "子孫セレクタは対象",
            ".form-group input { font-size: 12px; }",
            1,
        ),
        (
            "クラス名に input を含むだけは誤検出しない",
            ".custom-input-box { font-size: 10px; }",
            0,
        ),
    ]
    passed = 0
    failed = 0
    for name, text, expected in cases:
        got = check_css_font_size(text)
        if len(got) == expected:
            passed += 1
        else:
            failed += 1
            print(f"FAIL(font-size): {name} expected={expected} got={got!r}")

    reduced_motion_cases: list[tuple[str, str, int]] = [
        ("transition のみで reduced-motion 無し", ".box { transition: opacity 0.2s; }", 1),
        (
            "prefers-reduced-motion あり",
            "@media (prefers-reduced-motion: reduce) { .box { animation: none; } }\n"
            ".box { animation: spin 1s; }",
            0,
        ),
        ("animation/transition 無し", ".box { color: red; }", 0),
    ]
    for name, text, expected in reduced_motion_cases:
        got = check_css_reduced_motion(text)
        if len(got) == expected:
            passed += 1
        else:
            failed += 1
            print(f"FAIL(reduced-motion): {name} expected={expected} got={got!r}")

    enterkeyhint_cases: list[tuple[str, str, int]] = [
        (
            "enterkeyhint 無し input",
            '<input type="text" value={title} onChange={onChange} />',
            1,
        ),
        (
            "enterkeyhint あり",
            '<input type="text" enterkeyhint="send" value={title} onChange={onChange} />',
            0,
        ),
        ("type=hidden は除外", '<input type="hidden" name="csrf" value={token} />', 0),
        ("type=checkbox は除外", '<input type="checkbox" checked={x} onChange={y} />', 0),
        ("textarea も検出対象", "<textarea value={body} onChange={onChange} />", 1),
    ]
    for name, text, expected in enterkeyhint_cases:
        got = check_tsx_enterkeyhint(text)
        if len(got) == expected:
            passed += 1
        else:
            failed += 1
            print(f"FAIL(enterkeyhint): {name} expected={expected} got={got!r}")

    placeholder_cases: list[tuple[str, str, int]] = [
        ("label 無しの placeholder", '<input placeholder="Title" value={title} />', 1),
        (
            "label ありなら OK",
            '<label>Title<input placeholder="Title" value={title} /></label>',
            0,
        ),
        ("placeholder 無しなら対象外", "<input value={title} />", 0),
    ]
    for name, text, expected in placeholder_cases:
        got = check_tsx_placeholder_label(text)
        if len(got) == expected:
            passed += 1
        else:
            failed += 1
            print(f"FAIL(placeholder-label): {name} expected={expected} got={got!r}")

    viewport_cases: list[tuple[str, str, int]] = [
        (
            "maximum-scale=1 は違反",
            '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">',
            1,
        ),
        (
            "通常の viewport は OK",
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
            0,
        ),
    ]
    for name, text, expected in viewport_cases:
        got = check_html_viewport(text)
        if len(got) == expected:
            passed += 1
        else:
            failed += 1
            print(f"FAIL(viewport): {name} expected={expected} got={got!r}")

    print(f"\n[design] self-test: {passed} passed / {failed} failed")
    return 0 if failed == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="デザインルール静的チェッカー（モバイル最速起票 PWA 向け）")
    ap.add_argument("files", nargs="*", help="対象ファイル（省略時は src/**/*.tsx, src/**/*.css, index.html）")
    ap.add_argument("--strict", action="store_true", help="違反があれば exit 1（既定は Warning のみ・exit 0）")
    ap.add_argument("--self-test", action="store_true", help="セルフテストを実行")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    paths = list(args.files) if args.files else discover_default_files()
    if not paths:
        print("対象ファイルがありません", file=sys.stderr)
        return 0

    total = check_files(paths)
    if args.strict and total:
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        print(f"[design] checker error: {e}", file=sys.stderr)
        sys.exit(2)
