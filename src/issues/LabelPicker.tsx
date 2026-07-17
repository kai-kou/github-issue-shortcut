import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import type { RepoLabelsState } from "./useRepoLabels";

interface LabelPickerProps {
  /** push 権限のないリポジトリではラベルが silently dropped されるため、選択 UI の代わりに警告を出す（B5-3・FR-14）。 */
  pushAccess: boolean;
  selected: string[];
  onChange: (labels: string[]) => void;
  /** URL パラメータ起動（B1-2）でラベルが事前指定されている場合、選択内容が見えるよう初期状態で展開する。 */
  initiallyOpen?: boolean;
  /** 取得は IssueForm（useRepoLabels）が担う。タイトル欄のスマート入力（B3-3）と
   * 同じ取得結果を共有するため、開閉に関わらず親から取得済みの状態を受け取る。 */
  labelsState: RepoLabelsState;
}

/** ラベル複数選択 UI（B3-2）。既定は畳んでおく（起票フローを遅くしない・D-3）。
 * URL パラメータでラベルが事前指定されている場合（`initiallyOpen`）は例外的に展開済みで表示する。 */
export function LabelPicker({ pushAccess, selected, onChange, initiallyOpen = false, labelsState: state }: LabelPickerProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(initiallyOpen);

  // URL パラメータ起動（B1-2）の labels は実在確認前の生の文字列のため、取得完了後に
  // 実際にこのリポジトリへ存在するラベル名だけへ絞り込む（存在しない名前を誤って
  // GitHub への Issue 作成リクエストへ持ち込ませない）。
  useEffect(() => {
    if (state.status !== "ready") return;
    const valid = new Set(state.labels.map((l) => l.name));
    const filtered = selected.filter((name) => valid.has(name));
    if (filtered.length !== selected.length) onChange(filtered);
  }, [state, selected, onChange]);

  function handleToggleOpen(e: React.SyntheticEvent<HTMLDetailsElement>) {
    setOpen(e.currentTarget.open);
  }

  function toggleLabel(name: string) {
    onChange(selected.includes(name) ? selected.filter((l) => l !== name) : [...selected, name]);
  }

  return (
    <details className="label-picker" open={open} onToggle={handleToggleOpen}>
      <summary>{t.labelPicker.summary}</summary>
      {pushAccess ? (
        <>
          {state.status === "loading" ? <p className="picker-note">{t.labelPicker.loading}</p> : null}
          {state.status === "error" ? <p className="picker-note">{t.labelPicker.loadError}</p> : null}
          {state.status === "ready" && state.labels.length === 0 ? (
            <p className="picker-note">{t.labelPicker.empty}</p>
          ) : null}
          {state.status === "ready" && state.labels.length > 0 ? (
            <ul>
              {state.labels.map((label) => (
                <li key={label.name}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(label.name)}
                      onChange={() => toggleLabel(label.name)}
                    />
                    {label.name}
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="picker-note">{t.labelPicker.noPushAccessWarning}</p>
      )}
    </details>
  );
}
