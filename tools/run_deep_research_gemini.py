#!/usr/bin/env python3
"""tools/run_deep_research_gemini.py

Gemini Deep Research Max API を REST 直叩きで呼び出す実装（Phase B）。

対象モデル: deep-research-max-preview-04-2026
API: Gemini Interactions API（/v1beta/interactions・background=true 非同期ポーリング）
コスト目安: 1タスク $3-5（160 検索 + 900K 入力 + 80K 出力 + キャッシュ）

設計方針（Issue #1823 Phase B / Issue #2127 修正）:
- google-genai SDK 非依存（urllib のみで動作・追加依存ゼロ）
- Interactions API（/v1beta/interactions）を使用。旧 asyncBatchGenerateContent は HTTP 404
- preview 版 API 仕様変更に対する耐性: モデル ID とエンドポイントは環境変数で上書き可能
- 30秒間隔で最大30分のポーリング
- HTTP 5xx は指数バックオフで最大3回リトライ
- 失敗時は呼び出し元（run_deep_research.py）が DIY フォールバックに切替

環境変数:
    GEMINI_API_KEY: Gemini API キー（必須・image-generator スキルで既使用）
    GEMINI_DR_MODEL: モデル ID（既定: deep-research-max-preview-04-2026）
    GEMINI_DR_ENDPOINT: API エンドポイントベース（既定: Google AI Studio Generative Language API）

使用方法（run_deep_research.py 経由）:
    python3 tools/run_deep_research.py V143 --engine gemini
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from run_deep_research import RunResult


DEFAULT_MODEL = os.environ.get("GEMINI_DR_MODEL", "deep-research-max-preview-04-2026")
DEFAULT_ENDPOINT = os.environ.get(
    "GEMINI_DR_ENDPOINT",
    "https://generativelanguage.googleapis.com/v1beta",
)
# Interactions API に必要な Api-Revision ヘッダー（2026-05-20 以降）
INTERACTIONS_API_REVISION = "2026-05-20"
POLL_INTERVAL_SECONDS = 30
MAX_DURATION_SECONDS = 1800  # 30 分でタイムアウト
HTTP_TIMEOUT_SECONDS = 60
RETRY_MAX = 3
RETRY_BACKOFF_BASE = 2.0

# 非同期ポーリングの進捗を外部（research-runner エージェント・次セッション）から
# 観測可能にするための進捗ログ（#2348・L-080 対策）。
# これにより「kick したまま完走を待たず終了」を検知・防止できる。
PROGRESS_LOG = (
    Path(__file__).resolve().parent.parent
    / "content" / "pipeline-state" / "research_progress.jsonl"
)

# 進捗ログの監視側（SKILL.md / hourly-routing-details.md）が前提とする終端状態。
# API 生値を必ずこの語彙に正規化してから記録する（#2348 Copilot 指摘・L-080 再発防止）。
#   completed         → done
#   failed/cancelled  → failed
#   （タイムアウトは呼び出し側が "timeout" を直接渡す）
#   それ以外（running/pending/queued/空）→ polling
_PROGRESS_LOG_WARNED = False


def _normalize_progress_state(api_state: str) -> str:
    """API の state 生値を監視側が解釈できる終端語彙に正規化する。"""
    s = (api_state or "").lower()
    if s == "completed":
        return "done"
    if s in ("failed", "cancelled", "error"):
        return "failed"
    if s in ("done", "timeout", "started"):
        return s
    return "polling"


def _log_progress(research_id: str, interaction_id: str, state: str, elapsed: int) -> None:
    """Gemini DR ポーリング進捗を research_progress.jsonl に追記する（#2348）。

    書き込み失敗（権限・ディスク）はリサーチ本体を止めないが、原因不明化を防ぐため
    初回だけ stderr に WARN を出す（#2348 Copilot 指摘）。
    """
    global _PROGRESS_LOG_WARNED
    try:
        PROGRESS_LOG.parent.mkdir(parents=True, exist_ok=True)
        record = {
            # 日時は JST 統一（datetime-rules.md）。ローカル TZ 依存を避けて明示する。
            "ts": _dt.datetime.now(_dt.timezone(_dt.timedelta(hours=9))).isoformat(),
            "research_id": research_id,
            "interaction_id": interaction_id,
            "state": state,
            "elapsed_sec": elapsed,
            "max_sec": MAX_DURATION_SECONDS,
        }
        with PROGRESS_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as exc:
        if not _PROGRESS_LOG_WARNED:
            _PROGRESS_LOG_WARNED = True
            sys.stderr.write(
                f"[WARN] 進捗ログ書き込み失敗（{PROGRESS_LOG}）: {exc}。"
                "リサーチは継続するが進捗の外部観測ができない\n"
            )

OFFICIAL_DOMAIN_RANK_A = (
    "anthropic.com", "openai.com", "deepmind.google", "blog.google",
    "ai.google.dev", "developers.googleblog.com", "arxiv.org",
    "github.com/anthropics", "github.com/openai", "research.google",
    "developer.nvidia.com", "blogs.nvidia.com", "huggingface.co/papers",
    "platform.claude.com", "ai.meta.com", "research.facebook.com",
    # 第一者公式ドメイン（V168 実テストで grounding ラベルに出現・Issue #2401）。
    # `google.com` 単体は `9to5google.com` 等と部分一致衝突するため追加しない。
    "claude.com", "antigravity.google", "adk.dev", "cloud.google.com",
    "developers.google.com", "developer.android.com",
)
MEDIA_DOMAIN_RANK_B = (
    "techcrunch.com", "theverge.com", "wired.com", "arstechnica.com",
    "reuters.com", "bloomberg.com", "ft.com", "wsj.com", "nytimes.com",
    "venturebeat.com", "9to5google.com", "9to5mac.com", "theregister.com",
    "thenewstack.io", "siliconangle.com", "fortune.com", "cnbc.com",
    "nikkei.com", "itmedia.co.jp", "impress.co.jp", "cnet.com",
)


def _ensure_api_key() -> str:
    """API キーの存在確認。未設定なら明示的に失敗させる（CP-1: 推測しない）。"""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY が未設定。docs/rules/env-vars.md を参照して設定してください。"
        )
    return api_key


def _http_request(
    url: str, method: str, headers: dict[str, str], body: dict | None = None
) -> dict:
    """汎用 HTTP リクエスト。指数バックオフ付きリトライ実装。"""
    data: bytes | None = None
    final_headers = dict(headers)
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        final_headers.setdefault("Content-Type", "application/json")
    last_exc: Exception | None = None
    for attempt in range(RETRY_MAX):
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=final_headers)
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SECONDS) as resp:
                payload = resp.read().decode("utf-8")
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as exc:
            # 429（レート制限）はリトライで回復しうるため即エラーにせずバックオフへ回す。
            # それ以外の 4xx はクライアントエラーで再試行しても無駄なので即 raise。
            if 400 <= exc.code < 500 and exc.code != 429:
                body_text = exc.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"Gemini API HTTP {exc.code}: {body_text}") from exc
            last_exc = exc
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
        sleep_s = RETRY_BACKOFF_BASE ** attempt
        sys.stderr.write(
            f"[WARN] HTTP リクエスト失敗 (attempt {attempt + 1}/{RETRY_MAX}): {last_exc}。"
            f"{sleep_s}s 待機してリトライ\n"
        )
        time.sleep(sleep_s)
    raise RuntimeError(f"Gemini API リクエストが {RETRY_MAX} 回連続失敗: {last_exc}")


def _make_headers(api_key: str) -> dict[str, str]:
    """Interactions API 用共通ヘッダーを返す。"""
    return {
        "x-goog-api-key": api_key,
        "Api-Revision": INTERACTIONS_API_REVISION,
    }


def _start_research_task(prompt_text: str, model: str, api_key: str) -> str:
    """Gemini Deep Research タスクを起動し、interaction id を返す。

    Interactions API（/v1beta/interactions）でバックグラウンド実行を開始する。
    旧実装の asyncBatchGenerateContent エンドポイントは HTTP 404 のため使用しない（Issue #2127）。
    """
    url = f"{DEFAULT_ENDPOINT}/interactions"
    body = {
        "agent": model,
        "input": prompt_text,
        "background": True,
        "agent_config": {
            "type": "deep-research",
            "thinking_summaries": "auto",
        },
    }
    resp = _http_request(url, method="POST", headers=_make_headers(api_key), body=body)
    interaction_id = resp.get("id")
    if not interaction_id:
        raise RuntimeError(f"Gemini API 応答に interaction id が含まれない: {resp}")
    return interaction_id


def _poll_interaction(interaction_id: str, api_key: str, research_id: str = "?") -> dict:
    """interaction をポーリングし、state=completed の応答を返す。タイムアウト時は例外。

    各ポーリングで research_progress.jsonl に状態を記録し、長時間ジョブの
    進捗を外部から観測可能にする（#2348・kick&forget 検知用）。
    """
    url = f"{DEFAULT_ENDPOINT}/interactions/{interaction_id}"
    elapsed = 0
    while elapsed < MAX_DURATION_SECONDS:
        resp = _http_request(url, method="GET", headers=_make_headers(api_key))
        # 実 API（2026-05 時点）は完了状態を `status` で返す（`state` ではない・Issue #2401）。
        # `state` を見ていた旧実装は完了を永遠に検知できず必ず 30 分タイムアウトしていた。
        # 防御的型チェック: 文字列以外が返っても .lower() で落ちないようにする（PR #2403 Gemini 指摘）。
        status_val = resp.get("status") or resp.get("state")
        state = status_val.lower() if isinstance(status_val, str) else ""
        # 監視側（SKILL.md / hourly-routing）が解釈できる語彙に正規化して記録する
        if state == "completed":
            _log_progress(research_id, interaction_id, "done", elapsed)
            return resp
        if state in ("failed", "cancelled", "canceled", "error"):
            _log_progress(research_id, interaction_id, "failed", elapsed)
            raise RuntimeError(f"Gemini DR タスク終了（{state}）: {resp.get('error', resp)}")
        _log_progress(research_id, interaction_id, _normalize_progress_state(state), elapsed)
        sys.stderr.write(
            f"[INFO] Gemini DR ポーリング中… {elapsed}s/{MAX_DURATION_SECONDS}s "
            f"(state={state or 'pending'})\n"
        )
        time.sleep(POLL_INTERVAL_SECONDS)
        elapsed += POLL_INTERVAL_SECONDS
    _log_progress(research_id, interaction_id, "timeout", elapsed)
    raise TimeoutError(f"Gemini DR Max タスクが {MAX_DURATION_SECONDS}s 内に完了せず")


def _classify_rank(url: str, label: str = "") -> str:
    """URL（とリンクラベル）からランク A/B/C を判定する。research-rules.md と整合。

    Gemini grounding の URL は `vertexaisearch.cloud.google.com/grounding-api-redirect/...`
    のリダイレクト形式で全ソースが同一ホスト。URL でドメイン照合すると `cloud.google.com`
    等と誤一致して全件 A 化する事故を招くため、リダイレクト時はリンクラベル（実ドメイン名・
    例 `antigravity.google` / `medium.com`）のみで判定する（Issue #2401）。
    """
    is_grounding_redirect = "grounding-api-redirect" in url or "vertexaisearch" in url
    hay = (label if is_grounding_redirect else f"{url} {label}").lower()
    if any(domain in hay for domain in OFFICIAL_DOMAIN_RANK_A):
        return "A"
    if any(domain in hay for domain in MEDIA_DOMAIN_RANK_B):
        return "B"
    return "C"


def _extract_markdown_from_steps(response: dict) -> str:
    """Interactions API の完了応答から Markdown 本文を抽出する（Issue #2401）。

    実 API は本文を `steps[].content[].text`（`step.type == "model_output"` かつ
    `content.type == "text"`）に格納する。トップレベル `output_text` は空。
    複数の model_output ステップを出現順に結合する。画像コンテンツ（type=="image"）は除外。
    """
    # 防御的型チェック: API レスポンスは外部入力のため、各フィールドが想定型か必ず確認する
    # （文字列/リスト以外でも AttributeError/TypeError で落ちないように・PR #2403 Gemini 指摘）。
    top_val = response.get("output_text")
    top = top_val.strip() if isinstance(top_val, str) else ""
    if top:
        return top
    parts: list[str] = []
    steps = response.get("steps")
    if isinstance(steps, list):
        for step in steps:
            if not isinstance(step, dict) or step.get("type") != "model_output":
                continue
            content = step.get("content")
            if not isinstance(content, list):
                continue
            for c in content:
                if isinstance(c, dict) and c.get("type") == "text":
                    text_val = c.get("text")
                    if isinstance(text_val, str) and text_val:
                        parts.append(text_val.strip())
    return "\n\n".join(parts).strip()


def _parse_markdown_to_sections(markdown: str) -> tuple[list[dict], list[dict]]:
    """Markdown レスポンスをセクションリスト + 出典リストに分解する。

    パース戦略:
        1. `## ` 見出しでセクション分割
        2. 各セクション本文中の `[label](url)` を出典として抽出
        3. URL からドメインベースで rank A/B/C を判定
    """
    sections: list[dict] = []
    sources: list[dict] = []
    seen_urls: dict[str, str] = {}
    url_pattern = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
    section_pattern = re.compile(r"^## +(.+?)$", re.MULTILINE)

    matches = list(section_pattern.finditer(markdown))
    if not matches:
        return [], []
    for i, m in enumerate(matches):
        heading = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(markdown)
        body = markdown[start:end].strip()
        section_source_ids: list[str] = []
        for label, url in url_pattern.findall(body):
            url = url.rstrip(".,;:)")
            if url in seen_urls:
                sid = seen_urls[url]
                if sid not in section_source_ids:  # セクション内の重複参照を排除
                    section_source_ids.append(sid)
                continue
            sid = f"s{len(sources) + 1:03d}"
            seen_urls[url] = sid
            sources.append(
                {
                    "id": sid,
                    "url": url,
                    "title": label,
                    "rank": _classify_rank(url, label),
                    "language": "ja" if re.search(r"[぀-ヿ一-鿿]", label) else "en",
                }
            )
            section_source_ids.append(sid)
        sections.append(
            {"heading": heading, "body_markdown": body, "source_ids": section_source_ids}
        )
    return sections, sources


def _parse_response_to_schema(
    response: dict, research_id: str, theme: str, duration_s: float
) -> "RunResult":
    """Interactions API の completed 応答を research_schema.json 準拠の RunResult に正規化する。

    Interactions API の完了応答は output_text フィールドに Markdown 本文を含む。
    steps 配列が存在する場合のフォールバックも実装。
    """
    from run_deep_research import RunResult

    # 実 API は本文を steps[].content[].text（model_output）に格納する（Issue #2401）
    markdown = _extract_markdown_from_steps(response)
    if not markdown:
        raise RuntimeError("Gemini DR 応答に Markdown 本文が含まれない")

    sections, sources = _parse_markdown_to_sections(markdown)
    if len(sections) < 5:
        raise RuntimeError(
            f"必須セクション数を下回る: {len(sections)} < 5。プロンプト構造を見直すか再実行が必要"
        )

    fact_flags: list[dict] = [
        {
            "claim": f"ランクC出典『{src['title']}』に依拠する記述は要裏取り（一次情報での確認が必要）",
            "rank": "C",
            "reason": "ドメインがランクA/B辞書に該当せず信頼度が確認できない",
            "source_id": src["id"],
        }
        for src in sources
        if src["rank"] == "C"
    ]

    # Interactions API の使用量フィールド（実 API は total_input/output_tokens・Issue #2401）
    # 防御的型チェック: dict 以外が返っても usage.get() で落ちないようにする（PR #2403 Gemini 指摘）。
    usage_data = response.get("usage") or response.get("usageMetadata")
    usage = usage_data if isinstance(usage_data, dict) else {}

    def _usage(*keys: str) -> int:
        # 高コスト（~30分・$4.5）なリサーチの最終パースで非数値が来てもクラッシュさせない
        # （空文字・list・obj 等で ValueError/TypeError → 0 フォールバック・PR #2403 Gemini 指摘）。
        for k in keys:
            v = usage.get(k)
            if v is not None:
                try:
                    return int(v)
                except (ValueError, TypeError):
                    continue
        return 0

    input_tokens = _usage("total_input_tokens", "promptTokenCount", "input_tokens")
    output_tokens = _usage("total_output_tokens", "candidatesTokenCount", "output_tokens")
    cost_estimate = 4.5  # 実コストは Phase C で実測トラッキング

    return RunResult(
        research_id=research_id,
        theme=theme,
        engine="gemini-deep-research-max",
        engine_version=DEFAULT_MODEL,
        sections=sections,
        official_names=[],  # Phase B-2 で本文末尾の「正式名称確認リスト」を抽出
        sources=sources,
        fact_check_flags=fact_flags,
        duration_seconds=duration_s,
        cost_usd=cost_estimate,
        search_count=160,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


def execute(research_id: str, theme: str, prompt_text: str) -> "RunResult":
    """run_deep_research.py から呼ばれる主エントリポイント。"""
    api_key = _ensure_api_key()
    model = DEFAULT_MODEL
    sys.stderr.write(f"[INFO] Gemini DR Max 起動: model={model} research_id={research_id}\n")

    start = time.perf_counter()
    interaction_id = _start_research_task(prompt_text, model, api_key)
    sys.stderr.write(f"[INFO] interaction 起動: {interaction_id}\n")
    _log_progress(research_id, interaction_id, "started", 0)
    # _poll_interaction が完了時に "done" を記録する（重複記録を避けここでは記録しない）
    response = _poll_interaction(interaction_id, api_key, research_id)
    duration_s = time.perf_counter() - start
    sys.stderr.write(f"[INFO] Gemini DR 完了: {duration_s:.1f}s\n")
    return _parse_response_to_schema(response, research_id, theme, duration_s)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Gemini Deep Research Max ランナー（単独実行）"
    )
    parser.add_argument("research_id")
    args = parser.parse_args()
    sys.path.insert(0, str(Path(__file__).parent))
    from run_deep_research import load_prompt, write_outputs, append_cost_log

    theme, prompt_text = load_prompt(args.research_id)
    try:
        result = execute(args.research_id, theme, prompt_text)
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"[ERROR] Gemini DR 実行失敗: {exc}\n")
        return 1
    json_path, md_path = write_outputs(result)
    append_cost_log(result)
    print(f"[OK] {md_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
