import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";

type GitHubLabel = { name: string; color: string };
type LabelsState = { status: "idle" } | { status: "loading" } | { status: "error" } | { status: "ready"; labels: GitHubLabel[] };

interface LabelPickerProps {
  repoFullName: string;
  /** push 権限のないリポジトリではラベルが silently dropped されるため、選択 UI の代わりに警告を出す（B5-3・FR-14）。 */
  pushAccess: boolean;
  selected: string[];
  onChange: (labels: string[]) => void;
  /** URL パラメータ起動（B1-2）でラベルが事前指定されている場合、選択内容が見えるよう初期状態で展開する。 */
  initiallyOpen?: boolean;
}

async function fetchLabels(repoFullName: string): Promise<GitHubLabel[]> {
  const res = await fetch(`/api/labels?repo=${encodeURIComponent(repoFullName)}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
  const data = (await res.json()) as { labels: GitHubLabel[] };
  return data.labels;
}

/** ラベル複数選択 UI（B3-2）。既定は畳んでおき、開いたときだけ取得する（起票フローを遅くしない）。
 * URL パラメータでラベルが事前指定されている場合（`initiallyOpen`）は例外的に展開済みで取得する。 */
export function LabelPicker({ repoFullName, pushAccess, selected, onChange, initiallyOpen = false }: LabelPickerProps) {
  const { t } = useLanguage();
  const [state, setState] = useState<LabelsState>({ status: "idle" });
  const [open, setOpen] = useState(initiallyOpen);

  useEffect(() => {
    if (!initiallyOpen || !pushAccess) return;
    let active = true;
    setState({ status: "loading" });
    fetchLabels(repoFullName)
      .then((labels) => {
        if (active) setState({ status: "ready", labels });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
    // repoFullName/pushAccess/initiallyOpen は親が key={repoFullName} で固定する props のため mount 時のみでよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleToggleOpen(e: React.SyntheticEvent<HTMLDetailsElement>) {
    const isOpen = e.currentTarget.open;
    setOpen(isOpen);
    if (!isOpen || state.status !== "idle" || !pushAccess) return;
    setState({ status: "loading" });
    fetchLabels(repoFullName)
      .then((labels) => setState({ status: "ready", labels }))
      .catch(() => setState({ status: "error" }));
  }

  function toggleLabel(name: string) {
    onChange(selected.includes(name) ? selected.filter((l) => l !== name) : [...selected, name]);
  }

  return (
    <details open={open} onToggle={handleToggleOpen}>
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
