#!/usr/bin/env python3
"""テレメトリ専用データブランチへの永続化プリミティブ（共有モジュール・#235）

「main を汚さず・PR も作らず、機械生成データを専用ブランチへ plain git push で永続化する」
手順（`commit_cost_telemetry.py` で確立）を、複数のテレメトリ系ツールで共有するための
低レベルモジュールにゃ。

利用側:
  - `tools/commit_cost_telemetry.py` → `telemetry/cost-data`（月次トークン集計）
  - `tools/record_worker_usage.py`   → `telemetry/worker-usage`（Workers 利用状況）

設計上の要点（`commit_cost_telemetry.py` で確定した挙動をそのまま踏襲する）:
  - 一時 index（`GIT_INDEX_FILE`）で commit オブジェクトを構築し、通常の index・
    ワーキングツリー・チェックアウトに一切触れない（worktree も作らない）。
  - 並行セッション競合は push の non-fast-forward 拒否が排他ロックになる。拒否されたら
    リモートを fetch し直し、呼び出し側にペイロードを再構築させてから再 push する
    （最大 4 回・指数バックオフ）。
  - fetch 失敗（error）と「ブランチ未作成（absent）」を区別する。error のまま parentless
    コミットを作ると、実在するブランチに対して non-FF が確定する無駄玉になる。
  - 403・認証等の恒久失敗はリトライしない（Stop hook の実行予算を浪費しない）。
  - gh は使わない（クラウド実行環境でも git 経路は生存する・L-114）。
"""

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PUSH_BACKOFF_SECONDS = (0, 2, 4, 8)


def run(cmd: list, timeout: int = 60, cwd: str | None = None,
        env: dict | None = None, input_text: str | None = None) -> subprocess.CompletedProcess:
    """サブプロセス実行（テキスト・タイムアウト付き）。

    git 不在（FileNotFoundError）やタイムアウトでも未ハンドル例外でクラッシュさせず、
    非ゼロ returncode の CompletedProcess を返す（呼び出し側は returncode で判定する）。
    """
    try:
        return subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8",
            timeout=timeout, cwd=cwd, env=env, input=input_text,
        )
    except FileNotFoundError as e:
        return subprocess.CompletedProcess(args=cmd, returncode=127, stdout="",
                                           stderr=f"command not found: {e}")
    except subprocess.TimeoutExpired as e:
        return subprocess.CompletedProcess(args=cmd, returncode=124, stdout="",
                                           stderr=f"timeout: {e}")


def project_dir() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())


def remote_ref(branch: str) -> str:
    return f"refs/remotes/origin/{branch}"


def git_env() -> dict:
    """commit-tree 用の identity をフォールバック付きで用意する（既存設定は尊重）。"""
    env = os.environ.copy()
    env.setdefault("GIT_AUTHOR_NAME", "claude-code-bot")
    env.setdefault("GIT_AUTHOR_EMAIL", "claude-code-bot@users.noreply.github.com")
    env.setdefault("GIT_COMMITTER_NAME", "claude-code-bot")
    env.setdefault("GIT_COMMITTER_EMAIL", "claude-code-bot@users.noreply.github.com")
    return env


def sync_remote_ref(branch: str) -> str:
    """データブランチのリモート追跡 ref を最新化し、状態を返す。

    - "ok"    : fetch 成功（ref は最新）
    - "absent": リモートにブランチが存在しない（初回。parentless コミットを作ってよい）
    - "error" : ネットワーク等の失敗（absent と区別する。この状態で parentless コミットを
                作ると、実在するブランチに対して non-FF が確定する無駄玉になる）
    """
    cp = run(["git", "fetch", "origin", f"+refs/heads/{branch}:{remote_ref(branch)}"],
             timeout=45, cwd=str(project_dir()))
    if cp.returncode == 0:
        return "ok"
    ls = run(["git", "ls-remote", "--heads", "origin", branch],
             timeout=30, cwd=str(project_dir()))
    if ls.returncode == 0 and not ls.stdout.strip():
        return "absent"
    return "error"


def remote_branch_sha(branch: str) -> str | None:
    cp = run(["git", "rev-parse", "--verify", "--quiet", remote_ref(branch)],
             timeout=15, cwd=str(project_dir()))
    sha = cp.stdout.strip()
    return sha if cp.returncode == 0 and sha else None


def json_at(git_ref_path: str) -> dict | None:
    """`git show <ref>:<path>` の JSON を dict で返す（不在・破損は None）。"""
    cp = run(["git", "show", git_ref_path], timeout=15, cwd=str(project_dir()))
    if cp.returncode != 0 or not cp.stdout.strip():
        return None
    try:
        rep = json.loads(cp.stdout)
        return rep if isinstance(rep, dict) else None
    except json.JSONDecodeError:
        return None


def read_local_jsons(directory: Path, log_prefix: str | None = None) -> dict:
    """ディレクトリ内の `*.json` を {ファイル名の stem: dict} で読み込む（不在・破損はスキップ）。

    テレメトリ系ツールはいずれも「月次ファイルをディレクトリごと読む」ため共有する。
    log_prefix を渡すと破損ファイルを stderr に報告する（渡さなければ黙ってスキップ）。
    """
    out: dict = {}
    if not directory.is_dir():
        return out
    for f in sorted(directory.glob("*.json")):
        try:
            rep = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            if log_prefix:
                print(f"{log_prefix} 読み込み失敗（スキップ）: {f.name}: {e}", file=sys.stderr)
            continue
        if isinstance(rep, dict):
            out[f.stem] = rep
    return out


