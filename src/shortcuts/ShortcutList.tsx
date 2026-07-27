import { useMemo, type MouseEvent } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { buildLaunchUrl } from "./launchUrl";
import { listShortcuts, type Shortcut } from "./shortcutsStore";

interface ShortcutListProps {
  /** ログイン中ユーザーの GitHub ユーザー ID。ローカル保存の所有者照合に使う（#101・別アカウント混入防止）。 */
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
  // 正本が端末内（localStorage）になったため同期的に読める。ネットワーク待ち・取得失敗の
  // 状態がなくなり、オフラインでも常に一覧が出る（P1・stateless-architecture.md §3）。
  const shortcuts = useMemo(() => listShortcuts(userId), [userId]);

  /** 主ボタン・修飾キーなしのタップだけをアプリ内起動へ振り替える（#135）。
   * 「新しいタブで開く」「リンクをコピー」等のブラウザ標準動作と長押しメニューは `<a href>` のまま残す。 */
  function handleLaunchClick(e: MouseEvent<HTMLAnchorElement>, shortcut: Shortcut) {
    if (!onLaunch) return;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (onLaunch(shortcut)) e.preventDefault();
  }

  if (shortcuts.length === 0) return null;

  return (
    <div className="card">
      <p>
        <strong>{t.shortcuts.homeListTitle}</strong>
      </p>
      <ul className="shortcut-quicklist">
        {shortcuts.map((shortcut) => {
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
