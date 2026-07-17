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

  // open（初期展開・手動トグルどちらも含む）になったタイミングで一度だけ取得する。
  // state.status は意図的に依存配列から外している: 含めると、この effect 自身が呼ぶ
  // setState({status:"loading"}) で effect が再実行され、直前の実行の cleanup が
  // active を false にして取得中の fetch の結果を握りつぶし、"読み込み中" のまま
  // 固まってしまう（React effect の自己再トリガーによる競合）。
  useEffect(() => {
    if (!open || !pushAccess || state.status !== "idle") return;
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
  }, [open, pushAccess, repoFullName]);

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
