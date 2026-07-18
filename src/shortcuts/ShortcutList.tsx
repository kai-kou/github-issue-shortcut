import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { buildLaunchUrl, type ShortcutPreset } from "./launchUrl";

type Shortcut = ShortcutPreset & { id: string };
type ShortcutsState = { status: "loading" } | { status: "error" } | { status: "ready"; shortcuts: Shortcut[] };

/**
 * ホーム画面のリポジトリ選択エリアの上に表示する、保存済みショートカットのクイック一覧（#98）。
 * タップすると `/new?repo=&labels=&title=` へ**アプリ内遷移**して prefill 済み起票フォームを開く
 * （`<a href>` による通常のアプリ内ナビゲーション。外部ブラウザで開く導線ではないため、
 * ホーム画面に追加した WebAPK からタップしても同じアプリ内で完結する）。
 * ログイン済み（`AuthPanel` が `installed === true` のときのみ描画）が前提のため、
 * 未ログイン時のガードはこのコンポーネントでは行わない。
 */
export function ShortcutList() {
  const { t } = useLanguage();
  const [state, setState] = useState<ShortcutsState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    fetch("/api/shortcuts", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
        return (await res.json()) as { shortcuts: Shortcut[] };
      })
      .then((data) => {
        if (active) setState({ status: "ready", shortcuts: data.shortcuts });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, []);

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
              <a className="shortcut-quicklist-item" href={buildLaunchUrl(shortcut, "")}>
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
