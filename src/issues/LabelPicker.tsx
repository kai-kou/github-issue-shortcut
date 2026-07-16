import { useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";

type GitHubLabel = { name: string; color: string };
type LabelsState = { status: "idle" } | { status: "loading" } | { status: "error" } | { status: "ready"; labels: GitHubLabel[] };

interface LabelPickerProps {
  repoFullName: string;
  /** push 権限のないリポジトリではラベルが silently dropped されるため、選択 UI の代わりに警告を出す（B5-3・FR-14）。 */
  pushAccess: boolean;
  selected: string[];
  onChange: (labels: string[]) => void;
}

/** ラベル複数選択 UI（B3-2）。既定は畳んでおき、開いたときだけ取得する（起票フローを遅くしない）。 */
export function LabelPicker({ repoFullName, pushAccess, selected, onChange }: LabelPickerProps) {
  const { t } = useLanguage();
  const [state, setState] = useState<LabelsState>({ status: "idle" });

  function handleToggleOpen(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open || state.status !== "idle") return;
    setState({ status: "loading" });
    fetch(`/api/labels?repo=${encodeURIComponent(repoFullName)}`, { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
        const data = (await res.json()) as { labels: GitHubLabel[] };
        setState({ status: "ready", labels: data.labels });
      })
      .catch(() => setState({ status: "error" }));
  }

  function toggleLabel(name: string) {
    onChange(selected.includes(name) ? selected.filter((l) => l !== name) : [...selected, name]);
  }

  return (
    <details onToggle={handleToggleOpen}>
      <summary>{t.labelPicker.summary}</summary>
      {pushAccess ? (
        <>
          {state.status === "loading" ? <p>{t.labelPicker.loading}</p> : null}
          {state.status === "error" ? <p>{t.labelPicker.loadError}</p> : null}
          {state.status === "ready" && state.labels.length === 0 ? <p>{t.labelPicker.empty}</p> : null}
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
        <p>{t.labelPicker.noPushAccessWarning}</p>
      )}
    </details>
  );
}
