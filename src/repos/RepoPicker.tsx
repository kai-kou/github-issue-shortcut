import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { loadRecentRepos, recordRecentRepo } from "./recentRepos";
import { IssueForm, type IssueInput } from "../issues/IssueForm";

type Repo = { id: number; fullName: string; private: boolean };
type ReposState = { status: "loading" } | { status: "error" } | { status: "ready"; repos: Repo[] };

/** 起票先リポジトリの検索/選択 UI（B2-1/B2-2）。最近使用したリポジトリを先頭に表示する。 */
export function RepoPicker() {
  const { t } = useLanguage();
  const [state, setState] = useState<ReposState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(() => loadRecentRepos());
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/repos", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
        const data = (await res.json()) as { repos: Repo[] };
        return data.repos;
      })
      .then((repos) => {
        if (active) setState({ status: "ready", repos });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (state.status !== "ready") return [];
    const q = query.trim().toLowerCase();
    const matches = q ? state.repos.filter((r) => r.fullName.toLowerCase().includes(q)) : state.repos;
    const byFullName = new Map(matches.map((r) => [r.fullName, r]));
    const recentFirst = recent
      .map((name) => byFullName.get(name))
      .filter((r): r is Repo => Boolean(r));
    const recentNames = new Set(recentFirst.map((r) => r.fullName));
    const rest = matches.filter((r) => !recentNames.has(r.fullName));
    return [...recentFirst, ...rest];
  }, [state, query, recent]);

  function selectRepo(fullName: string) {
    setSelected(fullName);
    setRecent(recordRecentRepo(fullName));
  }

  function submitIssue(_input: IssueInput) {
    // GitHub への実作成（POST /api/issues）は B4-1（#25）で実装する。
  }

  if (state.status === "loading") return <p>{t.repoPicker.loading}</p>;
  if (state.status === "error") return <p>{t.repoPicker.loadError}</p>;

  return (
    <div>
      <label>
        {t.repoPicker.searchLabel}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.repoPicker.searchPlaceholder}
        />
      </label>
      {filtered.length === 0 ? (
        <p>{t.repoPicker.empty}</p>
      ) : (
        <ul>
          {filtered.map((repo) => (
            <li key={repo.id}>
              <button type="button" onClick={() => selectRepo(repo.fullName)} aria-pressed={selected === repo.fullName}>
                {repo.fullName}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected ? <IssueForm repoFullName={selected} onSubmit={submitIssue} /> : null}
    </div>
  );
}
