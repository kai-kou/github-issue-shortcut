#!/usr/bin/env python3
"""Cloudflare Workers 利用状況の定期取得・履歴化ツール（Issue #235）

`workersInvocationsAdaptive`（GraphQL Analytics）の日次値をセッションごとに取り込み、
テレメトリ専用データブランチ `telemetry/worker-usage` へ永続化する。

【なぜ要るのか】
Cloudflare の GraphQL Analytics は **32 日（4w4d）より過去のレンジを拒否する**。
ダッシュボードを見に行く運用も続かない（GA4 導入検討 2026-07-28 の結論 C-4）。
そのため「定期実行のたびに日次値を取り込んで自前で履歴化する」以外に、長期の
利用状況を残す手段がない。

【取れる数字 / 取れない数字】
- 取れる: requests / errors / subrequests（日次）。無料枠（100,000 req/日）の消費率。
- 取れない: **ユニーク利用者数・DAU**。Workers のメトリクスにユニーク軸は無く、
  workers.dev 運用のためゾーンの `uniques` も使えず、`invocation_logs: false` +
  サンプリング 5% でリクエスト単位ログも残さない（P4・保持ゼロの設計）。
  利用者数の計測は Workers Analytics Engine の導入判断（#195）の範囲にゃ。

【データの流れ】
  Claude が MCP（mcp__Cloudflare_API__execute）で GraphQL を叩く
    → 応答 JSON を本ツールに stdin で渡す（--ingest -）
    → リモート履歴を hydrate してマージ（同一日はフィールド毎 max）
    → content/analytics/worker_usage/YYYY-MM.json（gitignore 対象・ローカル作業用）
    → --push で telemetry/worker-usage へ plain git push（main を汚さず PR も作らない）

使い方:
  python3 tools/record_worker_usage.py --ingest - --push --summary   # ルーティンの標準形
  python3 tools/record_worker_usage.py --summary --days 7            # 集計だけ見る
  python3 tools/record_worker_usage.py --push --dry-run              # 差分判定のみ
  python3 tools/record_worker_usage.py --report-due                  # 週次サマリー投稿の要否
  python3 tools/record_worker_usage.py --mark-reported --push        # 投稿済みを記録
  python3 tools/record_worker_usage.py --self-test                   # ロジックの自己テスト

データの参照方法:
  git fetch origin telemetry/worker-usage
  git show origin/telemetry/worker-usage:content/analytics/worker_usage/SUMMARY.md
"""

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import telemetry_branch  # noqa: E402

JST = timezone(timedelta(hours=9))
USAGE_REL_DIR = "content/analytics/worker_usage"
SUMMARY_REL = f"{USAGE_REL_DIR}/SUMMARY.md"
TELEMETRY_BRANCH = "telemetry/worker-usage"
LOG_PREFIX = "[worker-usage]"
SCRIPT_NAME = "github-issue-shortcut"
# Workers 無料プランの日次リクエスト上限（UTC 00:00 リセット）。超えると Error 1027 で全停止する。
FREE_TIER_DAILY_REQUESTS = 100_000
WARN_RATIO, CRITICAL_RATIO = 0.70, 0.90
METRIC_KEYS = ("requests", "errors", "subrequests")
DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}")
DEFAULT_REPORT_INTERVAL_DAYS = 7

BRANCH_README = (
    "# telemetry/worker-usage\n\n"
    "Cloudflare Workers（`github-issue-shortcut`）の日次利用状況（機械生成テレメトリ）専用の\n"
    "データブランチにゃ。\n\n"
    "- 書き込みは `tools/record_worker_usage.py` のみ（スプリントルーティン Step 1.6 から実行）。\n"
    "- main とはマージしない（コード履歴を汚さない・telemetry/cost-data と同じ方針）。\n"
    "- Cloudflare の GraphQL Analytics は 32 日より過去を返さないため、ここが長期履歴の正本になる。\n"
    "- 含むのはリクエスト数・エラー数・サブリクエスト数のみ。**利用者を識別する情報は含まない**\n"
    "  （そもそも Workers のメトリクスに個人を識別できる軸が無い）。\n"
    "- 参照: `git show origin/telemetry/worker-usage:content/analytics/worker_usage/SUMMARY.md`\n"
)


# ──────────────────────────────────────────────────────────
# 取り込み（GraphQL 応答 → 日次レコード）
# ──────────────────────────────────────────────────────────

