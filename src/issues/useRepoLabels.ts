import { useEffect, useState } from "react";

export type GitHubLabel = { name: string; color: string };
export type RepoLabelsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; labels: GitHubLabel[] };

async function fetchLabels(repoFullName: string): Promise<GitHubLabel[]> {
  const res = await fetch(`/api/labels?repo=${encodeURIComponent(repoFullName)}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
  const data = (await res.json()) as { labels: GitHubLabel[] };
  return data.labels;
}

/** リポジトリのラベル一覧を取得する。LabelPicker（チェックボックス表示）と IssueForm の
 * タイトル欄スマート入力（B3-3・`@label` トークン照合）が同じ取得結果を共有する。
 * `enabled=false`（push 権限なし等）の間は取得しない（FR-14: 権限がなければラベルは反映されない）。 */
export function useRepoLabels(repoFullName: string, enabled: boolean): RepoLabelsState {
  const [state, setState] = useState<RepoLabelsState>({ status: "idle" });

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle" });
      return;
    }
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
  }, [repoFullName, enabled]);

  return state;
}
