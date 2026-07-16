import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { loadRecentRepos, recordRecentRepo } from "./recentRepos";
import { IssueForm, type IssueInput } from "../issues/IssueForm";
import { loadDraft, clearDraft } from "../issues/draft";

type Repo = { id: number; fullName: string; private: boolean };
type ReposState = { status: "loading" } | { status: "error" } | { status: "ready"; repos: Repo[] };
type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; number: number; htmlUrl: string }
  | { status: "error" };

/** 起票先リポジトリの検索/選択 UI（B2-1/B2-2）。最近使用したリポジトリを先頭に表示する。 */
export function RepoPicker() {
  const { t } = useLanguage();
  const [state, setState] = useState<ReposState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(() => loadRecentRepos());
  // 送信失敗・中断時の下書き（B5-1）があれば、そのリポジトリを再訪時に自動選択して復元する。
  const [selected, setSelected] = useState<string | null>(() => loadDraft()?.repo ?? null);
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  const [formKey, setFormKey] = useState(0);

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
    setSubmitState({ status: "idle" });
  }

  async function submitIssue(input: IssueInput) {
    if (!selected) return;
    setSubmitState({ status: "submitting" });
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: selected, title: input.title, body: input.body }),
      });
      if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
      const data = (await res.json()) as { number: number; htmlUrl: string };
      clearDraft();
      setSubmitState({ status: "success", number: data.number, htmlUrl: data.htmlUrl });
      // 送信成功のたびにフォームを再マウントして入力内容をクリアする（連続起票を想定）。
      setFormKey((k) => k + 1);
    } catch {
      setSubmitState({ status: "error" });
    }
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
      {selected ? (
        <>
          <IssueForm
            key={`${selected}-${formKey}`}
            repoFullName={selected}
            onSubmit={submitIssue}
            submitting={submitState.status === "submitting"}
          />
          {submitState.status === "success" ? (
            <p>
              {t.issueForm.successMessage} #{submitState.number}{" "}
              <a href={submitState.htmlUrl} target="_blank" rel="noreferrer">
                {t.issueForm.viewIssueLink}
              </a>
            </p>
          ) : null}
          {submitState.status === "error" ? <p>{t.issueForm.errorMessage}</p> : null}
        </>
      ) : null}
    </div>
  );
}