def extract_daily(payload) -> dict:
    """GraphQL 応答（形状ゆらぎ込み）から {日付: {requests, errors, subrequests}} を抽出する。

    MCP の戻り値は呼び出し方で `{result: {data: {viewer: ...}}}` にも `{viewer: ...}` にも
    なるため、形状を決め打ちせず `workersInvocationsAdaptive` 配列を再帰的に探す。
    正規化済みの `{"daily": {...}}` もそのまま受け付ける（再取り込み・テスト用）。
    """
    out: dict = {}

    def add(date: str, sums: dict) -> None:
        # 日付は月次ファイル名（= 書き込み先パス）になるため、書式が合わないレコードは捨てる。
        # 長さだけの検査では "../../evil" のような 10 文字の値が通り、意図した
        # content/analytics/worker_usage/ の外へ書き込めてしまう（セルフレビュー指摘）。
        if not DATE_PATTERN.fullmatch(date or ""):
            return
        rec = out.setdefault(date, {k: 0 for k in METRIC_KEYS})
        for key in METRIC_KEYS:
            try:
                val = int(sums.get(key) or 0)
            except (TypeError, ValueError):
                continue
            rec[key] = max(rec[key], val)

    def walk(node) -> None:
        if isinstance(node, dict):
            for key, val in node.items():
                if key == "daily" and isinstance(val, dict):
                    for date, rec in val.items():
                        if isinstance(rec, dict):
                            add(str(date)[:10], rec)
                elif key == "workersInvocationsAdaptive" and isinstance(val, list):
                    for item in val:
                        if not isinstance(item, dict):
                            continue
                        dims = item.get("dimensions") or {}
                        date = str(dims.get("date") or dims.get("datetime") or "")[:10]
                        add(date, item.get("sum") or {})
                else:
                    walk(val)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    return {d: rec for d, rec in out.items() if len(d) == 10}


# ──────────────────────────────────────────────────────────
# マージ / 直列化（self-test 対象）
# ──────────────────────────────────────────────────────────

def recompute_totals(daily: dict) -> dict:
    totals = {k: 0 for k in METRIC_KEYS}
    totals["days"] = 0
    for rec in daily.values():
        if not isinstance(rec, dict):
            continue
        totals["days"] += 1
        for key in METRIC_KEYS:
            try:
                totals[key] += int(rec.get(key) or 0)
            except (TypeError, ValueError):
                pass
    return totals


def _merge_day(a: dict, b: dict) -> dict:
    """同一日のレコードをフィールド毎の max で統合する（単調性フロア）。

    GraphQL は当日分を「その時点まで」の値で返すため、後の実行ほど値が大きい。max なら
    実行順序に依存せず、部分ビュー（fresh コンテナの取得漏れ）が履歴を後退させない。
    """
    merged = {}
    for key in METRIC_KEYS:
        vals = []
        for src in (a, b):
            try:
                vals.append(int((src or {}).get(key) or 0))
            except (TypeError, ValueError):
                pass
        merged[key] = max(vals) if vals else 0
    return merged


def merge_month(month: str, remote: dict | None, local: dict | None) -> dict:
    """リモート（正本）とローカルの月次レポートを統合する。"""
    remote = remote if isinstance(remote, dict) else {}
    local = local if isinstance(local, dict) else {}
    r_daily = remote.get("daily") if isinstance(remote.get("daily"), dict) else {}
    l_daily = local.get("daily") if isinstance(local.get("daily"), dict) else {}
    daily = {}
    for date in sorted(set(r_daily) | set(l_daily)):
        daily[date] = _merge_day(r_daily.get(date) or {}, l_daily.get(date) or {})
    report = {
        "month": month,
        "script": SCRIPT_NAME,
        "free_tier_daily_requests": FREE_TIER_DAILY_REQUESTS,
        "daily": daily,
        "totals": recompute_totals(daily),
        "last_updated": max(str(remote.get("last_updated") or ""),
                            str(local.get("last_updated") or "")),
    }
    reported = max(str(remote.get("last_reported_at") or ""),
                   str(local.get("last_reported_at") or ""))
    if reported:
        report["last_reported_at"] = reported
    return report


def serialize(report: dict) -> str:
    return json.dumps(report, ensure_ascii=False, indent=2) + "\n"