def build_commit(entries: dict, parent_sha: str | None, message: str,
                 log_prefix: str) -> str | None:
    """entries（{リポジトリ相対パス: 本文}）を含むコミットを plumbing で構築し SHA を返す。

    一時 index ファイルを使うため、通常の index・ワーキングツリーには一切影響しない。
    """
    pdir = str(project_dir())
    env = git_env()
    with tempfile.NamedTemporaryFile(prefix="telemetry-index-", delete=False) as tf:
        index_file = tf.name
    env["GIT_INDEX_FILE"] = index_file
    try:
        # 1) ベース tree を一時 index に読み込む（初回は空 index から開始）
        if parent_sha:
            rt = run(["git", "read-tree", f"{parent_sha}^{{tree}}"], timeout=30, cwd=pdir, env=env)
        else:
            rt = run(["git", "read-tree", "--empty"], timeout=30, cwd=pdir, env=env)
        if rt.returncode != 0:
            print(f"{log_prefix} read-tree 失敗: {rt.stderr.strip()}", file=sys.stderr)
            return None

        # 2) ペイロードを blob 化して index に登録
        for rel_path, content in entries.items():
            ho = run(["git", "hash-object", "-w", "--stdin"], timeout=30, cwd=pdir,
                     env=env, input_text=content)
            blob = ho.stdout.strip()
            if ho.returncode != 0 or not blob:
                print(f"{log_prefix} hash-object 失敗: {ho.stderr.strip()}", file=sys.stderr)
                return None
            ui = run(["git", "update-index", "--add", "--cacheinfo",
                      f"100644,{blob},{rel_path}"], timeout=30, cwd=pdir, env=env)
            if ui.returncode != 0:
                print(f"{log_prefix} update-index 失敗: {ui.stderr.strip()}", file=sys.stderr)
                return None

        # 3) tree → commit オブジェクトを構築
        wt = run(["git", "write-tree"], timeout=30, cwd=pdir, env=env)
        tree = wt.stdout.strip()
        if wt.returncode != 0 or not tree:
            print(f"{log_prefix} write-tree 失敗: {wt.stderr.strip()}", file=sys.stderr)
            return None
        ct_cmd = ["git", "commit-tree", tree, "-m", message]
        if parent_sha:
            ct_cmd[3:3] = ["-p", parent_sha]
        ct = run(ct_cmd, timeout=30, cwd=pdir, env=env)
        commit = ct.stdout.strip()
        if ct.returncode != 0 or not commit:
            print(f"{log_prefix} commit-tree 失敗: {ct.stderr.strip()}", file=sys.stderr)
            return None
        return commit
    finally:
        try:
            os.unlink(index_file)
        except OSError:
            pass


def push_retryable(push: subprocess.CompletedProcess) -> bool:
    """リトライで解決しうる push 失敗か（non-FF 競合 / タイムアウト系のみ）。

    403・認証等の恒久失敗まで 4 回リトライすると Stop hook の実行予算を浪費するため、
    それらは初回で打ち切る。
    """
    if push.returncode == 124:  # timeout
        return True
    err = (push.stderr or "").lower()
    return any(s in err for s in ("non-fast-forward", "fetch first", "cannot lock ref",
                                  "failed to push some refs"))


def push_entries(branch: str, build_payload, log_prefix: str,
                 dry_run: bool = False) -> bool:
    """ローカルデータをデータブランチへ push する（競合時は再マージ・リトライ）。

    build_payload(parent_sha, remote_state) は毎試行呼ばれ、以下を返すこと:
        (entries: dict[str, str] | None, commit_message: str, summary: str)
    entries が None または空なら「差分なし」として no-op 成功にする。毎試行呼ぶのは、
    non-fast-forward で弾かれた後に最新リモートへ再マージし直すためにゃ。

    dry_run=True は fetch + 差分判定・表示のみ（push しない・1 パス）。
    """
    pdir = str(project_dir())
    attempts = (0,) if dry_run else PUSH_BACKOFF_SECONDS
    for attempt, wait in enumerate(attempts):
        if wait:
            time.sleep(wait)
        state = sync_remote_ref(branch)
        if state == "error" and not dry_run:
            # absent と区別できないまま parentless コミットを作らない（non-FF 確定の無駄玉）
            print(f"{log_prefix} fetch 失敗（試行 {attempt + 1}/{len(attempts)}・"
                  "ネットワーク要因の可能性）", file=sys.stderr)
            continue
        parent = remote_branch_sha(branch)
        entries, message, summary = build_payload(parent, state)
        if not entries:
            print(f"{log_prefix} 永続化対象の差分なし（no-op）")
            return True
        if dry_run:
            note = "" if state == "ok" else f"（注: リモート ref 未取得 state={state}・全件差分扱いの可能性）"
            print(f"{log_prefix} dry-run: 差分 = {summary}{note}")
            return True
        commit = build_commit(entries, parent, message, log_prefix)
        if commit is None:
            return False
        push = run(["git", "push", "origin", f"{commit}:refs/heads/{branch}"],
                   timeout=45, cwd=pdir)
        if push.returncode == 0:
            print(f"{log_prefix} {branch} へ push 完了（{summary} / {commit[:12]}）")
            return True
        print(f"{log_prefix} push 失敗（試行 {attempt + 1}/{len(attempts)}）: "
              f"{push.stderr.strip()}", file=sys.stderr)
        if not push_retryable(push):
            break
    print(f"{log_prefix} 永続化失敗（次セッションが再試行する）", file=sys.stderr)
    return False
