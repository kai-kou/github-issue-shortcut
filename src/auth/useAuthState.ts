import { useEffect, useState } from "react";
import { clearReposCache } from "../repos/reposCache";
import { clearShortcutsCache } from "../shortcuts/shortcutsCache";
import { clearAllCachedLabels } from "../issues/repoLabelsCache";

export type Me = { login: string; avatarUrl: string | null; githubUserId: number };

export type AuthState =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "authenticated"; me: Me }
  | { status: "error" };

/** ログイン済みユーザーが GitHub App を 1 件以上インストール済みか（A2-1・FR-4）。未確定は null。 */
export type InstallState = boolean | null;

/** ローカルに残る他ユーザー由来の SWR キャッシュ（リポジトリ/ショートカット/ラベル）を一括消去する（#101/#102）。 */
export function clearAllUserCaches() {
  clearReposCache();
  clearShortcutsCache();
  clearAllCachedLabels();
}

export interface AuthStateResult {
  auth: AuthState;
  /** 認証済みのときのみ意味を持つ。未取得/取得失敗は null（未インストール誘導を誤表示しない）。 */
  installed: InstallState;
  /** ログアウトして "/" へ遷移する。他ユーザーのキャッシュ混入を防ぐためキャッシュも消去する（#101）。 */
  logout: () => Promise<void>;
}

/**
 * ログイン状態（/api/me）と GitHub App のインストール状態（/api/installations）を取得する共有フック。
 * サイドパネル（アカウント表示・ログアウト）とメイン画面（起票フローの出し分け）の双方から参照する。
 */
export function useAuthState(): AuthStateResult {
  const [auth, setAuth] = useState<AuthState>({ status: "checking" });
  const [installed, setInstalled] = useState<InstallState>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/me", { credentials: "same-origin" })
      .then(async (res): Promise<AuthState> => {
        if (res.status === 401) return { status: "anonymous" };
        if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
        const me = (await res.json()) as Me;
        return { status: "authenticated", me };
      })
      .then((next) => {
        // セッション切れ・未ログイン検知時は、別ユーザーの一覧が SWR キャッシュに残らないようクリアする
        // （#101/#102・明示ログアウトを経ない Cookie 失効経路の防御網。共有端末で次のユーザーに前ユーザーの
        // 一覧が見えないようにする）。このクリアは `active`（mount 状態）でガードしない: /api/me 解決前に
        // アンマウントされても、プライバシーガードとしてキャッシュ消去は必ず実行する（active は setAuth のみに掛ける）。
        if (next.status === "anonymous") clearAllUserCaches();
        if (active) setAuth(next);
      })
      .catch(() => {
        if (active) setAuth({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (auth.status !== "authenticated") return;
    let active = true;
    fetch("/api/installations", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
        return (await res.json()) as { installed: boolean };
      })
      .then((data) => {
        if (active) setInstalled(data.installed);
      })
      .catch(() => {
        // 取得失敗時は誘導を出さない（false negative より安全側: 誤って未インストール表示にしない）。
      });
    return () => {
      active = false;
    };
  }, [auth.status]);

  async function logout() {
    // 別ユーザーのリポジトリ/ショートカット一覧が次回起動時の SWR キャッシュに残らないようにする（#101）。
    clearReposCache();
    clearShortcutsCache();
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
    clearAllCachedLabels();
    window.location.assign("/");
  }

  return { auth, installed, logout };
}
