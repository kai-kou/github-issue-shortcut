/**
 * ショートカットプリセットの永続化層（端末内 localStorage が **正本**）。
 *
 * 以前はサーバー（D1 `shortcuts` テーブル）が正本で、本モジュールはその SWR キャッシュだった（#101）。
 * サーバーに個人データを保持しない方針（`docs/design/stateless-architecture.md` P1）に伴い、
 * 正本を端末側へ移した。**保存キー・保存形式は当時のキャッシュと同一に保つ**ことで、
 * 既存利用者のプリセットを移行処理なしにそのまま引き継ぐ。
 *
 * どのユーザーの一覧かを `userId`（GitHub ユーザー ID）で紐付け、別アカウントへ切り替えた際に
 * 前ユーザーのショートカット名・リポジトリ名が表示されるのを防ぐ（#101・NFR-17）。
 */
import type { ShortcutPreset } from "./launchUrl";

const STORAGE_KEY = "issue-shortcut:shortcuts-cache";

export type Shortcut = ShortcutPreset & { id: string };

export interface ShortcutInput {
  repo: string;
  labels: string[];
  title: string;
  name: string;
}

/** 表示名の上限（#98）。Android app shortcut の short_name は長いと truncate されるための実務値。 */
export const SHORTCUT_NAME_MAX_LENGTH = 12;
/** GitHub 側の実制約に合わせた上限（label 名は 50 文字まで）。際限のない保存サイズを避ける。 */
export const SHORTCUT_REPO_MAX_LENGTH = 140;
export const SHORTCUT_TITLE_MAX_LENGTH = 500;
export const SHORTCUT_LABEL_MAX_LENGTH = 50;
export const SHORTCUT_LABELS_MAX_COUNT = 20;

type StoredPayload = { userId: number; shortcuts: Shortcut[] };

function isShortcut(value: unknown): value is Shortcut {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.repo === "string" &&
    typeof v.title === "string" &&
    typeof v.name === "string" &&
    Array.isArray(v.labels) &&
    v.labels.every((l) => typeof l === "string")
  );
}

function isStoredPayload(value: unknown): value is StoredPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.userId === "number" && Array.isArray(v.shortcuts);
}

/**
 * 保存済み JSON を現在ユーザーのショートカット一覧へ変換する純関数（localStorage 非依存・ユニットテスト対象）。
 * 未保存（null）・破損 JSON・別ユーザーのデータは、いずれも空配列に倒す（例外を投げない）。
 */
export function parseStoredShortcuts(raw: string | null, userId: number): Shortcut[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredPayload(parsed) || parsed.userId !== userId) return [];
    return parsed.shortcuts.filter(isShortcut);
  } catch {
    return [];
  }
}

/** 保存できたかを返す。localStorage 不可（プライベートブラウジング・容量超過）では false。
 * 正本なので、キャッシュ時代と違って**失敗を握り潰さず呼び出し側へ伝える**。 */
function writePayload(userId: number, shortcuts: Shortcut[]): boolean {
  try {
    const payload: StoredPayload = { userId, shortcuts };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/**
 * 入力値を `{ repo, labels, title, name }` へ正規化する（純関数）。
 * repo / labels / title の少なくとも 1 つが非空でなければ null（name のみでは保存不可）。
 * 長さ・件数の上限を超える場合も null。以前は Worker（`parseShortcutInput`）が担っていた検証を
 * クライアントへ移したもの。
 */
export function normalizeShortcutInput(raw: {
  repo?: string;
  labels?: string[];
  title?: string;
  name?: string;
}): ShortcutInput | null {
  const repo = (raw.repo ?? "").trim();
  const labels = (raw.labels ?? []).map((l) => l.trim()).filter((l) => l.length > 0);
  const title = (raw.title ?? "").trim();
  const name = (raw.name ?? "").trim();
  if (!repo && labels.length === 0 && !title) return null;
  if (repo.length > SHORTCUT_REPO_MAX_LENGTH) return null;
  if (title.length > SHORTCUT_TITLE_MAX_LENGTH) return null;
  if (labels.length > SHORTCUT_LABELS_MAX_COUNT) return null;
  if (labels.some((l) => l.length > SHORTCUT_LABEL_MAX_LENGTH)) return null;
  if (name.length > SHORTCUT_NAME_MAX_LENGTH) return null;
  return { repo, labels, title, name };
}

/** 現在ユーザーのショートカット一覧を作成順で返す。未保存・別ユーザー・破損時は空配列。 */
export function listShortcuts(userId: number): Shortcut[] {
  try {
    return parseStoredShortcuts(localStorage.getItem(STORAGE_KEY), userId);
  } catch {
    // localStorage 自体が使えない環境（プライベートブラウジング等）でも一覧表示は壊さない。
    return [];
  }
}

/** 新規作成して保存する。保存に失敗した場合は null（呼び出し側でエラー表示）。 */
export function createShortcut(userId: number, input: ShortcutInput): Shortcut | null {
  const shortcut: Shortcut = { id: crypto.randomUUID(), ...input };
  const next = [...listShortcuts(userId), shortcut];
  return writePayload(userId, next) ? shortcut : null;
}

/** 既存プリセットを更新する。対象が無い・保存に失敗した場合は null。 */
export function updateShortcut(userId: number, id: string, input: ShortcutInput): Shortcut | null {
  const current = listShortcuts(userId);
  if (!current.some((s) => s.id === id)) return null;
  const updated: Shortcut = { id, ...input };
  const next = current.map((s) => (s.id === id ? updated : s));
  return writePayload(userId, next) ? updated : null;
}

/** 削除できたかを返す。対象が無い・保存に失敗した場合は false。 */
export function deleteShortcut(userId: number, id: string): boolean {
  const current = listShortcuts(userId);
  const next = current.filter((s) => s.id !== id);
  if (next.length === current.length) return false;
  return writePayload(userId, next);
}

/** ログアウト・アカウント削除時に呼び出し、端末に他人のプリセットが残らないようにする。 */
export function clearShortcuts(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}
