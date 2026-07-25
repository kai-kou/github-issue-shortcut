import { useEffect, useState, type MouseEvent } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { buildLaunchUrl } from "./launchUrl";
import { loadShortcutsCache, saveShortcutsCache, type Shortcut } from "./shortcutsCache";

type ShortcutsState = { status: "loading" } | { status: "error" } | { status: "ready"; shortcuts: Shortcut[] };

/** ローカルキャッシュ（#101・SWR）が現在ユーザーのものであれば起動直後から ready で表示し、
 * fetch 完了を待たせない（別ユーザーのキャッシュは userId 不一致で無視され loading 初期化になる）。 */
function initialShortcutsState(userId: number): ShortcutsState {
  const cached = loadShortcutsCache(userId);
  return cached ? { status: "ready", shortcuts: cached } : { status: "loading" };
}

interface ShortcutListProps {
  /** ログイン中ユーザーの GitHub ユーザー ID。SWR キャッシュの所有者照合に使う（#101・別アカウント混入防止）。 */
  userId: number;
  /** タップされたプリセットをページ遷移せずにアプリ内で開く（#135）。処理した場合は true を返す。
   * false（未指定・リポジトリなしプリセット）のときは `<a href>` の通常遷移にフォールバックする。 */
  onLaunch?: (preset: Shortcut) => boolean;
}

/**
 * ホーム画面のリポジトリ選択エリアの上に表示する、保存済みショートカットのクイック一覧（#98）。
 * タップすると `/new?repo=&labels=&title=` へ**アプリ内遷移**して prefill 済み起票フォームを開く
 * （`<a href>` による通常のアプリ内ナビゲーション。外部ブラウザで開く導線ではないため、
 * ホーム画面に追加した WebAPK からタップしても同じアプリ内で完結する）。
 * ログイン済み（`AuthPanel` が `installed === true` のときのみ描画）が前提のため、
 * 未ログイン時のガードはこのコンポーネントでは行わない。
 */
export function ShortcutList({ userId, onLaunch }: ShortcutListProps) {
  const { t } = useLanguage();
  const [state, setState] = useState<ShortcutsState>(() => initialShortcutsState(userId));

  useEffect(() => {
    let active = true;
    fetch("/api/shortcuts", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
        return (await res.json()) as { shortcuts: Shortcut[] };
      })
      .then((data) => {
        if (!active) return;
        saveShortcutsCache(userId, data.shortcuts);
        setState({ status: "ready", shortcuts: data.shortcuts });
      })
      .catch(() => {
        // キャッシュ由来で既に ready なら、fetch 失敗（オフライン等）で表示を壊さず維持する
        // （SWR: revalidate 失敗時は stale データを見せ続ける・#101）。
        if (active) setState((prev) => (prev.status === "ready" ? prev : { status: "error" }));
      });
    return () => {
      active = false;
    };
  }, [userId]);

  /** 主ボタン・修飾キーなしのタップだけをアプリ内起動へ振り替える（#135）。
   * 「新しいタブで開く」「リンクをコピー」等のブラウザ標準動作と長押しメニューは `<a href>` のまま残す。 */
  function handleLaunchClick(e: MouseEvent<HTMLAnchorElement>, shortcut: Shortcut) {
    if (!onLaunch) return;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (onLaunch(shortcut)) e.preventDefault();
  }

  if (state.status === "loading") return null;
  if (state.status === "error") return <p className="status-note">{t.shortcuts.homeListLoadError}</p>;
  if (state.shortcuts.length === 0) return null;

  return (
    <div className="card">
      <p>
        <strong>{t.shortcuts.homeListTitle}</strong>
      </p>
      <ul className="shortcut-quicklist">
        {state.shortcuts.map((shortcut) => {
          const label = shortcut.name || shortcut.title || shortcut.repo;
          const meta = [shortcut.repo, shortcut.labels.join(",")].filter(Boolean).join(" · ");
          return (
            <li key={shortcut.id}>
              <a
                className="shortcut-quicklist-item"
                href={buildLaunchUrl(shortcut, "")}
                onClick={(e) => handleLaunchClick(e, shortcut)}
              >
                <span className="shortcut-quicklist-label">{label}</span>
                {meta ? <span className="shortcut-quicklist-meta">{meta}</span> : null}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
