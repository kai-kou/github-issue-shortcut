import { useEffect, useState } from "react";
import { clearReposCache } from "../repos/reposCache";
import { clearShortcutsCache } from "../shortcuts/shortcutsCache";
import { clearAllCachedLabels } from "../issues/repoLabelsCache";
import { clearAuthCache, loadAuthCache, saveAuthCache } from "./authCache";

export type Me = { login: string; avatarUrl: string | null; githubUserId: number };

export type AuthState =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "authenticated"; me: Me }
  | { status: "error" };

/** ログイン済みユーザーが GitHub App を 1 件以上インストール済みか（A2-1・FR-4）。未確定は null。 */
export type InstallState = boolean | null;

/** ローカルに残る他ユーザー由来の SWR キャッシュ（認証状態/リポジトリ/ショートカット/ラベル）を一括消去する（#101/#102/#119）。 */
export function clearAllUserCaches() {
  clearAuthCache();
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
  // 起動直後の空白（タイトル + API ステータスだけの 1〜2 秒）を解消するため、直近の認証状態を
  // ローカルキャッシュから即時復元する（stale-while-revalidate・#119）。キャッシュがあれば
  // authenticated として先に描画し、ShortcutList / RepoPicker（いずれも userId キーの SWR キャッシュを持つ）を
  // ネットワーク待ちなしでマウントさせる。/api/me・/api/installations の実結果は下のエフェクトで revalidate する。
  // マウント時に 1 度だけ localStorage を読む（lazy init で以降のレンダーでは再読しない）。
  const [cachedAuth] = useState(() => loadAuthCache());
  const [auth, setAuth] = useState<AuthState>(
    cachedAuth ? { status: "authenticated", me: cachedAuth.me } : { status: "checking" },
  );
  const [installed, setInstalled] = useState<InstallState>(cachedAuth ? cachedAuth.installed : null);

  useEffect(() => {
    let active = true;
    // revalidate 開始時点のキャッシュ済みユーザー（別ユーザー切り替え検知に使う）。
    const cachedUserId = cachedAuth?.me.githubUserId ?? null;
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
        // キャッシュから楽観的に別ユーザーを表示していた場合は、確定ユーザーが判明した時点で
        // 前ユーザー由来の SWR キャッシュ（リポジトリ/ショートカット/ラベル）実体を消去する（#119・#101 の不変条件維持）。
        // userId キーにより下流の一覧は元々混入しないが、ディスク上のキャッシュも残さない。
        // なお /api/me・/api/installations は常に現在の Cookie ユーザーの実結果を返すため、`installed` は
        // マウント時のインストール状態エフェクトが正しい値へ確定させる（ここでは触らない）。
        if (next.status === "authenticated" && cachedUserId !== null && next.me.githubUserId !== cachedUserId) {
          clearAllUserCaches();
        }
        if (active) setAuth(next);
      })
      .catch(() => {
        if (active) setAuth({ status: "error" });
      });
    return () => {
      active = false;
    };
    // cachedAuth は lazy init（useState）で安定な値のため、実質マウント時 1 回だけ revalidate する。
  }, [cachedAuth]);

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

  // 認証状態（me）とインストール状態の双方が確定した時点で、次回起動の即時表示用にキャッシュへ保存する（#119）。
  useEffect(() => {
    if (auth.status === "authenticated" && installed !== null) {
      saveAuthCache(auth.me, installed);
    }
  }, [auth, installed]);

  async function logout() {
    // 別ユーザーの認証状態・リポジトリ/ショートカット一覧が次回起動時の SWR キャッシュに残らないようにする（#101/#119）。
    clearAuthCache();
    clearReposCache();
    clearShortcutsCache();
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
    clearAllCachedLabels();
    window.location.assign("/");
  }

  return { auth, installed, logout };
}
