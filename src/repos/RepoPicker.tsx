import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import type { Translations } from "../i18n/translations";
import { loadRecentRepos, recordRecentRepo } from "./recentRepos";
import { IssueForm, type IssueInput } from "../issues/IssueForm";
import { loadDraft, clearDraft } from "../issues/draft";
import type { PrefillParams } from "../issues/prefillParams";

type Repo = { id: number; fullName: string; private: boolean; pushAccess: boolean };
type ReposState = { status: "loading" } | { status: "error" } | { status: "ready"; repos: Repo[] };
type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; number: number; htmlUrl: string }
  | { status: "error"; code: string };

/** `/api/issues` の失敗レスポンス（`{ error: { code, message } }`・B5-2・FR-9）から表示コードを読み取る。 */
async function submitErrorCode(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { code?: string } };
    return data.error?.code ?? "upstream_failed";
  } catch {
    return "upstream_failed";
  }
}

/** エラー種別ごとに識別可能な文言へ振り分ける（B5-2）。未知のコードは汎用メッセージにフォールバックする。 */
function submitErrorMessage(code: string, t: Translations): string {
  switch (code) {
    case "reauth_required":
      return t.issueForm.errors.reauthRequired;
    case "rate_limited":
      return t.issueForm.errors.rateLimited;
    case "forbidden":
      return t.issueForm.errors.forbidden;
    case "not_found":
      return t.issueForm.errors.notFound;
    case "issues_disabled":
      return t.issueForm.errors.issuesDisabled;
    case "validation_failed":
      return t.issueForm.errors.validationFailed;
    case "duplicate_submission":
      return t.issueForm.errors.duplicateSubmission;
    default:
      return t.issueForm.errorMessage;
  }
}

interface RepoPickerProps {
  /** URL パラメータ起動（B1-2・FR-15）の初期値。下書き（B5-1）が存在する場合はそちらを優先する。 */
  prefill?: PrefillParams | null;
}

/** 起票先リポジトリの検索/選択 UI（B2-1/B2-2）。最近使用したリポジトリを先頭に表示する。 */
export function RepoPicker({ prefill = null }: RepoPickerProps) {
  const { t } = useLanguage();
  const [state, setState] = useState<ReposState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(() => loadRecentRepos());
  // 送信失敗・中断時の下書き（B5-1）があれば、そのリポジトリを再訪時に自動選択して復元する。
  // 下書きがなければ URL パラメータ起動（B1-2）の repo を初期選択に使う。
  const [selected, setSelected] = useState<string | null>(() => loadDraft()?.repo ?? prefill?.repo ?? null);
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

  const selectedPushAccess = useMemo(() => {
    if (state.status !== "ready" || !selected) return false;
    return state.repos.find((r) => r.fullName === selected)?.pushAccess ?? false;
  }, [state, selected]);

  // URL パラメータ起動（B1-2）のタイトル/ラベルは、まだ一度も送信していない・かつプレフィルが
  // 指定したリポジトリのままである場合のみ適用する。ユーザーが別リポジトリへ手動で切り替えた
  // 場合や、一度送信して連続起票に入った場合は引き継がない。
  const appliesPrefill = formKey === 0 && (!prefill?.repo || prefill.repo === selected);

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
        body: JSON.stringify({ repo: selected, title: input.title, body: input.body, labels: input.labels }),
      });
      if (!res.ok) {
        const code = await submitErrorCode(res);
        // duplicate_submission は直前の同一内容の送信が既に GitHub 側で成功済みであることを意味する
        // （サーバー側は成功記録との照合でのみこのコードを返す）。取り残された下書きが後の
        // ウィンドウ外での二重作成を招かないよう、下書きはクリアする（B5-1 と整合）。
        if (code === "duplicate_submission") clearDraft();
        setSubmitState({ status: "error", code });
        return;
      }
      const data = (await res.json()) as { number: number; htmlUrl: string };
      clearDraft();
      setSubmitState({ status: "success", number: data.number, htmlUrl: data.htmlUrl });
      // 送信成功のたびにフォームを再マウントして入力内容をクリアする（連続起票を想定）。
      // formKey>0 は「1 回送信済み」を意味し、URL パラメータ起動のプレフィルを以降の
      // 連続起票へ引き継がない判定にも流用する（同じ雛形が繰り返し復活しないように）。
      setFormKey((k) => k + 1);
    } catch {
      // fetch 自体の失敗（オフライン等）はネットワーク断とみなし汎用メッセージにフォールバックする。
      setSubmitState({ status: "error", code: "network" });
    }
  }

  if (state.status === "loading") return <p className="status-note">{t.repoPicker.loading}</p>;
  if (state.status === "error") return <p className="status-note">{t.repoPicker.loadError}</p>;

  return (
    <div className="card">
      <label className="repo-search">
        <span className="field-label">{t.repoPicker.searchLabel}</span>
        <input
          type="text"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.repoPicker.searchPlaceholder}
        />
      </label>
      {filtered.length === 0 ? (
        <p className="status-note">{t.repoPicker.empty}</p>
      ) : (
        <ul className="repo-list">
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
            pushAccess={selectedPushAccess}
            onSubmit={submitIssue}
            submitting={submitState.status === "submitting"}
            initialTitle={appliesPrefill ? prefill?.title : undefined}
            initialLabels={appliesPrefill ? prefill?.labels : undefined}
            initialBody={appliesPrefill ? prefill?.body : undefined}
          >
            {submitState.status === "success" ? (
              <p className="submit-result success">
                {t.issueForm.successMessage} #{submitState.number}{" "}
                <a href={submitState.htmlUrl} target="_blank" rel="noreferrer">
                  {t.issueForm.viewIssueLink}
                </a>
              </p>
            ) : null}
            {submitState.status === "error" ? (
              <p className="submit-result error">
                {submitErrorMessage(submitState.code, t)}
                {submitState.code === "reauth_required" ? (
                  <>
                    {" "}
                    <a href="/auth/login">{t.auth.loginButton}</a>
                  </>
                ) : null}
              </p>
            ) : null}
          </IssueForm>
        </>
      ) : null}
    </div>
  );
}
