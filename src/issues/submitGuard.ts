/**
 * 同一内容の二重送信防止（FR-24）を端末内で行うガード。
 *
 * P3（stateless-architecture.md §3）でサーバー（D1 の `issue_log`）から移設した。防ぎたいのは
 * 「ほぼ同時の二重タップ」「タイムアウトしたと思って押し直した」といった **同一端末で完結する事象**
 * のため、判定材料を端末内（localStorage）に置いてもカバー範囲はほぼ変わらない
 * （複数端末をまたぐ重複は防げなくなる＝設計 §6 で受容済みのトレードオフ）。
 *
 * 旧サーバー実装と同じく **claim（予約）→ 送信 → 失敗時は release（解放）** の順で使う。
 * 送信前に予約しないと、2 つの送信が同時に「まだ送っていない」と判定してすり抜ける。
 */

const STORAGE_KEY = "issue-shortcut:recent-submissions";

/** 二重送信とみなす照合ウィンドウ（ミリ秒）。旧サーバー実装の `DUPLICATE_SUBMISSION_WINDOW`（30 秒）と同値。 */
export const DUPLICATE_SUBMISSION_WINDOW_MS = 30_000;

/** 送信済み（または送信中）の内容 1 件分の記録。内容の平文は持たず、ハッシュ値だけを持つ。 */
export type SubmissionRecord = { key: string; at: number };

export type SubmissionInput = { repo: string; title: string; body: string; labels: string[] };

/**
 * 内容の同一性キー（SHA-256 のハッシュ）。JSON 配列にしてからハッシュ化し、フィールド境界の曖昧さ
 * （例: repo="a", title="b\nc" と repo="a\nb", title="c" が同じキーになる）を避ける
 * （旧サーバー実装のハッシュ対象と同じ組み立て方）。
 *
 * 平文をそのままキーにしない理由: このキーは localStorage に残るため、平文だと最後に起票した
 * Issue のタイトル・本文が端末に残り続ける（共有端末・XSS で読まれうる）。下書きと違い、
 * 利用者にとって残す価値のないデータなので保存しない。
 */
export async function submissionKey(input: SubmissionInput): Promise<string> {
  const source = JSON.stringify([input.repo, input.title, input.body, input.labels]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 照合ウィンドウの外にある記録を落とす（判定に使われないうえ、放置すると際限なく増えるため）。
 * **未来日付（`at > now`）も落とす**: 端末の時計がずれた状態で書かれた記録は `now - at` が負になり、
 * 単純な上限判定だけでは永久に「窓内」と判定されて、その内容の送信が二度と通らなくなる。
 */
export function pruneSubmissions(records: SubmissionRecord[], now: number): SubmissionRecord[] {
  return records.filter((r) => {
    const age = now - r.at;
    return age >= 0 && age < DUPLICATE_SUBMISSION_WINDOW_MS;
  });
}

/**
 * 送信枠を予約する純関数。ウィンドウ内に同一キーの記録があれば `null`（＝重複なので送信しない）、
 * なければ予約を加えた新しい記録配列を返す。
 */
export function claimSubmissionRecord(
  records: SubmissionRecord[],
  key: string,
  now: number,
): SubmissionRecord[] | null {
  const fresh = pruneSubmissions(records, now);
  if (fresh.some((r) => r.key === key)) return null;
  return [...fresh, { key, at: now }];
}

/** 予約を解放する純関数（送信が失敗し、正当な再試行を許したいとき）。 */
export function releaseSubmissionRecord(records: SubmissionRecord[], key: string): SubmissionRecord[] {
  return records.filter((r) => r.key !== key);
}

function isSubmissionRecord(value: unknown): value is SubmissionRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.key === "string" && typeof v.at === "number";
}

function load(): SubmissionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSubmissionRecord) : [];
  } catch {
    return [];
  }
}

function persist(records: SubmissionRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // localStorage 不可（プライベートブラウジング等）でも送信自体は継続する（draft.ts と同方針）。
    // 二重送信防止は送信ボタンの無効化（UI 側）と併せた多層防御のうちの 1 層。
  }
}

/**
 * 送信直前に呼ぶ。`false` なら直近に同一内容を送信済み（＝重複）なので送信しない。
 * localStorage が使えない環境では常に `true`（送信を止めない）。
 */
export async function claimSubmission(input: SubmissionInput, now: number = Date.now()): Promise<boolean> {
  const next = claimSubmissionRecord(load(), await submissionKey(input), now);
  if (!next) return false;
  persist(next);
  return true;
}

/** 送信が失敗したときに呼ぶ（予約を残すと、正当な再試行まで 30 秒間ブロックしてしまう）。 */
export async function releaseSubmission(input: SubmissionInput): Promise<void> {
  persist(releaseSubmissionRecord(load(), await submissionKey(input)));
}

/** 送信履歴（内容のハッシュ）を消す。プライバシーポリシーが「送信履歴を削除する」と述べている
 * 対象のひとつで、ログアウト・別ユーザー検知・アカウント削除で消す（#181）。消しても失われるのは
 * 30 秒窓の重複判定材料だけで、起票内容そのものではない。 */
export function clearSubmissions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage 不可でも他の削除は続行する。
  }
}