def substance(report: dict | None) -> str:
    """実データ（last_updated を除く）の同一性判定キー。冪等 push の判断に使う。"""
    if not isinstance(report, dict):
        return ""
    return json.dumps({
        "daily": report.get("daily") or {},
        "last_reported_at": report.get("last_reported_at") or "",
    }, ensure_ascii=False, sort_keys=True)


# ──────────────────────────────────────────────────────────
# ローカル / リモートの読み書き
# ──────────────────────────────────────────────────────────

def usage_dir() -> Path:
    return telemetry_branch.project_dir() / USAGE_REL_DIR


def read_local_months() -> dict:
    return telemetry_branch.read_local_jsons(usage_dir(), LOG_PREFIX)


def read_remote_month(month: str) -> dict | None:
    ref = telemetry_branch.remote_ref(TELEMETRY_BRANCH)
    return telemetry_branch.json_at(f"{ref}:{USAGE_REL_DIR}/{month}.json")


def write_local_month(month: str, report: dict) -> None:
    d = usage_dir()
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{month}.json").write_text(serialize(report), encoding="utf-8")


def hydrate_from_remote() -> str:
    """データブランチの履歴をローカルへ取り込む（fresh コンテナ対策・失敗しても続行）。"""
    state = telemetry_branch.sync_remote_ref(TELEMETRY_BRANCH)
    if state != "ok":
        if state == "error":
            print(f"{LOG_PREFIX} リモート履歴の取得に失敗（ローカル分だけで続行）", file=sys.stderr)
        return state
    ref = telemetry_branch.remote_ref(TELEMETRY_BRANCH)
    ls = telemetry_branch.run(["git", "ls-tree", "-r", "--name-only", ref, "--", USAGE_REL_DIR],
                              timeout=30, cwd=str(telemetry_branch.project_dir()))
    if ls.returncode != 0:
        return state
    local = read_local_months()
    for rel in ls.stdout.splitlines():
        rel = rel.strip()
        if not rel.endswith(".json"):
            continue
        month = Path(rel).stem
        remote = telemetry_branch.json_at(f"{ref}:{rel}")
        if remote is None:
            continue
        write_local_month(month, merge_month(month, remote, local.get(month)))
    return state


def ingest(daily: dict) -> list:
    """抽出済み日次レコードをローカル月次ファイルへマージする。更新された月を返す。"""
    now = datetime.now(JST).isoformat(timespec="seconds")
    local = read_local_months()
    touched = []
    for month in sorted({d[:7] for d in daily}):
        incoming = {"daily": {d: rec for d, rec in daily.items() if d[:7] == month},
                    "last_updated": now}
        merged = merge_month(month, local.get(month), incoming)
        # merge_month が選んだ値より古い時刻へ後退させない（並行書き込みでの単調性）
        merged["last_updated"] = max(str(merged.get("last_updated") or ""), now)
        write_local_month(month, merged)
        touched.append(month)
    return touched


def mark_reported() -> str:
    """週次サマリーを投稿した時刻を最新月のレポートへ記録する（データブランチで永続化）。"""
    now = datetime.now(JST).isoformat(timespec="seconds")
    months = read_local_months()
    if not months:
        print(f"{LOG_PREFIX} 記録対象の月次ファイルがない（--ingest が先）", file=sys.stderr)
        return ""
    month = max(months)
    report = months[month]
    report["last_reported_at"] = now
    write_local_month(month, report)
    return now


def last_reported_at() -> str:
    values = [str(rep.get("last_reported_at") or "") for rep in read_local_months().values()]
    return max(values) if values else ""


def report_due(interval_days: int = DEFAULT_REPORT_INTERVAL_DAYS,
               now: datetime | None = None, stamp: str | None = None) -> tuple:
    """週次サマリー投稿の要否を (due, 理由) で返す（now / stamp はテスト用に注入可能）。"""
    stamp = last_reported_at() if stamp is None else stamp
    now = now or datetime.now(JST)
    if not stamp:
        return True, "未投稿（初回）"
    try:
        prev = datetime.fromisoformat(stamp)
    except ValueError:
        return True, f"last_reported_at を解釈できない（{stamp}）"
    elapsed = (now - prev).days
    if elapsed >= interval_days:
        return True, f"前回投稿から {elapsed} 日経過（閾値 {interval_days} 日）"
    return False, f"前回投稿から {elapsed} 日（閾値 {interval_days} 日未満）"


