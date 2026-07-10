#!/usr/bin/env python3
"""
Slack 通知ユーティリティ（汎用ベース）

環境変数:
  SLACK_BOT_TOKEN            - Slack Bot User OAuth Token (xoxb-...)
  SLACK_CHANNEL_ID           - メイン通知チャンネルID (C...) — セッション開始/終了・PR・パイプライン完了など
  SLACK_APPROVAL_CHANNEL_ID  - 承認依頼専用チャンネルID (C...) — approval/waiting 通知の送信先
                               未設定時は SLACK_CHANNEL_ID にフォールバック
  SLACK_PUBLISH_CHANNEL_ID   - 公開・マーケティング専用チャンネルID (C...) — publish 通知の送信先
                               未設定時は SLACK_APPROVAL_CHANNEL_ID → SLACK_CHANNEL_ID にフォールバック
  SLACK_MENTION_USER_ID      - approval / waiting / publish 通知でメンションするユーザーID (U...)

通知タイプとチャンネルの対応:
  SLACK_CHANNEL_ID           → session-start / session-stop / pr / pipeline / message / progress
  SLACK_APPROVAL_CHANNEL_ID  → approval / waiting（ユーザーメンション付き・要アクション）
  SLACK_PUBLISH_CHANNEL_ID   → publish（動画公開・SNS配信・マーケティングレビュー、@mention付き）

publish の --event-type 一覧:
  unlisted        - 動画 限定公開アップロード完了
  scheduled       - 動画 公開スケジュール設定完了
  pre-publish     - 動画 公開前日リマインダー
  public          - 動画 公開完了
  shorts-public   - Shorts 限定公開アップロード完了
  sns-complete    - SNS・BLOG 配信完了
  marketing-review - 週次マーケティングレポート 生成完了

使い方:
  python3 tools/slack_notify.py session-start --branch main
  python3 tools/slack_notify.py session-start --branch main --issue-title "[V007] Phase 3: 台本生成" --issue-url https://github.com/...
  python3 tools/slack_notify.py session-stop --branch main --summary "台本生成完了"
  python3 tools/slack_notify.py pr --pr-url https://... --pr-title "title" --branch feat/xxx
  python3 tools/slack_notify.py waiting --issues "Deep Research実行依頼" --branch main
  python3 tools/slack_notify.py pipeline --pipeline "音声" --video-id V006 --result "完了（15分32秒）"
  python3 tools/slack_notify.py message --text "任意のテキスト"
  python3 tools/slack_notify.py approval --summary "台本v1生成完了" --branch content/V007-xxx --issue-url https://github.com/...
  python3 tools/slack_notify.py publish --event-type public --video-id V007 --title "動画タイトル" --url https://youtu.be/xxx
  python3 tools/slack_notify.py daily-progress --summary "進捗サマリー" --action-items "要対応項目"
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

SLACK_API_BASE = "https://slack.com/api"

# publish の FYI イベント（ユーザー操作不要の完了報告）→ @mention しない。
# unlisted / pre-publish / public / shorts-public は確認・節目アクションのため @mention を維持する。
_PUBLISH_FYI_EVENTS = {"sns-complete", "scheduled", "marketing-review"}


def _get_mention_text() -> str:
    """SLACK_MENTION_USER_ID からメンションテキストを生成する"""
    mention_user_id = os.environ.get("SLACK_MENTION_USER_ID", "")
    return f"<@{mention_user_id}> " if mention_user_id else ""


def _api_call(method: str, payload: dict) -> dict:
    token = os.environ.get("SLACK_BOT_TOKEN", "")
    if not token:
        print("Error: SLACK_BOT_TOKEN not set", file=sys.stderr)
        return {"ok": False, "error": "token_missing"}

    url = f"{SLACK_API_BASE}/{method}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    import time
    last_err = None
    for attempt in range(3):  # 一時障害向けに最大3回・指数バックオフ（2s, 4s）
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read())
        except urllib.error.URLError as e:
            last_err = e
            # 4xx クライアントエラーはリトライしても回復しないため即座に中断する
            if isinstance(e, urllib.error.HTTPError) and 400 <= e.code < 500:
                break
            if attempt < 2:
                time.sleep(2 ** (attempt + 1))
    print(f"Error: Slack API call failed after retries: {last_err}", file=sys.stderr)
    return {"ok": False, "error": str(last_err)}


def post_message(channel: str, text: str, blocks: list = None) -> dict:
    payload = {"channel": channel, "text": text}
    if blocks:
        payload["blocks"] = blocks
    return _api_call("chat.postMessage", payload)


# --- ヘルパー ---

def _now() -> str:
    return datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M") + " JST"


def _branch_to_label(branch: str) -> str:
    """ブランチ名から人間が読みやすいラベルを生成する"""
    label = re.sub(r"^(claude|content|feat|fix|docs)/", "", branch)
    # 末尾のセッションIDらしき英数字列（5文字以上）を除去
    label = re.sub(r"-[A-Za-z0-9]{5,}$", "", label)
    label = label.replace("-", " ").strip()
    return label or branch


def _build_context_links(
    issue_title: str, issue_url: str, pr_title: str, pr_url: str
) -> list:
    """Issue / PR リンクブロックを生成（どちらか一方でも存在すれば返す）"""
    blocks = []
    if not (issue_title or issue_url or pr_title or pr_url):
        return blocks

    fields = []
    if issue_title:
        label = issue_title if len(issue_title) <= 60 else issue_title[:57] + "…"
        value = f"<{issue_url}|{label}>" if issue_url else label
        fields.append({"type": "mrkdwn", "text": f"*関連Issue:*\n{value}"})
    if pr_title:
        label = pr_title if len(pr_title) <= 60 else pr_title[:57] + "…"
        value = f"<{pr_url}|{label}>" if pr_url else label
        fields.append({"type": "mrkdwn", "text": f"*関連PR:*\n{value}"})

    if fields:
        blocks.append({"type": "section", "fields": fields})

    buttons = []
    if issue_url:
        buttons.append({
            "type": "button",
            "text": {"type": "plain_text", "text": "Issue を開く 🔗", "emoji": True},
            "url": issue_url,
        })
    if pr_url:
        buttons.append({
            "type": "button",
            "text": {"type": "plain_text", "text": "PR を開く 🔗", "emoji": True},
            "url": pr_url,
            "style": "primary",
        })
    if buttons:
        blocks.append({"type": "actions", "elements": buttons})

    return blocks


# --- Block Kit builders ---

def build_session_start_blocks(
    branch: str,
    issue_title: str = "",
    issue_url: str = "",
    pr_title: str = "",
    pr_url: str = "",
) -> list:
    task_label = issue_title or _branch_to_label(branch)

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "🐹 Claude Code セッション開始", "emoji": True},
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*タスク:* {task_label}"},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*ブランチ:*\n`{branch}`"},
                {"type": "mrkdwn", "text": f"*開始時刻:*\n{_now()}"},
            ],
        },
    ]

    blocks.extend(_build_context_links(issue_title, issue_url, pr_title, pr_url))

    blocks.append({
        "type": "context",
        "elements": [
            {"type": "mrkdwn", "text": "このスレッドに返信するとClaude Codeが読み取ります 💬"},
        ],
    })
    return blocks


def build_session_stop_blocks(
    branch: str,
    summary: str,
    issue_title: str = "",
    issue_url: str = "",
    pr_title: str = "",
    pr_url: str = "",
    cost_summary: str = "",
) -> list:
    task_label = issue_title or _branch_to_label(branch)

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "✅ Claude Code セッション終了", "emoji": True},
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*タスク:* {task_label}"},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*ブランチ:*\n`{branch}`"},
                {"type": "mrkdwn", "text": f"*終了時刻:*\n{_now()}"},
            ],
        },
    ]

    blocks.extend(_build_context_links(issue_title, issue_url, pr_title, pr_url))

    if summary:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*作業サマリー（直近のコミット）:*\n{summary}"},
        })

    # 日次コストサマリー（#1213）
    if cost_summary:
        blocks.append({
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": cost_summary}],
        })

    blocks.append({"type": "divider"})
    return blocks


# 完了報告アウトカムのプロセス的文言（completion-report-rules.md / L-052・L-076・L-102）。
# これらが [完了] 通知の --outcome に含まれていると「何をしたか（プロセス）」報告になり、
# 「初回指示で何ができるようになったか（結果）」が欠落する。
_PROCESS_OUTCOME_PATTERNS = re.compile(
    r"マージ(し|済|完了)|merged?|squash|rebase|PR\s*#?\d|指摘\s*\d|レビュー往復|"
    r"修正サイクル|を更新した|を修正した|を追加した|を変更した|コミット\s*\d",
    re.IGNORECASE,
)


def check_completion_outcome(pr_title: str, outcome: str) -> str:
    """[完了] 通知のアウトカムを検査し、問題があれば警告文字列を返す（問題なければ ""）。

    ガードレール（completion-report-rules.md の機械実装）:
      - [完了] なのに --outcome が空 → 初回指示アウトカム欠落
      - --outcome がプロセス的文言（マージ手順・レビュー往復・指摘件数等）を含む → 結果でなく過程の報告
    非致命（通知自体は送る）。stderr に出して Claude / 実行ログに気付かせる。
    """
    if not pr_title.startswith("[完了]"):
        return ""
    stripped = (outcome or "").strip()
    if not stripped:
        return (
            "⚠️ [完了] 通知に --outcome がありません。completion-report-rules.md に従い、"
            "「初回指示で何ができるようになったか」を1文で指定してください。"
        )
    if _PROCESS_OUTCOME_PATTERNS.search(stripped):
        return (
            "⚠️ --outcome がプロセス的文言（マージ手順・レビュー往復・指摘件数等）を含みます。"
            "completion-report-rules.md（L-052/L-076/L-102）に従い、"
            "「何をしたか」ではなく「初回指示で何ができるようになったか（結果）」を書いてください。"
        )
    return ""


def build_pr_blocks(pr_url: str, pr_title: str, branch: str, outcome: str = "") -> list:
    is_complete = pr_title.startswith("[完了]")
    header_text = "✅ マージ完了" if is_complete else "📋 PR作成 — レビュー & Approveをお願いします"
    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": header_text,
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*{pr_title}*"},
        },
    ]
    if outcome:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*アウトカム:* {outcome}"},
        })
    blocks.extend([
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*ブランチ:*\n`{branch}`"},
                {"type": "mrkdwn", "text": f"*PR URL:*\n{pr_url}"},
            ],
        },
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "PRを開く 🔗", "emoji": True},
                    "url": pr_url,
                    "style": "primary",
                }
            ],
        },
    ])
    return blocks


def _load_triage():
    """tools/triage_notification.py を import する（同ディレクトリ・依存なし）"""
    try:
        from triage_notification import triage_items, classify_item  # type: ignore
    except ImportError:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from triage_notification import triage_items, classify_item  # type: ignore
    return triage_items, classify_item


def build_waiting_user_blocks(issues: list, branch: str, triage: dict = None) -> list:
    """ユーザー対応待ち通知ブロック。triage 指定時は A 区分（A-1〜A-6）の境界も併記する。"""
    if triage and triage.get("a_items"):
        lines = []
        for r in triage["a_items"]:
            bd = f"（{r['boundary']}）" if r.get("boundary") else ""
            lines.append(f"• {r['text']} {bd}")
        issues_text = "\n".join(lines)
    else:
        issues_text = "\n".join(f"• {t}" for t in issues) if issues else "確認が必要なタスクがあります"
    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "⏳ ユーザーのアクションが必要です",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": issues_text},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*ブランチ:*\n`{branch}`"},
                {"type": "mrkdwn", "text": f"*時刻:*\n{_now()}"},
            ],
        },
        {
            "type": "context",
            "elements": [{
                "type": "mrkdwn",
                "text": "ℹ️ この通知は A-1〜A-6（ユーザーの最終判断・操作が物理的に必要な項目）に絞り込まれています。"
                        "各項目には「あなたが取るべき具体的アクション」が含まれているはずです。"
                        "技術的な障害・バグは Claude が自律修正するため、ここには表示されません。",
            }],
        },
    ]
    return blocks


def build_approval_request_blocks(
    summary: str,
    branch: str,
    issue_url: str = "",
    issue_title: str = "",
) -> list:
    """PR作成前のユーザー承認依頼通知"""
    mention_user_id = os.environ.get("SLACK_MENTION_USER_ID", "")
    mention_text = f"<@{mention_user_id}> " if mention_user_id else ""

    summary_lines = summary.splitlines() if summary else ["実装が完了しました"]
    summary_text = "\n".join(f"• {line.strip()}" for line in summary_lines if line.strip())
    if not summary_text:
        summary_text = "• 実装が完了しました"

    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "🔔 実装完了 — PR作成前の承認をお願いします",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"{mention_text}実装が完了しました。内容を確認してPR作成の承認をお願いします。",
            },
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*実装内容:*\n{summary_text}"},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*ブランチ:*\n`{branch}`"},
                {"type": "mrkdwn", "text": f"*時刻:*\n{_now()}"},
            ],
        },
    ]

    if issue_url:
        label = issue_title if issue_title else "関連Issue"
        label = label if len(label) <= 60 else label[:57] + "…"
        blocks.append({
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": f"{label} を開く 🔗", "emoji": True},
                    "url": issue_url,
                }
            ],
        })

    blocks.append({
        "type": "section",
        "text": {
            "type": "mrkdwn",
            "text": "✅ *承認方法*: このスレッドに `OK` / `LGTM` / `承認` などのキーワードで返信してください（Claude Codeが自動検出します）",
        },
    })
    return blocks


def build_progress_report_blocks(summary: str, adjustments: str = "", mention_text: str = "") -> list:
    """動画制作進捗レポート通知（@kaikouメンション付き）"""
    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "📊 動画制作進捗レポート",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"{mention_text}本日の動画制作進捗をお知らせしますにゃ。",
            },
        },
    ]

    if summary:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*📹 各動画の進捗:*\n{summary}"},
        })

    if adjustments:
        blocks.append({"type": "divider"})
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*🔧 Issue調整内容:*\n{adjustments}"},
        })

    blocks.append({
        "type": "context",
        "elements": [{"type": "mrkdwn", "text": f"実行時刻: {_now()}"}],
    })

    return blocks


def build_pipeline_blocks(
    pipeline: str, video_id: str, result: str, success: bool, duration: str = ""
) -> list:
    emoji = "✅" if success else "❌"
    fields = [{"type": "mrkdwn", "text": f"*動画ID:*\n`{video_id}`"}]
    if duration:
        fields.append({"type": "mrkdwn", "text": f"*所要時間:*\n{duration}"})
    fields.append({"type": "mrkdwn", "text": f"*時刻:*\n{_now()}"})
    return [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"{emoji} {pipeline}パイプライン",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": result},
        },
        {
            "type": "section",
            "fields": fields,
        },
    ]


def build_publish_blocks(
    event_type: str,
    video_id: str = "",
    title: str = "",
    url: str = "",
    detail: str = "",
) -> list:
    """動画公開・SNS配信・マーケティングレビュー通知。

    FYI イベント（sns-complete / scheduled / marketing-review）はユーザー操作不要の
    完了報告のため @mention しない（通知トリアージ・user-notification-triage.md）。
    unlisted / pre-publish / public / shorts-public は「YouTube Studio で確認」等の
    ユーザー操作・節目（A-2 相当）のため @mention を維持する。
    """
    mention_user_id = os.environ.get("SLACK_MENTION_USER_ID", "")
    # FYI イベントは @mention を抑制（完了報告のため ping しない）
    mention_text = "" if event_type in _PUBLISH_FYI_EVENTS \
        else (f"<@{mention_user_id}> " if mention_user_id else "")

    now_str = _now()

    event_configs = {
        "unlisted": {
            "emoji": "📤",
            "header": "動画 限定公開アップロード完了",
            "message": f"{mention_text}動画を限定公開でアップロードしました。YouTube Studio で内容を確認してください。",
            "action_label": "YouTube Studio で確認",
            "action_url": "https://studio.youtube.com/",
        },
        "scheduled": {
            "emoji": "📅",
            "header": "動画 公開スケジュール設定完了",
            "message": f"{mention_text}動画の公開スケジュールを設定しました。",
            "action_label": None,
            "action_url": None,
        },
        "pre-publish": {
            "emoji": "⏰",
            "header": "動画 公開前日リマインダー",
            "message": f"{mention_text}明日公開予定の動画があります。メタデータ・サムネイルを最終確認してください。",
            "action_label": "YouTube Studio で確認",
            "action_url": "https://studio.youtube.com/",
        },
        "public": {
            "emoji": "🎉",
            "header": "動画 公開完了！",
            "message": f"{mention_text}動画が公開されました！",
            "action_label": "YouTube で視聴",
            "action_url": url or None,
        },
        "shorts-public": {
            "emoji": "🎬",
            "header": "Shorts 限定公開アップロード完了",
            "message": f"{mention_text}Shorts 動画を限定公開でアップロードしました。YouTube Studio で内容を確認してください。",
            "action_label": "YouTube Studio で確認",
            "action_url": "https://studio.youtube.com/",
        },
        "sns-complete": {
            "emoji": "📣",
            "header": "SNS・BLOG 配信完了",
            "message": f"{mention_text}SNS・BLOG への配信が完了しました。",
            "action_label": None,
            "action_url": None,
        },
        "marketing-review": {
            "emoji": "📊",
            "header": "週次マーケティングレポート 生成完了",
            "message": f"{mention_text}週次マーケティングレポートを生成しました。GitHub Issues でレビューしてください。",
            "action_label": None,
            "action_url": None,
        },
    }

    cfg = event_configs.get(
        event_type,
        {
            "emoji": "🔔",
            "header": f"公開通知: {event_type}",
            "message": f"{mention_text}公開通知: {event_type}",
            "action_label": None,
            "action_url": url or None,
        },
    )

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"{cfg['emoji']} {cfg['header']}", "emoji": True},
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": cfg["message"]},
        },
    ]

    fields = []
    if video_id:
        fields.append({"type": "mrkdwn", "text": f"*動画ID:* `{video_id}`"})
    if title:
        fields.append({"type": "mrkdwn", "text": f"*タイトル:* {title}"})
    if url and event_type != "public":
        fields.append({"type": "mrkdwn", "text": f"*URL:* {url}"})
    fields.append({"type": "mrkdwn", "text": f"*実行時刻:* {now_str}"})
    if fields:
        blocks.append({"type": "section", "fields": fields})

    if detail:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"_{detail}_"},
        })

    action_url = cfg.get("action_url")
    action_label = cfg.get("action_label")
    if action_url and action_label:
        blocks.append({
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": action_label, "emoji": True},
                    "url": action_url,
                    "style": "primary",
                }
            ],
        })

    return blocks


def build_daily_progress_blocks(summary: str, action_items: str = "", analytics: str = "", youtube_status: str = "", no_mention: bool = False) -> list:
    """日次進捗報告通知（SLACK_PUBLISH_CHANNEL_ID に送信）

    Args:
        summary: 制作中の動画一覧テキスト
        action_items: 要対応項目テキスト（A-1〜A-6 該当の真の要対応のみ）
        analytics: YouTube/SNS KPI サマリーテキスト（省略可）
        youtube_status: meta.yaml 由来の YouTube 公開状況テキスト（省略可）
        no_mention: True の場合 @mention を付けない（真の要対応がゼロのとき・情報提供のみ）
    """
    mention_user_id = os.environ.get("SLACK_MENTION_USER_ID", "")
    if no_mention:
        lead = "本日の動画制作進捗をお知らせしますにゃ。（要対応はありません・情報提供のみ）"
    else:
        mention_text = f"<@{mention_user_id}> " if mention_user_id else ""
        lead = f"{mention_text}本日の動画制作進捗です。下記に *要対応* があります。"

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "📊 日次進捗レポート", "emoji": True},
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": lead},
        },
    ]

    if analytics:
        analytics_text = analytics[:2900] + "..." if len(analytics) > 2900 else analytics
        blocks.append({"type": "divider"})
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*📈 チャンネル KPI:*\n{analytics_text}"},
        })

    # YouTube 公開状況（meta.yaml より取得・--sync-published 後の正確な状態）
    if youtube_status:
        yt_text = youtube_status[:2900] + "..." if len(youtube_status) > 2900 else youtube_status
        blocks.append({"type": "divider"})
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*📺 YouTube公開状況:*\n{yt_text}"},
        })

    if summary:
        # Slack のブロックサイズ制限対策: 長すぎる場合は切り詰め
        summary_text = summary[:2900] + "..." if len(summary) > 2900 else summary
        blocks.append({"type": "divider"})
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*📹 制作パイプライン進捗:*\n{summary_text}"},
        })

    if action_items:
        action_text = action_items[:2900] + "..." if len(action_items) > 2900 else action_items
        blocks.append({"type": "divider"})
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*⚠️ 要対応:*\n{action_text}"},
        })

    blocks.append({
        "type": "context",
        "elements": [{"type": "mrkdwn", "text": f"実行時刻: {_now()}"}],
    })

    return blocks


def build_half_day_summary_blocks(summary: str, action_items: str = "", period_label: str = "", no_mention: bool = False) -> list:
    """半日アウトカムサマリー通知（SLACK_PUBLISH_CHANNEL_ID に送信）

    ユーザーが「半日〜1日に1回」で自律稼働とPR消化を把握するための集約通知。
    セッション単位の session-start/session-stop 通知を廃止した代替（Issue #2597）。
    要対応がゼロでも必ず1通送る（生存確認＝ハートビート）。

    Args:
        summary: 直近約12時間のアウトカム本文（PR消化・パイプライン進捗・SNS・コスト等・呼び出し側で組み立て済み）
        action_items: 要対応項目テキスト（A-1〜A-6 該当の真の要対応のみ）
        period_label: 集計期間ラベル（例: "前日19:00〜本日07:00"）
        no_mention: True の場合 @mention を付けない（真の要対応がゼロのとき・情報提供のみ）
    """
    mention_user_id = os.environ.get("SLACK_MENTION_USER_ID", "")
    if no_mention or not action_items:
        lead = "半日ぶんの活動サマリーです。（要対応はありません・自律稼働中）"
    else:
        mention_text = f"<@{mention_user_id}> " if mention_user_id else ""
        lead = f"{mention_text}半日ぶんの活動サマリーです。下記に *要対応* があります。"

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "🐾 半日アウトカムサマリー", "emoji": True},
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": lead},
        },
    ]

    if summary:
        summary_text = summary[:2900] + "..." if len(summary) > 2900 else summary
        blocks.append({"type": "divider"})
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": summary_text},
        })

    if action_items:
        action_text = action_items[:2900] + "..." if len(action_items) > 2900 else action_items
        blocks.append({"type": "divider"})
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*⚠️ 要対応:*\n{action_text}"},
        })

    ctx = f"期間: {period_label} | 実行時刻: {_now()}" if period_label else f"実行時刻: {_now()}"
    blocks.append({
        "type": "context",
        "elements": [{"type": "mrkdwn", "text": ctx}],
    })

    return blocks


# --- CLI ---

def main():
    parser = argparse.ArgumentParser(description="Slack通知ユーティリティ")
    parser.add_argument(
        "type",
        choices=["session-start", "session-stop", "pr", "waiting", "pipeline", "message", "approval", "progress", "publish", "daily-progress", "half-day-summary", "comment-approval", "chart"],
    )
    parser.add_argument("--channel", default="")
    parser.add_argument("--branch", default="")
    parser.add_argument("--summary", default="")
    # PR 情報（pr タイプおよび session-start/stop の関連PR表示に共用）
    parser.add_argument("--pr-url", default="")
    parser.add_argument("--pr-title", default="")
    parser.add_argument("--outcome", default="", help="pr タイプ用: ユーザー視点のアウトカム1文（何ができるようになったか）")
    # Issue 情報（session-start/stop 用）
    parser.add_argument("--issue-url", default="")
    parser.add_argument("--issue-title", default="")
    # コスト情報（session-stop タイプ用: calc_daily_cost.py のサマリー文字列）
    parser.add_argument("--cost-summary", default="", help="session-stop タイプ用: 日次コストサマリー文字列（calc_daily_cost.py --summary-only の出力）")
    # その他
    parser.add_argument("--issues", nargs="*", default=[])
    parser.add_argument(
        "--force-mention",
        action="store_true",
        help="waiting タイプ用: トリアージで A 区分なしでも強制的に @mention する（既定はトリアージでA区分のみ通知）",
    )
    parser.add_argument("--pipeline", default="")
    parser.add_argument("--video-id", default="")
    parser.add_argument("--result", default="")
    parser.add_argument("--duration", default="")
    parser.add_argument("--text", default="")
    parser.add_argument("--adjustments", default="")  # progress タイプ用: Issue調整内容
    parser.add_argument(
        "--event-type",
        dest="event_type",
        choices=["unlisted", "scheduled", "pre-publish", "public", "shorts-public", "sns-complete", "marketing-review"],
        help="publish タイプ用: 公開イベント種別",
    )
    parser.add_argument("--title", default="")   # publish タイプ用: 動画タイトル
    parser.add_argument("--url", default="")     # publish タイプ用: 公開URL
    parser.add_argument("--detail", default="")  # publish タイプ用: 補足情報
    parser.add_argument("--action-items", default="")        # daily-progress タイプ用: 要対応項目
    parser.add_argument("--analytics", default="")           # daily-progress タイプ用: YouTube/SNS KPI サマリー
    parser.add_argument("--youtube-status", default="")      # daily-progress タイプ用: YouTube公開状況（meta.yaml由来）
    parser.add_argument("--no-mention", action="store_true", help="daily-progress タイプ用: 真の要対応がゼロのとき @mention を付けない")
    parser.add_argument("--period-label", default="", help="half-day-summary タイプ用: 集計期間ラベル（例: 前日19:00〜本日07:00）")
    # comment-approval タイプ用
    parser.add_argument("--platform-name", default="")  # comment-approval: プラットフォーム名
    parser.add_argument("--priority", default="low", help="comment-approval: 優先度 (critical/high/medium/low)")
    parser.add_argument("--category-name", default="", help="comment-approval: カテゴリ名（表示用）")
    parser.add_argument("--comment-text", default="")  # comment-approval: 元コメントテキスト
    parser.add_argument("--reply-text", default="")  # comment-approval: 返信案テキスト
    parser.add_argument("--issue-number", default="")  # comment-approval: Issue 番号
    parser.add_argument("--batch-summary", default="")  # comment-approval: バッチ承認サマリー
    # chart タイプ用: 公開アクセス可能な画像 URL（R2 公開ドメイン等）を image block で表示する。
    # Slack の files:write スコープが無くても chat:write だけで画像を表示できる経路。
    parser.add_argument("--image-url", default="", help="chart タイプ用: 公開画像 URL（R2 公開ドメイン等）")
    parser.add_argument("--alt-text", default="グラフ", help="chart タイプ用: 画像 alt テキスト")
    args = parser.parse_args()

    # publish タイプでは --event-type を必須とする
    if args.type == "publish" and not args.event_type:
        parser.error("--event-type is required when type is 'publish'")

    # --channel 未指定の場合、通知タイプに応じてチャンネルを自動選択
    # approval / waiting は SLACK_APPROVAL_CHANNEL_ID を優先（未設定時は SLACK_CHANNEL_ID にフォールバック）
    # publish は SLACK_PUBLISH_CHANNEL_ID を優先（未設定時は SLACK_APPROVAL_CHANNEL_ID → SLACK_CHANNEL_ID にフォールバック）
    if not args.channel:
        main_channel_id = os.environ.get("SLACK_CHANNEL_ID", "")
        approval_channel_id = os.environ.get("SLACK_APPROVAL_CHANNEL_ID", main_channel_id)
        if args.type in ("approval", "waiting", "comment-approval"):
            args.channel = approval_channel_id
        elif args.type in ("publish", "daily-progress", "half-day-summary"):
            args.channel = os.environ.get("SLACK_PUBLISH_CHANNEL_ID", approval_channel_id)
        else:
            args.channel = main_channel_id

    if not args.channel:
        print("エラー: 送信先チャンネルを特定できませんでした。環境変数 SLACK_CHANNEL_ID (および approval/waiting 通知の場合は SLACK_APPROVAL_CHANNEL_ID) が設定されているか、--channel オプションで指定されているか確認してください。", file=sys.stderr)
        sys.exit(1)

    blocks = None
    text = ""

    if args.type == "session-start":
        blocks = build_session_start_blocks(
            args.branch,
            issue_title=args.issue_title,
            issue_url=args.issue_url,
            pr_title=args.pr_title,
            pr_url=args.pr_url,
        )
        task = args.issue_title or _branch_to_label(args.branch)
        text = f"🐹 Claude Code セッション開始 — {task}"

    elif args.type == "session-stop":
        blocks = build_session_stop_blocks(
            args.branch,
            args.summary,
            issue_title=args.issue_title,
            issue_url=args.issue_url,
            pr_title=args.pr_title,
            pr_url=args.pr_url,
            cost_summary=args.cost_summary,
        )
        task = args.issue_title or _branch_to_label(args.branch)
        text = f"✅ Claude Code セッション終了 — {task}"

    elif args.type == "pr":
        _outcome_warning = check_completion_outcome(args.pr_title, args.outcome)
        if _outcome_warning:
            print(_outcome_warning, file=sys.stderr)
        blocks = build_pr_blocks(args.pr_url, args.pr_title, args.branch, args.outcome)
        is_complete = args.pr_title.startswith("[完了]")
        text = f"✅ マージ完了: {args.pr_title}" if is_complete else f"📋 PR作成: {args.pr_title}"

    elif args.type == "waiting":
        # トリアージゲート: A-1〜A-6（既約境界外）に該当する項目だけを @mention する。
        # 障害（バグ・エラー）起因や B/C/D 区分は自律処理対象のため @mention しない（CP-6・L-077）。
        triage_items, _ = _load_triage()
        triage = triage_items([{"text": t, "labels": []} for t in args.issues])

        if not triage["mention"] and not args.force_mention:
            # A 区分なし → @mention を抑制。情報はメインチャンネルへ FYI 降格（記録は残すが ping しない）。
            main_ch = os.environ.get("SLACK_CHANNEL_ID", "")
            non_a = triage["non_a_items"]
            summary = "\n".join(
                f"• {r['text']}  → *{r['action_class']}区分*（自律処理）" for r in non_a
            ) or "（項目なし）"
            if main_ch and non_a:
                fyi_blocks = [
                    {"type": "header", "text": {"type": "plain_text", "text": "🤖 自律処理項目（ユーザー対応は不要）", "emoji": True}},
                    {"type": "section", "text": {"type": "mrkdwn", "text": summary}},
                    {"type": "context", "elements": [{
                        "type": "mrkdwn",
                        "text": "トリアージ: A-1〜A-6 に非該当のため @mention を抑制。Claude が自律処理します（要対応ではありません）。",
                    }]},
                ]
                post_message(main_ch, "🤖 自律処理項目（ユーザー対応不要）", fyi_blocks)
            print(
                "INFO: A区分（A-1〜A-6）該当なし。@mention を抑制し、自律処理対象としてメインチャンネルへ FYI 降格しました。"
                "（強制 @mention するには --force-mention）",
                file=sys.stderr,
            )
            sys.exit(0)

        blocks = build_waiting_user_blocks(args.issues, args.branch, triage=triage)
        mention_user_id = os.environ.get("SLACK_MENTION_USER_ID", "")
        mention = f"<@{mention_user_id}> " if mention_user_id else ""
        text = f"{mention}⏳ ユーザーのアクションが必要です"

    elif args.type == "pipeline":
        pipeline_success = (
            "完了" in args.result or "成功" in args.result or "OK" in args.result
        )
        blocks = build_pipeline_blocks(
            args.pipeline, args.video_id, args.result, pipeline_success, args.duration
        )
        text = f"{args.pipeline}パイプライン: {args.result}"

    elif args.type == "message":
        text = args.text

    elif args.type == "approval":
        blocks = build_approval_request_blocks(
            args.summary,
            args.branch,
            issue_url=args.issue_url,
            issue_title=args.issue_title,
        )
        mention_user_id = os.environ.get("SLACK_MENTION_USER_ID", "")
        mention = f"<@{mention_user_id}> " if mention_user_id else ""
        text = f"{mention}🔔 実装完了 — PR作成前の承認をお願いします（ブランチ: {args.branch}）"

    elif args.type == "progress":
        mention_user_id = os.environ.get("SLACK_MENTION_USER_ID", "")
        mention = f"<@{mention_user_id}> " if mention_user_id else ""
        blocks = build_progress_report_blocks(args.summary, args.adjustments, mention_text=mention)
        text = f"{mention}📊 動画制作進捗レポート"

    elif args.type == "publish":
        blocks = build_publish_blocks(
            args.event_type,
            video_id=args.video_id,
            title=args.title,
            url=args.url,
            detail=args.detail,
        )
        mention_user_id = os.environ.get("SLACK_MENTION_USER_ID", "")
        # FYI イベント（完了報告）は通知本文の先頭でも @mention しない
        mention = "" if args.event_type in _PUBLISH_FYI_EVENTS \
            else (f"<@{mention_user_id}> " if mention_user_id else "")
        event_labels = {
            "unlisted": "動画 限定公開アップロード完了",
            "scheduled": "動画 公開スケジュール設定完了",
            "pre-publish": "動画 公開前日リマインダー",
            "public": "動画 公開完了",
            "shorts-public": "Shorts 限定公開アップロード完了",
            "sns-complete": "SNS・BLOG 配信完了",
            "marketing-review": "週次マーケティングレポート 生成完了",
        }
        label = event_labels.get(args.event_type, f"公開通知: {args.event_type}")
        id_suffix = f" ({args.video_id})" if args.video_id else ""
        text = f"{mention}🔔 {label}{id_suffix}"

    elif args.type == "comment-approval":
        mention_user_id = os.environ.get("SLACK_MENTION_USER_ID", "")
        platform_name = args.platform_name or "unknown"
        # 大文字小文字の表記揺れ（HIGH / Critical 等）で @mention 判定や emoji が漏れないよう正規化
        priority = args.priority.lower()
        category_name = args.category_name or priority
        # トリアージ（user-notification-triage.md §4）: 炎上・ブランド毀損リスク
        # （critical/high = fact_error / criticism 等）の個別通知のみ @mention する。
        # medium/low（request/positive/faq）・バッチダイジェストは FYI（ドラフトは Issue に残り、
        # 自動投稿はしない。ユーザーは都合のよいときに Issue で確認できる）。
        _should_mention = (not args.batch_summary) and priority in ("critical", "high")
        mention = (f"<@{mention_user_id}> " if mention_user_id else "") if _should_mention else ""
        # Slack mrkdwn サニタイズ: <, >, & をエスケープし、バッククォートを無害化
        def _sanitize_mrkdwn(text: str) -> str:
            return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("`", "'")
        comment_text = _sanitize_mrkdwn(args.comment_text[:100]) if args.comment_text else ""
        reply_text = _sanitize_mrkdwn(args.reply_text[:200]) if args.reply_text else ""
        issue_num = args.issue_number

        # バッチモード（サマリーのみ）
        if args.batch_summary:
            blocks = [
                {"type": "header", "text": {"type": "plain_text", "text": "📬 コメント返信承認依頼（バッチ）"}},
                {"type": "section", "text": {"type": "mrkdwn", "text": args.batch_summary}},
                {"type": "section", "text": {"type": "mrkdwn", "text": "→ 承認: Slack スレッドで `OK` / GitHub Issue で個別確認"}},
            ]
            text = f"{mention}📬 コメント返信承認依頼（バッチ）"
        else:
            # 個別モード
            priority_emoji = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}.get(priority, "🟡")
            issue_link = f" (<https://github.com/kai-kou/github-issue-shortcut/issues/{issue_num}|#{issue_num}>)" if issue_num else ""
            blocks = [
                {"type": "header", "text": {"type": "plain_text", "text": f"📬 コメント返信承認依頼（{platform_name}）"}},
                {"type": "section", "text": {"type": "mrkdwn", "text": f"{priority_emoji} *カテゴリ*: {category_name}{issue_link}"}},
                {"type": "section", "text": {"type": "mrkdwn", "text": f"*元コメント*:\n> {comment_text}"}},
                {"type": "section", "text": {"type": "mrkdwn", "text": f"*返信案*:\n```{reply_text}```"}},
                {"type": "section", "text": {"type": "mrkdwn", "text": "→ このスレッドで `OK` で承認 / `修正: {テキスト}` で修正投稿 / `スキップ` で却下"}},
            ]
            text = f"{mention}📬 [{platform_name}] {category_name} コメント返信承認依頼{issue_link}"

    elif args.type == "daily-progress":
        blocks = build_daily_progress_blocks(
            args.summary, args.action_items, args.analytics, args.youtube_status,
            no_mention=args.no_mention,
        )
        mention = "" if args.no_mention else _get_mention_text()
        text = f"{mention}📊 日次進捗レポート"

    elif args.type == "half-day-summary":
        blocks = build_half_day_summary_blocks(
            args.summary, args.action_items, period_label=args.period_label,
            no_mention=args.no_mention,
        )
        mention = "" if (args.no_mention or not args.action_items) else _get_mention_text()
        text = f"{mention}🐾 半日アウトカムサマリー"

    elif args.type == "chart":
        # 週次トレンドグラフ等を公開画像 URL（R2 公開ドメイン）から image block で表示する。
        # FYI 扱い（週次レポート・要対応ではない）のため @mention しない（CP-6・user-notification-triage）。
        title = args.title or "週次レポート"
        summary = args.text or ""
        blocks = [{"type": "header", "text": {"type": "plain_text", "text": title[:150], "emoji": True}}]
        if summary:
            blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": summary[:3000]}})
        if args.image_url:
            blocks.append({
                "type": "image",
                "image_url": args.image_url,
                "alt_text": (args.alt_text or "グラフ")[:1000],
            })
        else:
            # 画像 URL が無い場合（描画フォールバックでテキスト縮退したケース）はサマリーのみ投稿する。
            blocks.append({"type": "context", "elements": [{
                "type": "mrkdwn", "text": "（グラフ画像なし・テキストサマリーのみ）",
            }]})
        text = title

    result = post_message(args.channel, text, blocks)
    if result.get("ok"):
        ts = result.get("ts", "")
        print(f"OK: message sent (ts={ts})")
    else:
        print(f"Error: {result.get('error', 'unknown')}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
