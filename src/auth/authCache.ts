import type { Me } from "./useAuthState";

const STORAGE_KEY = "issue-shortcut:auth-cache";

/** 認証ゲートの即時表示（stale-while-revalidate・#119）に必要な最小状態。
 * ログイン中ユーザー（`me`）と GitHub App インストール済みか（`installed`）を保持する。 */
export type CachedAuth = { me: Me; installed: boolean };

function isMe(value: unknown): value is Me {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.login === "string" &&
    (v.avatarUrl === null || typeof v.avatarUrl === "string") &&
    typeof v.githubUserId === "number"
  );
}

/** localStorage から読み出した生 JSON を検証して `CachedAuth` に変換する純関数（localStorage 非依存・テスト用）。
 * 未保存・破損 JSON・型不一致のいずれでも例外を投げず null に倒す（reposCache.ts と同じ堅牢性）。 */
export function parseAuthCache(raw: string | null): CachedAuth | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const v = parsed as Record<string, unknown>;
    if (!isMe(v.me) || typeof v.installed !== "boolean") return null;
    return { me: v.me, installed: v.installed };
  } catch {
    return null;
  }
}

/**
 * 起動時の即時表示（stale-while-revalidate・#119）のため、直近の認証状態（`me` + `installed`）を
 * 端末内ローカルキャッシュから読み出す。リポジトリ/ショートカット一覧（reposCache/shortcutsCache）は
 * この `me.githubUserId` を鍵に照合されるため、別ユーザーの一覧混入は下流で自動的に弾かれる（#101）。
 * revalidate（/api/me・/api/installations）で anonymous / 別ユーザーと判明したら消去する（useAuthState）。
 */
export function loadAuthCache(): CachedAuth | null {
  try {
    return parseAuthCache(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** 確定した認証状態（`me` + `installed` の双方が判明した時点）をキャッシュへ保存する（次回起動時の即時表示用）。 */
export function saveAuthCache(me: Me, installed: boolean): void {
  try {
    const payload: CachedAuth = { me, installed };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage 不可(プライベートブラウジング等)でもキャッシュを諦めるだけで機能に影響しない。
  }
}

/** ログアウト・アカウント削除・セッション失効・別ユーザー検知時に呼び出し、前ユーザーの認証状態が残らないようにする。 */
export function clearAuthCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}
