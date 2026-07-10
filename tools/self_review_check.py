#!/usr/bin/env python3
"""self_review_check.py（汎用ベース）

PR 作成前のセルフレビュー機械チェック。pre-pr-create-check.sh フックから呼ばれ、
Error 検出時（exit 1）に PR 作成をブロックする「Lv3 ハードコンストレイント」。

汎用ベースでは誤ブロックを避けるため保守的に、明確な事故のみを Error にする:
  - Error: マージコンフリクト痕跡（<<<<<<< / ======= / >>>>>>>）
  - Error: 巨大ファイルの新規追加（既定 5MB 超・SELF_REVIEW_MAX_MB で調整）
  - Warning: デバッグ痕跡（TODO/FIXME/console.log/print デバッグ等）※ブロックしない

プロジェクト固有のチェックは docs/rules/self-review-checklist.md に追記し、
本スクリプトに検査関数を足して拡張する。

終了コード: 0=合格 or Warning のみ / 1=Error あり（ブロック） / 2=チェッカー異常
"""
from __future__ import annotations
import os
import shutil
import subprocess
import sys
from pathlib import Path

MAX_MB = float(os.environ.get("SELF_REVIEW_MAX_MB", "5"))
CONFLICT_MARKERS = ("<<<<<<< ", "=======", ">>>>>>> ")

# CJK Markdown チェッカー（同ディレクトリの check_cjk_markdown.py）を再利用する。
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from check_cjk_markdown import process_text as _cjk_process_text
except ImportError:
    # ツール自体が無い場合のみ黙って無効化（任意機能）
    _cjk_process_text = None
except Exception as _e:  # noqa: BLE001
    # ツールはあるが壊れている → 黙殺すると再発防止が機能しないので原因を出す
    print(f"[self-review] Warning: check_cjk_markdown の読み込みに失敗（CJK 検査を無効化）: {_e}",
          file=sys.stderr)
    _cjk_process_text = None

# Python 危険パターン検出（FAIR Layer 0 強化・#56）。
try:
    from scan_dangerous_patterns import scan_text as _scan_py
except ImportError:
    # ツール自体が無い場合のみ黙って無効化（任意機能）
    _scan_py = None
except Exception as _e:  # noqa: BLE001
    # ツールはあるが壊れている（SyntaxError 等）→ 黙殺するとセキュリティ検査が静かに無効化される
    print(f"[self-review] Warning: scan_dangerous_patterns の読み込みに失敗（危険パターン検査を無効化）: {_e}",
          file=sys.stderr)
    _scan_py = None


def cjk_violation_lines(text: str) -> list[int]:
    """CJK 半角スペース違反のある行番号一覧を返す（チェッカー不在時は空）。"""
    if _cjk_process_text is None:
        return []
    try:
        _, violations = _cjk_process_text(text, fix=False)
        return [ln for ln, _ in violations]
    except Exception as e:  # noqa: BLE001
        print(f"[self-review] Warning: CJK 検査でエラー: {e}", file=sys.stderr)
        return []


def sh(args, timeout=20):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def default_branch() -> str:
    r = sh(["git", "symbolic-ref", "refs/remotes/origin/HEAD"])
    if r.returncode == 0 and r.stdout.strip():
        return r.stdout.strip().split("/")[-1]
    return "main"


def changed_files() -> list[str]:
    base = f"origin/{default_branch()}"
    r = sh(["git", "diff", "--name-only", f"{base}...HEAD"])
    # split() ではなく splitlines()。スペースを含むパスを 1 件として扱う
    files = r.stdout.splitlines() if r.returncode == 0 else []
    # ステージ済み・作業ツリーの変更も含める
    for extra in (["git", "diff", "--name-only"], ["git", "diff", "--cached", "--name-only"]):
        rr = sh(extra)
        if rr.returncode == 0:
            files += rr.stdout.splitlines()
    # 未追跡（git add 前の新規ファイル）も含める。git diff は untracked を出さないため、
    # これが無いと新規 .md が CJK 検査から漏れて AI レビュー指摘が再発する（#63）
    ru = sh(["git", "ls-files", "--others", "--exclude-standard"])
    if ru.returncode == 0:
        files += ru.stdout.splitlines()
    # 実在する追跡対象ファイルのみ、重複排除
    seen, out = set(), []
    for f in files:
        if f not in seen and Path(f).is_file():
            seen.add(f); out.append(f)
    return out