# ──────────────────────────────────────────────────────────
# 集計 / サマリー
# ──────────────────────────────────────────────────────────

def flatten_daily(months: dict) -> dict:
    daily: dict = {}
    for rep in months.values():
        for date, rec in (rep.get("daily") or {}).items():
            if isinstance(rec, dict):
                daily[date] = _merge_day(daily.get(date) or {}, rec)
    return dict(sorted(daily.items()))


def window(daily: dict, anchor: str, days: int) -> dict:
    """anchor（含む）から遡って days 日分のレコードを返す。"""
    try:
        end = datetime.strptime(anchor, "%Y-%m-%d")
    except ValueError:
        return {}
    start = (end - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    return {d: rec for d, rec in daily.items() if start <= d <= anchor}


def _agg(recs: dict) -> dict:
    total = recompute_totals(recs)
    peak_date, peak = "", 0
    for date, rec in sorted(recs.items()):
        val = int(rec.get("requests") or 0)
        if val >= peak:
            peak_date, peak = date, val
    return {**total, "peak": peak, "peak_date": peak_date,
            "avg": round(total["requests"] / total["days"], 1) if total["days"] else 0.0}


def verdict(peak_requests: int) -> str:
    if peak_requests >= FREE_TIER_DAILY_REQUESTS * CRITICAL_RATIO:
        return "Critical"
    if peak_requests >= FREE_TIER_DAILY_REQUESTS * WARN_RATIO:
        return "Warning"
    return "正常"


def summarize(daily: dict, anchor: str, days: int = 30) -> dict:
    recent = window(daily, anchor, days)
    week = window(daily, anchor, 7)
    today = daily.get(anchor) or {}
    long_agg, week_agg = _agg(recent), _agg(week)
    return {
        "anchor": anchor,
        "days": days,
        "coverage": (min(daily), max(daily), len(daily)) if daily else ("", "", 0),
        "long": long_agg,
        "week": week_agg,
        "today_requests": int(today.get("requests") or 0),
        "today_ratio": round(int(today.get("requests") or 0) / FREE_TIER_DAILY_REQUESTS * 100, 3),
        "peak_ratio": round(long_agg["peak"] / FREE_TIER_DAILY_REQUESTS * 100, 3),
        # 枠は UTC 00:00 でリセットされるため、ルーティンの判定（Warning / Critical → A-6 打診）は
        # **当日の消費量** で決める。期間内ピークで判定すると、過去のスパイクが残っている限り
        # 当日が正常でも Critical を出し続け、不要なユーザーエスカレーションを招く（セルフレビュー指摘）。
        "verdict": verdict(int(today.get("requests") or 0)),
        "peak_verdict": verdict(long_agg["peak"]),
        "error_days": {d: int(r.get("errors") or 0)
                       for d, r in sorted(recent.items()) if int(r.get("errors") or 0) > 0},
    }


def format_summary(s: dict) -> str:
    first, last, n = s["coverage"]
    lines = [
        f"## Cloudflare Workers 利用状況（`{SCRIPT_NAME}`）",
        "",
        f"- **記録期間**: {first} 〜 {last}（{n} 日分・UTC 日付）",
    ]
    if s["days"] > 7:  # 集計幅が 7 日以下なら下の行と重複するので出さない
        lines.append(
            f"- **直近 7 日**: {s['week']['requests']:,} requests"
            f"（平均 {s['week']['avg']}/日・ピーク {s['week']['peak']:,} @ {s['week']['peak_date'] or '—'}）")
    lines += [
        f"- **直近 {s['days']} 日**: {s['long']['requests']:,} requests"
        f"（平均 {s['long']['avg']}/日・エラー {s['long']['errors']:,}"
        f" / サブリクエスト {s['long']['subrequests']:,}）",
        f"- **当日（{s['anchor']}・UTC）**: {s['today_requests']:,} requests"
        f"（無料枠 {FREE_TIER_DAILY_REQUESTS:,} req/日 の {s['today_ratio']}%）→ **{s['verdict']}**",
        f"- **期間内ピーク**: {s['long']['peak']:,} requests"
        f"（{s['long']['peak_date'] or '—'}・無料枠の {s['peak_ratio']}%・当時の水準は {s['peak_verdict']}）",
    ]
    if s["error_days"]:
        detail = " / ".join(f"{d}（{n} 件）" for d, n in s["error_days"].items())
        lines.append(f"- **エラーのあった日**: {detail}")
    lines += [
        "",
        "> requests は Worker への総リクエスト数であり、**利用者数ではない**"
        "（Workers のメトリクスにユニーク軸は存在しない・利用者数の計測は #195 の範囲）。",
        "> 生成: `python3 tools/record_worker_usage.py --summary`",
    ]
    return "\n".join(lines) + "\n"


def build_summary(days: int = 30, anchor: str | None = None,
                  months: dict | None = None) -> str:
    """集計サマリーを Markdown で返す。

    months を渡すとその月次レポート群から組み立てる（push 時に「リモートと再マージ済みの
    データ」を渡すため。ローカルだけから作ると、並行セッションの push を吸収した月次 JSON と
    同じコミット内の SUMMARY.md が食い違う・セルフレビュー指摘）。
    """
    daily = flatten_daily(read_local_months() if months is None else months)
    if not daily:
        return f"{LOG_PREFIX} 記録がまだない（--ingest で取り込む）\n"
    anchor = anchor or max(max(daily), datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    return format_summary(summarize(daily, anchor, days))


# ──────────────────────────────────────────────────────────
# データブランチへの push
# ──────────────────────────────────────────────────────────

def compute_changes() -> dict:
    """永続化が必要な月次レポートを {month: merged_report} で返す（実データ差分のみ）。"""
    changes: dict = {}
    for month, local in read_local_months().items():
        remote = read_remote_month(month)
        merged = merge_month(month, remote, local)
        if substance(merged) != substance(remote):
            changes[month] = merged
    return changes


def _build_payload(parent_sha: str | None, remote_state: str):
    changes = compute_changes()
    if not changes:
        return None, "", ""
    entries = {f"{USAGE_REL_DIR}/{month}.json": serialize(report)
               for month, report in changes.items()}
    # SUMMARY.md は「同じコミットで書き込む月次 JSON」と同じデータから作る（再マージ後の値を反映）
    entries[SUMMARY_REL] = build_summary(months={**read_local_months(), **changes})
    if not parent_sha:
        entries["README.md"] = BRANCH_README
    months = ", ".join(sorted(changes))
    return entries, f"chore(telemetry): Workers 利用状況を更新（{months}）", months


def push(dry_run: bool = False) -> bool:
    return telemetry_branch.push_entries(TELEMETRY_BRANCH, _build_payload,
                                         LOG_PREFIX, dry_run=dry_run)


# ──────────────────────────────────────────────────────────
# self-test
# ──────────────────────────────────────────────────────────

def self_test() -> int:
    failures = []
    graphql_full = {"result": {"data": {"viewer": {"accounts": [{
        "workersInvocationsAdaptive": [
            {"dimensions": {"date": "2099-01-01"},
             "sum": {"requests": 10, "errors": 0, "subrequests": 4}},
            {"dimensions": {"date": "2099-01-02"},
             "sum": {"requests": 20, "errors": 1, "subrequests": 8}},
        ]}]}}}}
    mcp_shallow = {"viewer": {"accounts": [{
        "workersInvocationsAdaptive": [
            {"dimensions": {"datetime": "2099-01-03T00:00:00Z"},
             "sum": {"requests": 5, "errors": 0, "subrequests": 0}},
            {"dimensions": {}, "sum": {"requests": 999}},  # 日付なしは捨てる
        ]}]}}

    # 1) フル応答・MCP の浅い形・日付なしレコードの扱い
    d1 = extract_daily(graphql_full)
    if set(d1) != {"2099-01-01", "2099-01-02"} or d1["2099-01-02"]["errors"] != 1:
        failures.append(f"GraphQL フル応答の抽出が不正: {d1}")
    d2 = extract_daily(mcp_shallow)
    if set(d2) != {"2099-01-03"} or d2["2099-01-03"]["requests"] != 5:
        failures.append(f"MCP 形状 / 日付なしレコードの扱いが不正: {d2}")

    # 2) 正規化済み {"daily": ...} の再取り込み
    d3 = extract_daily({"daily": {"2099-01-04": {"requests": 7, "errors": 0, "subrequests": 1}}})
    if d3.get("2099-01-04", {}).get("requests") != 7:
        failures.append(f"正規化済みデータの取り込みが不正: {d3}")

    # 3) マージ: 過去日を保全しつつ、同一日はフィールド毎 max（部分ビューで後退しない）
    remote = {"month": "2099-01", "daily": {
        "2099-01-01": {"requests": 10, "errors": 0, "subrequests": 4},
        "2099-01-02": {"requests": 300, "errors": 2, "subrequests": 100},
    }, "last_updated": "2099-01-02T10:00:00+09:00"}
    partial = {"daily": {"2099-01-02": {"requests": 120, "errors": 0, "subrequests": 40}},
               "last_updated": "2099-01-02T18:00:00+09:00"}
    m = merge_month("2099-01", remote, partial)
    if set(m["daily"]) != {"2099-01-01", "2099-01-02"}:
        failures.append("過去日の保全に失敗")
    if m["daily"]["2099-01-02"]["requests"] != 300 or m["daily"]["2099-01-02"]["errors"] != 2:
        failures.append(f"部分ビューで値が後退（単調性違反）: {m['daily']['2099-01-02']}")
    if m["totals"]["requests"] != 310 or m["totals"]["days"] != 2:
        failures.append(f"totals 再計算が不正: {m['totals']}")

    # 4) 逆方向（ローカルの方がリッチ）でも max が効く
    m4 = merge_month("2099-01", partial, remote)
    if m4["daily"]["2099-01-02"]["requests"] != 300:
        failures.append("フィールド毎 max が片方向にしか効いていない")

    # 5) 冪等: last_updated だけ違えば差分なし。last_reported_at の変化は差分あり
    bumped = merge_month("2099-01", m, {"last_updated": "2099-01-09T23:59:59+09:00"})
    if substance(bumped) != substance(m):
        failures.append("last_updated のみ変化で差分ありと誤判定（冪等性違反）")
    reported = dict(m, last_reported_at="2099-01-09T00:00:00+09:00")
    if substance(reported) == substance(m):
        failures.append("last_reported_at の変化が差分として検出されない")

    # 6) 集計: 直近 7 日 / 30 日・ピーク・平均
    daily = {f"2099-02-{i:02d}": {"requests": i * 10, "errors": 0, "subrequests": 0}
             for i in range(1, 11)}  # 10〜100
    s = summarize(daily, "2099-02-10", 30)
    if s["long"]["requests"] != 550 or s["long"]["peak"] != 100:
        failures.append(f"30 日集計が不正: {s['long']}")
    if s["week"]["requests"] != 490 or s["week"]["avg"] != 70.0:  # 40..100
        failures.append(f"7 日集計が不正: {s['week']}")
    if s["today_requests"] != 100:
        failures.append(f"当日値が不正: {s['today_requests']}")

    # 6b) 判定の主語は「当日」であって期間内ピークではない（過去スパイクで Critical が
    #     居座り、当日が正常なのに A-6 打診へ誘導される事故を防ぐ）
    spike = {"2099-02-01": {"requests": 95_000, "errors": 0, "subrequests": 0},
             "2099-02-10": {"requests": 500, "errors": 0, "subrequests": 0}}
    s6b = summarize(spike, "2099-02-10", 30)
    if s6b["verdict"] != "正常" or s6b["peak_verdict"] != "Critical":
        failures.append(f"判定の主語が当日になっていない: {s6b['verdict']} / {s6b['peak_verdict']}")

    # 7) 無料枠の閾値判定（70% / 90%）
    for peak, want in ((69_999, "正常"), (70_000, "Warning"), (89_999, "Warning"),
                       (90_000, "Critical")):
        if verdict(peak) != want:
            failures.append(f"閾値判定が不正: peak={peak} → {verdict(peak)}（期待 {want}）")

    # 8) エラーのあった日の抽出
    s8 = summarize({"2099-03-01": {"requests": 5, "errors": 2, "subrequests": 0},
                    "2099-03-02": {"requests": 5, "errors": 0, "subrequests": 0}},
                   "2099-03-02", 30)
    if s8["error_days"] != {"2099-03-01": 2}:
        failures.append(f"エラー日の抽出が不正: {s8['error_days']}")

    # 9) サマリー整形が実値を含む（Markdown として壊れていない）
    text = format_summary(s)
    if "利用者数ではない" not in text or "550" not in text:
        failures.append("サマリー整形が不正")

    # 10) 週次レポート要否（now / stamp を注入して境界と異常系を確認）
    base = datetime(2099, 1, 1, 12, 0, tzinfo=JST)
    cases = ((6, False), (7, True))
    for delta_days, want in cases:
        due, reason = report_due(now=base + timedelta(days=delta_days), stamp=base.isoformat())
        if due != want:
            failures.append(f"report_due の境界判定が不正: {delta_days} 日後 → {due}（期待 {want}・{reason}）")
    if not report_due(now=base, stamp="")[0]:
        failures.append("未投稿（初回）が due にならない")
    if not report_due(now=base, stamp="not-a-timestamp")[0]:
        failures.append("壊れた last_reported_at で due にならない（安全側に倒れていない）")

    # 10b) 日付書式の検証: 月次ファイル名（書き込み先パス）になるため、YYYY-MM-DD 以外は捨てる
    for bad_date in ("../../evil", "2099-1-1xx", "20990101AB", "  99-01-01"):
        got = extract_daily({"workersInvocationsAdaptive": [
            {"dimensions": {"date": bad_date}, "sum": {"requests": 1}}]})
        if got:
            failures.append(f"不正な日付を受理した（パス脱出の恐れ）: {bad_date!r} → {list(got)}")

    # 11) 壊れた入力でクラッシュしない
    for bad in (None, [], "x", {"workersInvocationsAdaptive": "not-a-list"},
                {"result": {"data": None}}):
        try:
            extract_daily(bad)
        except Exception as e:  # pragma: no cover
            failures.append(f"壊れた入力 {bad!r} で例外: {e}")

    # 12) serialize は末尾改行付き
    if not serialize({"month": "x"}).endswith("}\n"):
        failures.append("serialize の整形が不正")

    if failures:
        for f in failures:
            print(f"  ✗ {f}", file=sys.stderr)
        print(f"self-test FAILED（{len(failures)} 件）", file=sys.stderr)
        return 1
    print("self-test PASSED（14 ケース）")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Cloudflare Workers の日次利用状況を取り込み、データブランチへ履歴化する")
    ap.add_argument("--ingest", metavar="PATH",
                    help="GraphQL 応答 JSON（'-' で stdin）を取り込む")
    ap.add_argument("--summary", action="store_true", help="集計サマリーを Markdown で出力")
    ap.add_argument("--days", type=int, default=30, help="サマリーの集計日数（既定 30）")
    ap.add_argument("--push", action="store_true",
                    help=f"{TELEMETRY_BRANCH} へ永続化する")
    ap.add_argument("--dry-run", action="store_true", help="--push の差分判定のみ")
    ap.add_argument("--report-due", action="store_true",
                    help=f"週次サマリー投稿の要否（前回から {DEFAULT_REPORT_INTERVAL_DAYS} 日経過）を判定する")
    ap.add_argument("--mark-reported", action="store_true",
                    help="週次サマリーを投稿したことを記録する（--push で永続化）")
    ap.add_argument("--no-fetch", action="store_true",
                    help="リモート履歴の hydrate をスキップする（オフライン・テスト用）")
    ap.add_argument("--self-test", action="store_true", help="ロジックの自己テスト")
    args = ap.parse_args()

    if args.self_test:
        return self_test()
    if not any((args.ingest, args.summary, args.push, args.report_due, args.mark_reported)):
        ap.print_help()
        return 0

    if not args.no_fetch:
        hydrate_from_remote()

    if args.ingest:
        raw = sys.stdin.read() if args.ingest == "-" else Path(args.ingest).read_text(encoding="utf-8")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as e:
            print(f"{LOG_PREFIX} 入力 JSON を解釈できない: {e}", file=sys.stderr)
            return 1
        daily = extract_daily(payload)
        if not daily:
            print(f"{LOG_PREFIX} 日次レコードを抽出できなかった"
                  "（workersInvocationsAdaptive が空 or 形状違い）", file=sys.stderr)
            return 1
        months = ingest(daily)
        print(f"{LOG_PREFIX} 取り込み: {len(daily)} 日分"
              f"（{min(daily)} 〜 {max(daily)} / 月次: {', '.join(months)}）")

    if args.mark_reported:
        stamp = mark_reported()
        if stamp:
            print(f"{LOG_PREFIX} 週次サマリー投稿を記録: {stamp}")

    ok = True
    if args.push:
        ok = push(dry_run=args.dry_run)

    if args.report_due:
        due, reason = report_due()
        print(f"{LOG_PREFIX} report_due: {'yes' if due else 'no'}（{reason}）")

    if args.summary:
        print(build_summary(args.days))

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
