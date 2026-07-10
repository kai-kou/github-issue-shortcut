#!/usr/bin/env python3
"""
日次コストテレメトリ専用 PR ツール（Issue #106）
-------------------------------------------------
月次コスト集計（content/analytics/cost_monthly/YYYY-MM.json）を、作業中の feature
ブランチを一切汚さずに main へ永続化する。1 日 1 回、cost_monthly のみを含む専用
PR を作成して自動マージする。

【背景・根本原因】
従来は Stop hook の WIP 自動コミット `git add -A` が、同 hook が直前に `--flush` で
書き換えた cost_monthly（git 追跡・毎セッション更新）を無差別にステージし、feature
ブランチへ churn として混入させていた。レビューセッションはこれを「無関係 churn」と
正しく判定して破棄しようとし、永続化と churn 隔離が両立しない不健全なループに陥っていた。
本ツールは「永続化経路」を feature ブランチから完全に分離することで根絶する。

【設計】
- Stop hook 側は `content/analytics/cost_monthly/` を WIP `git add -A` から除外する
  （feature PR には二度と混入しない）。
- 本ツールが唯一の永続化経路。origin/main をベースにした使い捨て worktree 上で
  cost_monthly のみを commit し、専用ブランチ → PR → squash 自動マージする。
  作業中のチェックアウト（カレントブランチ／作業ツリー）には一切触れない。
- 冪等: origin/main の cost_monthly と「実データ（daily/totals。last_updated は無視）」を
  比較し、差分が無ければ no-op で終了（無意味な日次 PR を作らない）。
- `--gate-daily`: JST 当日に既に実行済みならスキップ（マーカーファイル）。Stop hook から
  毎セッション呼んでも 1 日 1 回に収束する（外部スケジューラ非依存）。

【テレメトリ PR をレビューなしで自動マージする理由】
cost_monthly はコードを含まない純粋なデータ（機械生成のコスト集計）であり、AI レビューの
対象にならない。pr-review-flow（コード PR 用）とは別レーンの「データ永続化用 PR」として
即時 squash マージする。

使い方:
  python3 tools/commit_cost_telemetry.py              # 差分があれば専用 PR を作成・マージ
  python3 tools/commit_cost_telemetry.py --gate-daily # 当日未実行のときだけ実行（Stop hook 用）
  python3 tools/commit_cost_telemetry.py --dry-run    # 差分判定のみ（git/gh を実行しない）
  python3 tools/commit_cost_telemetry.py --self-test  # merge/substance ロジックの自己テスト
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

# calc_daily_cost と定数・換算を共有（DRY）
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from calc_daily_cost import _MONTHLY_TOTAL_KEYS, USD_TO_JPY  # type: ignore
except Exception:  # pragma: no cover - フォールバック（import 失敗時も自己完結）
    _MONTHLY_TOTAL_KEYS = (
        "sessions", "input_tokens", "output_tokens",
        "cache_write_tokens", "cache_read_tokens", "cost_usd",
    )
    USD_TO_JPY = 150

JST = timezone(timedelta(hours=9))
MONTHLY_REL_DIR = "content/analytics/cost_monthly"
MARKER_REL = "content/pipeline-state/.cost_telemetry_pr_date"


def _run(cmd: list, timeout: int = 60, cwd: str | None = None) -> subprocess.CompletedProcess:
    """サブプロセス実行（テキスト・タイムアウト付き）。

    git/gh 不在（FileNotFoundError）やタイムアウトでも未ハンドル例外でクラッシュさせず、
    非ゼロ returncode の CompletedProcess を返す（呼び出し側は returncode で判定する）。
    """
    try:
        return subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8",
            timeout=timeout, cwd=cwd,
        )
    except FileNotFoundError as e:
        return subprocess.CompletedProcess(args=cmd, returncode=127, stdout="",
                                           stderr=f"command not found: {e}")
    except subprocess.TimeoutExpired as e:
        return subprocess.CompletedProcess(args=cmd, returncode=124, stdout="",
                                           stderr=f"timeout: {e}")


def project_dir() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())


def get_repo_slug() -> str | None:
    """git remote から owner/repo を導出する。kai-kou/github-issue-shortcut 等の未置換でも頑健に。"""
    env = os.environ.get("GITHUB_REPOSITORY")
    if env and "/" in env and "__" not in env:
        return env
    try:
        url = _run(["git", "remote", "get-url", "origin"], timeout=10,
                   cwd=str(project_dir())).stdout.strip()
    except Exception:
        return None
    if not url:
        return None
    url = url.rstrip("/")
    if url.endswith(".git"):
        url = url[:-4]
    parts = [p for p in url.replace(":", "/").split("/") if p]
    if len(parts) < 2:
        return None
    owner, repo = parts[-2], parts[-1]
    if "__" in owner or "__" in repo:  # 未置換プレースホルダ
        return None
    return f"{owner}/{repo}"


# ──────────────────────────────────────────────────────────
# マージ / 冪等比較ロジック（self-test 対象）
# ──────────────────────────────────────────────────────────

def recompute_totals(daily: dict) -> dict:
    """マージ後の daily から月次 totals を再計算する（calc_daily_cost と同一規則）。"""
    totals = {key: 0 for key in _MONTHLY_TOTAL_KEYS}
    totals["cost_usd"] = 0.0
    for day in daily.values():
        if not isinstance(day, dict):
            continue
        for key in _MONTHLY_TOTAL_KEYS:
            val = day.get(key)
            if val is None:
                continue
            if key == "cost_usd":
                totals[key] = round(totals[key] + float(val), 6)
            else:
                totals[key] += int(val)
    return totals


def merge_report(month: str, main_report: dict | None, local_report: dict) -> dict:
    """origin/main の月次レポートに、ローカル（最新 flush 済み）の日次データを上書きマージする。

    - daily: main の daily をベースに local の daily で上書き（local が新しい）。
      30 日ローテーションで生ログから消えた過去日も main 側に残っていれば保全される。
    - totals: マージ後 daily から再計算。
    - last_updated: 両者の最大値（単調増加）。
    """
    merged_daily: dict = {}
    if isinstance(main_report, dict) and isinstance(main_report.get("daily"), dict):
        merged_daily.update(main_report["daily"])
    if isinstance(local_report.get("daily"), dict):
        merged_daily.update(local_report["daily"])

    totals = recompute_totals(merged_daily)
    # last_updated が JSON 上 null（None）でも max() の str 比較で TypeError を出さないよう
    # `or ""` で確実に空文字へフォールバックする。
    main_lu = (main_report.get("last_updated") if isinstance(main_report, dict) else None) or ""
    last_updated = max(main_lu, local_report.get("last_updated") or "")
    return {
        "month": month,
        "totals": totals,
        "cost_jpy_approx": round(totals["cost_usd"] * USD_TO_JPY),
        "daily": dict(sorted(merged_daily.items())),
        "last_updated": last_updated,
    }


def substance(report: dict | None) -> str:
    """実データ（daily + totals）だけを正規化した比較キー。last_updated 等の揮発フィールドは無視。

    これにより「コストに実変化が無いのに last_updated だけ進んだ」churn では PR を作らない。
    """
    if not isinstance(report, dict):
        return ""
    core = {
        "daily": report.get("daily", {}),
        "totals": report.get("totals", {}),
    }
    return json.dumps(core, ensure_ascii=False, sort_keys=True)


def serialize(report: dict) -> str:
    """月次レポートを calc_daily_cost と同一フォーマットで直列化する。"""
    return json.dumps(report, ensure_ascii=False, indent=2) + "\n"


# ──────────────────────────────────────────────────────────
# main 側ファイル取得・差分計算
# ──────────────────────────────────────────────────────────

def read_local_monthly() -> dict:
    """ローカル作業ツリーの月次レポートを {month: report} で返す。"""
    out: dict = {}
    d = project_dir() / MONTHLY_REL_DIR
    if not d.is_dir():
        return out
    for f in sorted(d.glob("*.json")):
        try:
            rep = json.loads(f.read_text(encoding="utf-8"))
            if isinstance(rep, dict):
                out[f.stem] = rep
        except (json.JSONDecodeError, OSError):
            continue
    return out


def read_main_monthly(month: str) -> dict | None:
    """origin/main 上の月次レポートを取得する（存在しなければ None）。"""
    rel = f"{MONTHLY_REL_DIR}/{month}.json"
    try:
        cp = _run(["git", "show", f"origin/main:{rel}"], timeout=15, cwd=str(project_dir()))
    except Exception:
        return None
    if cp.returncode != 0 or not cp.stdout.strip():
        return None
    try:
        rep = json.loads(cp.stdout)
        return rep if isinstance(rep, dict) else None
    except json.JSONDecodeError:
        return None


def compute_changes() -> dict:
    """永続化が必要な月次レポートを {month: merged_report} で返す（実データ差分のみ）。"""
    changes: dict = {}
    for month, local_rep in read_local_monthly().items():
        main_rep = read_main_monthly(month)
        merged = merge_report(month, main_rep, local_rep)
        if substance(merged) != substance(main_rep):
            changes[month] = merged
    return changes


# ──────────────────────────────────────────────────────────
# 日次ゲート
# ──────────────────────────────────────────────────────────

def marker_path() -> Path:
    return project_dir() / MARKER_REL


def already_ran_today() -> bool:
    today = datetime.now(JST).strftime("%Y-%m-%d")
    try:
        return marker_path().read_text(encoding="utf-8").strip() == today
    except OSError:
        return False


def stamp_today() -> None:
    today = datetime.now(JST).strftime("%Y-%m-%d")
    p = marker_path()
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(today + "\n", encoding="utf-8")
    except OSError:
        pass


# ──────────────────────────────────────────────────────────
# PR 作成・マージ（使い捨て worktree で作業ツリーに触れない）
# ──────────────────────────────────────────────────────────

def has_open_telemetry_pr(repo: str) -> bool:
    """既存のオープンなテレメトリ PR があるか（重複 PR 量産の防止）。

    確認不能（クラウドでは gh pr list が 403・L-114）の場合は True を返して
    安全側（新規 PR を作らない）に倒す。False に縮退させると重複防止が無効化され、
    テレメトリ PR が量産されるため（Issue #133）。
    """
    cp = _run(
        ["gh", "pr", "list", "-R", repo, "--state", "open",
         "--json", "headRefName", "--limit", "50"],
        timeout=30, cwd=str(project_dir()),
    )
    if cp.returncode != 0:
        print(
            "[cost-telemetry] gh pr list 失敗（クラウドでは 403・L-114）。"
            "重複 PR の有無を確認できないため安全側でスキップします。"
            "必要なら mcp__github__list_pull_requests で確認して手動続行。",
            file=sys.stderr,
        )
        return True
    try:
        prs = json.loads(cp.stdout or "[]")
    except json.JSONDecodeError:
        print(
            "[cost-telemetry] gh pr list の出力を解析できず重複確認不能。安全側でスキップします。",
            file=sys.stderr,
        )
        return True
    return any(str(p.get("headRefName", "")).startswith("chore/cost-telemetry") for p in prs)


def create_and_merge_pr(repo: str, changes: dict) -> bool:
    """changes を専用ブランチ → PR → squash マージで main に永続化する。成功で True。"""
    pdir = str(project_dir())

    # Git のグローバル identity が無い環境（CI/コンテナ）でも commit できるようフォールバック。
    # setdefault なので既存の env / git config 設定がある場合はそれを尊重する。
    os.environ.setdefault("GIT_AUTHOR_NAME", "claude-code-bot")
    os.environ.setdefault("GIT_AUTHOR_EMAIL", "claude-code-bot@users.noreply.github.com")
    os.environ.setdefault("GIT_COMMITTER_NAME", "claude-code-bot")
    os.environ.setdefault("GIT_COMMITTER_EMAIL", "claude-code-bot@users.noreply.github.com")

    # マージが滞って前回の専用 PR がオープンのまま残っている場合は新規作成しない
    # （日次で重複テレメトリ PR が量産されるのを防ぐ。既存 PR は pr-review フローが処理する）。
    if has_open_telemetry_pr(repo):
        print("[cost-telemetry] 既存のオープンなテレメトリ PR があるためスキップ", file=sys.stderr)
        return False

    fetch = _run(["git", "fetch", "origin", "+main:refs/remotes/origin/main"], timeout=60, cwd=pdir)
    if fetch.returncode != 0:
        print(f"[cost-telemetry] fetch 失敗: {fetch.stderr.strip()}", file=sys.stderr)
        return False

    stamp = datetime.now(JST).strftime("%Y%m%d-%H%M%S")
    branch = f"chore/cost-telemetry-{stamp}"
    tmp = tempfile.mkdtemp(prefix="cost-telemetry-")
    worktree_added = False
    try:
        wt = _run(["git", "worktree", "add", "-b", branch, tmp, "origin/main"], timeout=60, cwd=pdir)
        if wt.returncode != 0:
            print(f"[cost-telemetry] worktree 追加失敗: {wt.stderr.strip()}", file=sys.stderr)
            return False
        worktree_added = True

        out_dir = Path(tmp) / MONTHLY_REL_DIR
        out_dir.mkdir(parents=True, exist_ok=True)
        for month, report in changes.items():
            (out_dir / f"{month}.json").write_text(serialize(report), encoding="utf-8")

        _run(["git", "add", MONTHLY_REL_DIR], timeout=30, cwd=tmp)
        months = ", ".join(sorted(changes))
        commit = _run(
            ["git", "commit", "-m", f"chore(telemetry): 月次コスト集計を更新（{months}）"],
            timeout=30, cwd=tmp,
        )
        if commit.returncode != 0:
            print(f"[cost-telemetry] commit 失敗: {commit.stderr.strip() or commit.stdout.strip()}",
                  file=sys.stderr)
            return False

        pushed = False
        for wait in (0, 2, 4, 8):
            if wait:
                import time
                time.sleep(wait)
            push = _run(["git", "push", "-u", "origin", branch], timeout=60, cwd=tmp)
            if push.returncode == 0:
                pushed = True
                break
        if not pushed:
            print("[cost-telemetry] push 失敗（リトライ尽きた）", file=sys.stderr)
            return False
    finally:
        if worktree_added:
            _run(["git", "worktree", "remove", "--force", tmp], timeout=30, cwd=pdir)
            # worktree remove は -b で作った local ブランチ ref を消さないため明示削除する
            # （失敗パスでユニーク名の孤児ブランチ ref が累積するのを防ぐ。リモートは PR が参照）。
            _run(["git", "branch", "-D", branch], timeout=15, cwd=pdir)
        else:
            try:
                import shutil
                shutil.rmtree(tmp, ignore_errors=True)
            except Exception:
                pass

    # PR 作成 → squash マージ（gh）
    body = (
        "月次コスト集計（`content/analytics/cost_monthly/`）の自動永続化 PR にゃ。\n\n"
        "- 機械生成のコストテレメトリのみを含み、コード差分は無い（AI レビュー対象外）。\n"
        "- feature ブランチへの churn 混入を避けるための専用永続化レーン（Issue #106）。\n"
    )
    pr = _run(
        ["gh", "pr", "create", "-R", repo, "--head", branch, "--base", "main",
         "--title", f"chore(telemetry): 月次コスト集計を更新（{months}）", "--body", body],
        timeout=60, cwd=pdir,
    )
    if pr.returncode != 0:
        print(f"[cost-telemetry] PR 作成失敗: {pr.stderr.strip()}", file=sys.stderr)
        return False

    # squash マージ（データ PR のため即時マージ。--admin → 失敗時 auto-merge へフォールバック）
    merged = _run(
        ["gh", "pr", "merge", branch, "-R", repo, "--squash", "--delete-branch", "--admin"],
        timeout=60, cwd=pdir,
    )
    if merged.returncode != 0:
        auto = _run(
            ["gh", "pr", "merge", branch, "-R", repo, "--squash", "--delete-branch", "--auto"],
            timeout=60, cwd=pdir,
        )
        if auto.returncode != 0:
            print("[cost-telemetry] マージ失敗（PR は作成済み）:\n"
                  f"  --admin: {merged.stderr.strip()}\n"
                  f"  --auto : {auto.stderr.strip()}",
                  file=sys.stderr)
            return False
    return True


# ──────────────────────────────────────────────────────────
# self-test
# ──────────────────────────────────────────────────────────

def self_test() -> int:
    failures = []

    # 1) 新規月: main 不在 → local がそのまま採用され、差分ありと判定される
    local = {"month": "2099-01", "totals": {}, "daily": {
        "2099-01-01": {"sessions": 1, "input_tokens": 10, "output_tokens": 20,
                        "cache_write_tokens": 0, "cache_read_tokens": 0, "cost_usd": 0.001},
    }, "last_updated": "2099-01-01T10:00:00+09:00"}
    merged = merge_report("2099-01", None, local)
    if merged["totals"]["sessions"] != 1 or merged["totals"]["input_tokens"] != 10:
        failures.append("新規月の totals 再計算が不正")
    if substance(merged) == substance(None):
        failures.append("新規月で差分なしと誤判定")

    # 2) main の過去日を保全しつつ local で当日を上書き
    main_rep = {"month": "2099-01", "totals": {}, "daily": {
        "2099-01-01": {"sessions": 1, "input_tokens": 10, "output_tokens": 20,
                        "cache_write_tokens": 0, "cache_read_tokens": 0, "cost_usd": 0.001},
        "2099-01-02": {"sessions": 1, "input_tokens": 5, "output_tokens": 5,
                        "cache_write_tokens": 0, "cache_read_tokens": 0, "cost_usd": 0.002},
    }, "last_updated": "2099-01-02T10:00:00+09:00"}
    local2 = {"month": "2099-01", "totals": {}, "daily": {
        "2099-01-02": {"sessions": 3, "input_tokens": 50, "output_tokens": 60,
                        "cache_write_tokens": 0, "cache_read_tokens": 0, "cost_usd": 0.009},
    }, "last_updated": "2099-01-02T18:00:00+09:00"}
    m2 = merge_report("2099-01", main_rep, local2)
    if set(m2["daily"]) != {"2099-01-01", "2099-01-02"}:
        failures.append("過去日の保全に失敗")
    if m2["daily"]["2099-01-02"]["sessions"] != 3:
        failures.append("当日上書きに失敗")
    if m2["totals"]["sessions"] != 4:  # 1（01日）+ 3（02日・上書き後）
        failures.append(f"マージ後 totals が不正: {m2['totals']['sessions']}")

    # 3) 冪等: last_updated だけ違い実データ同一なら差分なし
    #    本番の main 側ファイルは totals 再計算済みなので、テストでも再計算した totals を持たせる
    persisted = {
        "month": "2099-01",
        "totals": recompute_totals(main_rep["daily"]),
        "daily": main_rep["daily"],
        "last_updated": "2099-01-02T10:00:00+09:00",
    }
    bumped = merge_report("2099-01", persisted, {
        "month": "2099-01", "daily": main_rep["daily"],
        "last_updated": "2099-01-09T23:59:59+09:00",
    })
    if substance(bumped) != substance(persisted):
        failures.append("last_updated のみ変化で差分ありと誤判定（冪等性違反）")

    # 4) serialize は calc_daily_cost と同じ末尾改行付き
    if not serialize({"month": "x"}).endswith("}\n"):
        failures.append("serialize の整形が不正")

    # 5) last_updated が None（JSON null）でも TypeError を出さずマージできる
    try:
        m5 = merge_report("2099-02",
                          {"daily": {}, "last_updated": None},
                          {"daily": {}, "last_updated": None})
        if m5["last_updated"] != "":
            failures.append("last_updated=None のフォールバックが不正")
    except TypeError:
        failures.append("last_updated=None で TypeError（None 比較の回帰）")

    if failures:
        for f in failures:
            print(f"  ✗ {f}", file=sys.stderr)
        print(f"self-test FAILED（{len(failures)} 件）", file=sys.stderr)
        return 1
    print("self-test PASSED（5 ケース）")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="月次コスト集計を専用 PR で main に永続化する")
    ap.add_argument("--gate-daily", action="store_true",
                    help="JST 当日に既に実行済みならスキップ（Stop hook から毎回呼ぶ用）")
    ap.add_argument("--dry-run", action="store_true",
                    help="差分判定のみ。git/gh は実行しない")
    ap.add_argument("--self-test", action="store_true", help="ロジックの自己テスト")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    if args.gate_daily and already_ran_today():
        return 0

    # 実データ差分は最新の origin/main を基準に判定する（stale ref での誤マージ防止）。
    # dry-run はオフライン診断用途のためネットワークを使わない。
    if not args.dry_run:
        try:
            _run(["git", "fetch", "origin", "+main:refs/remotes/origin/main"],
                 timeout=60, cwd=str(project_dir()))
        except Exception:
            pass

    changes = compute_changes()
    if not changes:
        # 実データ差分なし → 永続化不要（無意味な日次 PR を作らない）
        if args.gate_daily:
            stamp_today()  # 当日チェック済みとして記録（空振りの再試行を抑制）
        print("[cost-telemetry] 永続化対象の差分なし（no-op）")
        return 0

    if args.dry_run:
        print(f"[cost-telemetry] dry-run: 差分のある月 = {', '.join(sorted(changes))}")
        return 0

    repo = get_repo_slug()
    if not repo:
        print("[cost-telemetry] REPO slug 未導出のためスキップ（origin/プレースホルダ未置換）",
              file=sys.stderr)
        return 0

    # gate-daily では「試行した」時点でマーカーを stamp する（成功時のみだと、gh pr create が
    # 認証等で失敗し続けたとき毎セッション新しいブランチを push し orphan が量産されるため）。
    # 失敗しても当日は再試行せず、翌日の実行で蓄積データごと再永続化する（best-effort・冪等）。
    if args.gate_daily:
        stamp_today()
    ok = create_and_merge_pr(repo, changes)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