def main() -> int:
    if not Path(".git").exists() and sh(["git", "rev-parse", "--git-dir"]).returncode != 0:
        return 2

    errors: list[str] = []
    warnings: list[str] = []
    files = changed_files()

    for f in files:
        p = Path(f)
        try:
            size_mb = p.stat().st_size / (1024 * 1024)
            if size_mb > MAX_MB:
                errors.append(f"巨大ファイル: {f}（{size_mb:.1f}MB > {MAX_MB}MB）。Git LFS か別管理を検討してください。")
                continue
            # バイナリは内容スキャンしない
            raw = p.read_bytes()
            if b"\x00" in raw[:4096]:
                continue
            text = raw.decode("utf-8", errors="ignore")
        except Exception:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            if any(line.startswith(m) or line == m for m in CONFLICT_MARKERS):
                errors.append(f"マージコンフリクト痕跡: {f}:{i}")
            low = line.lower()
            if "console.log(" in low or "debugger;" in low or "import pdb" in low:
                warnings.append(f"デバッグ痕跡の可能性: {f}:{i}")

        # CJK Markdown 半角スペース（CLAUDE.md「Markdown 出力ルール」）
        # 目視では見落とすため機械化（AI レビュアーの同種指摘を未然に防ぐ）
        if f.endswith((".md", ".markdown")):
            cjk_lines = cjk_violation_lines(text)
            if cjk_lines:
                shown = ", ".join(str(n) for n in cjk_lines[:8])
                ellipsis = "…" if len(cjk_lines) > 8 else ""
                warnings.append(
                    f"CJK 半角スペース違反: {f}（{len(cjk_lines)} 行: {shown}{ellipsis}）"
                    f" → python3 tools/check_cjk_markdown.py --fix {f}"
                )

        # Python 危険パターン（FAIR Layer 0 強化・#56）
        # ERROR=コマンドインジェクション/eval/pickle 等の高危険（ブロック）、WARNING=資格情報ハードコード等。
        # SELF_REVIEW_SECURITY=warn で ERROR を非ブロック化する逃げ道を用意（保守的運用）。
        if f.endswith(".py") and _scan_py is not None:
            block_security = os.environ.get("SELF_REVIEW_SECURITY", "block").lower() != "warn"
            try:
                for lineno, sev, code, msg in _scan_py(text, f):
                    entry = f"危険パターン {code}: {f}:{lineno} {msg}"
                    if sev == "ERROR" and block_security:
                        errors.append(entry)
                    else:
                        warnings.append(entry)
            except Exception as e:  # noqa: BLE001
                warnings.append(f"危険パターン検査でエラー: {f}: {e}")

    # 月次コストテレメトリの feature PR 混入チェック（#106 回帰検知）
    # cost_monthly は専用 PR（commit_cost_telemetry.py）でのみ main に永続化する。
    # それ以外のブランチの差分に現れたら、Stop hook の WIP 除外が壊れた回帰シグナル。
    cur_branch = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    if not cur_branch.startswith("chore/cost-telemetry"):
        tele = [f for f in files if f.startswith("content/analytics/cost_monthly/")]
        if tele:
            warnings.append(
                "月次コストテレメトリが feature 差分に混入しています（#106 回帰）: "
                f"{', '.join(tele)} → Stop hook の WIP add 除外を確認し、差分から外してください"
            )

    # ruff 補助セキュリティチェック（FAIR Layer 0 補完・#56・opt-in）
    # 既定 OFF（誤検知ノイズ回避）。SELF_REVIEW_RUFF=1 かつ ruff 在の時のみ S(=bandit) を Warning 表示。
    if os.environ.get("SELF_REVIEW_RUFF") == "1" and shutil.which("ruff"):
        py_files = [f for f in files if f.endswith(".py")]
        if py_files:
            rr = sh(["ruff", "check", "--select", "S", "--output-format", "concise", *py_files])
            for line in (rr.stdout or "").splitlines():
                s = line.strip()
                if s and ".py:" in s and not s.lower().startswith(("found", "warning:", "error:")):
                    warnings.append(f"ruff(S): {s}")

    # スプリントメタのリマインド（session-sprint-rules.md §2/§5・#45・非ブロッキング）
    # PR の Session-Id / sp:N 記載漏れを未然に防ぐ（done_sp・セッション別ベロシティ計測のため）。
    # PR 本文・ラベルはこの時点で未確定のため Error にはせず Warning に留める（PR template と二重防御）。
    if files:
        br = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"])
        cur = br.stdout.strip() if br.returncode == 0 else ""
        if cur not in ("", "main", "master", "HEAD"):
            sid = os.environ.get("CLAUDE_CODE_SESSION_ID", "").strip()
            sid_hint = f"Session-Id: {sid}" if sid else "Session-Id: $CLAUDE_CODE_SESSION_ID を PR 本文へ"
            warnings.append(
                "スプリントメタを PR 本文に記載してください（session-sprint-rules.md §2/§5）: "
                f"{sid_hint} ＋ sp:N ラベル（project-mission.md 工程別標準値 + Dynamic 補正）"
            )

    if warnings:
        print("[self-review] Warning:")
        for w in warnings[:20]:
            print(f"  - {w}")
    if errors:
        print("[self-review] Error（PR 作成をブロックします）:")
        for e in errors[:20]:
            print(f"  - {e}")
        return 1
    print("[self-review] OK（Error なし）")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"[self-review] checker error: {e}", file=sys.stderr)
        sys.exit(2)
