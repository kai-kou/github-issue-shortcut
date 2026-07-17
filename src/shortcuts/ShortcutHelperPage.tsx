import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { parseCommaList, savePendingRedirect } from "../issues/prefillParams";
import { buildLaunchUrl, type ShortcutPreset } from "./launchUrl";

type Repo = { id: number; fullName: string };
type Shortcut = ShortcutPreset & { id: string };

type AuthState = "checking" | "anonymous" | "authenticated" | "error";
type ReposState = { status: "loading" } | { status: "error" } | { status: "ready"; repos: Repo[] };
type ShortcutsState = { status: "loading" } | { status: "error" } | { status: "ready"; shortcuts: Shortcut[] };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
  return (await res.json()) as T;
}

interface ShortcutFormProps {
  editing: Shortcut | null;
  onSaved: (shortcut: Shortcut) => void;
  onCancel: () => void;
  repos: Repo[];
}

function ShortcutForm({ editing, onSaved, onCancel, repos }: ShortcutFormProps) {
  const { t } = useLanguage();
  const [repo, setRepo] = useState(editing?.repo ?? "");
  const [labelsText, setLabelsText] = useState(editing?.labels.join(",") ?? "");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"validation" | "save" | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const labels = parseCommaList(labelsText);
    const trimmedTitle = title.trim();
    if (!repo && labels.length === 0 && !trimmedTitle) {
      setError("validation");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const url = editing ? `/api/shortcuts/${editing.id}` : "/api/shortcuts";
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, labels, title: trimmedTitle }),
      });
      if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
      onSaved((await res.json()) as Shortcut);
    } catch {
      setError("save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="shortcut-form" onSubmit={handleSubmit}>
      <p>
        <strong>{t.shortcuts.formTitle}</strong>
      </p>
      <label>
        <span className="field-label">{t.shortcuts.repoLabel}</span>
        <select value={repo} onChange={(e) => setRepo(e.target.value)}>
          <option value="">{t.shortcuts.repoNoneOption}</option>
          {repos.map((r) => (
            <option key={r.id} value={r.fullName}>
              {r.fullName}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="field-label">{t.shortcuts.labelsLabel}</span>
        <input
          type="text"
          value={labelsText}
          onChange={(e) => setLabelsText(e.target.value)}
          placeholder={t.shortcuts.labelsPlaceholder}
        />
      </label>
      <label>
        <span className="field-label">{t.shortcuts.titleLabel}</span>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.shortcuts.titlePlaceholder} />
      </label>
      {error === "validation" ? <p className="submit-result error">{t.shortcuts.validationError}</p> : null}
      {error === "save" ? <p className="submit-result error">{t.shortcuts.saveError}</p> : null}
      <div className="shortcut-actions">
        <button type="submit" disabled={saving}>
          {saving ? t.shortcuts.saving : t.shortcuts.saveButton}
        </button>
        {editing ? (
          <button type="button" onClick={onCancel} disabled={saving}>
            {t.shortcuts.cancelButton}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function ShortcutRow({
  shortcut,
  onEdit,
  onDeleted,
}: {
  shortcut: Shortcut;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const url = useMemo(() => buildLaunchUrl(shortcut, window.location.origin), [shortcut]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // クリップボード API 不可（権限拒否等）でも、下の読み取り専用フィールドから手動コピーできる。
    }
  }

  async function handleDelete() {
    try {
      const res = await fetch(`/api/shortcuts/${shortcut.id}`, { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
      onDeleted();
    } catch {
      setDeleteError(true);
    }
  }

  const summary = [shortcut.repo, shortcut.labels.join(","), shortcut.title].filter(Boolean).join(" · ");

  return (
    <li className="shortcut-row">
      <p className="shortcut-summary">{summary}</p>
      <input
        type="text"
        readOnly
        value={url}
        aria-label={t.shortcuts.urlFieldLabel}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="shortcut-actions">
        <button type="button" onClick={copyUrl}>
          {copied ? t.shortcuts.copied : t.shortcuts.copyButton}
        </button>
        <a href={url}>{t.shortcuts.openButton}</a>
        <button type="button" onClick={onEdit}>
          {t.shortcuts.editButton}
        </button>
        {confirming ? (
          <>
            <span className="status-note">{t.shortcuts.deleteConfirm}</span>
            <button type="button" className="btn-link-danger" onClick={handleDelete}>
              {t.shortcuts.deleteButton}
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              {t.shortcuts.cancelButton}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn-link-danger"
            onClick={() => {
              setDeleteError(false);
              setConfirming(true);
            }}
          >
            {t.shortcuts.deleteButton}
          </button>
        )}
      </div>
      {deleteError ? <p className="submit-result error">{t.shortcuts.deleteError}</p> : null}
    </li>
  );
}

function ShortcutHelper() {
  const { t } = useLanguage();
  const [reposState, setReposState] = useState<ReposState>({ status: "loading" });
  const [shortcutsState, setShortcutsState] = useState<ShortcutsState>({ status: "loading" });
  const [editingId, setEditingId] = useState<string | null>(null);
  // 保存成功のたびに ShortcutForm の key を変えて再マウントし、入力内容をクリアする
  // （key が editingId のみだと「新規作成」直後は null→null のままで再マウントされず、
  // 送信済みの内容がフォームに残ってしまう＝連打で同一内容が重複作成されるおそれがある）。
  const [formVersion, setFormVersion] = useState(0);

  useEffect(() => {
    let active = true;
    fetchJson<{ repos: Repo[] }>("/api/repos")
      .then((data) => active && setReposState({ status: "ready", repos: data.repos }))
      .catch(() => active && setReposState({ status: "error" }));
    fetchJson<{ shortcuts: Shortcut[] }>("/api/shortcuts")
      .then((data) => active && setShortcutsState({ status: "ready", shortcuts: data.shortcuts }))
      .catch(() => active && setShortcutsState({ status: "error" }));
    return () => {
      active = false;
    };
  }, []);

  // 編集中の対象が一覧から消えた場合（＝その shortcut 自体を削除した場合）は編集状態を
  // リセットしてフォームを再マウントする。放置すると ShortcutForm の key
  // （editingId ベース）が変わらず古い入力値が残ったまま、editing prop だけ null になり、
  // 次の保存が「更新のつもり」で意図しない新規作成（POST）になってしまう。
  useEffect(() => {
    if (!editingId || shortcutsState.status !== "ready") return;
    if (!shortcutsState.shortcuts.some((s) => s.id === editingId)) {
      setEditingId(null);
      setFormVersion((v) => v + 1);
    }
  }, [editingId, shortcutsState]);

  function upsertShortcut(shortcut: Shortcut) {
    setShortcutsState((state) => {
      if (state.status !== "ready") return state;
      const exists = state.shortcuts.some((s) => s.id === shortcut.id);
      const shortcuts = exists
        ? state.shortcuts.map((s) => (s.id === shortcut.id ? shortcut : s))
        : [...state.shortcuts, shortcut];
      return { status: "ready", shortcuts };
    });
    setEditingId(null);
    setFormVersion((v) => v + 1);
  }

  function removeShortcut(id: string) {
    setShortcutsState((state) => (state.status === "ready" ? { status: "ready", shortcuts: state.shortcuts.filter((s) => s.id !== id) } : state));
  }

  if (reposState.status === "loading" || shortcutsState.status === "loading") {
    return <p className="status-note">{t.repoPicker.loading}</p>;
  }
  if (reposState.status === "error" || shortcutsState.status === "error") {
    return <p className="status-note">{t.shortcuts.loadError}</p>;
  }

  const editing = editingId ? shortcutsState.shortcuts.find((s) => s.id === editingId) ?? null : null;

  return (
    <>
      <div className="card">
        <ShortcutForm
          key={`${editingId ?? "new"}-${formVersion}`}
          editing={editing}
          repos={reposState.repos}
          onSaved={upsertShortcut}
          onCancel={() => setEditingId(null)}
        />
      </div>
      <div className="card">
        <p>
          <strong>{t.shortcuts.listTitle}</strong>
        </p>
        {shortcutsState.shortcuts.length === 0 ? (
          <p className="status-note">{t.shortcuts.empty}</p>
        ) : (
          <ul className="shortcut-list">
            {shortcutsState.shortcuts.map((s) => (
              <ShortcutRow key={s.id} shortcut={s} onEdit={() => setEditingId(s.id)} onDeleted={() => removeShortcut(s.id)} />
            ))}
          </ul>
        )}
      </div>
      <div className="card">
        <p>
          <strong>{t.shortcuts.placementGuideTitle}</strong>
        </p>
        <p>{t.shortcuts.placementGuideBody}</p>
      </div>
    </>
  );
}

/** ショートカット作成ヘルパー画面（C1-1/C2-2・FR-16）。プリセット URL の生成 CRUD + ホーム画面配置ガイド。
 * ログインが前提のため、未ログイン時はログイン導線のみ表示する。 */
export function ShortcutHelperPage() {
  const { t } = useLanguage();
  const [auth, setAuth] = useState<AuthState>("checking");

  useEffect(() => {
    let active = true;
    fetch("/api/me", { credentials: "same-origin" })
      .then((res) => {
        if (res.status === 401) return "anonymous" as const;
        if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
        return "authenticated" as const;
      })
      .then((next) => active && setAuth(next))
      .catch(() => active && setAuth("error"));
    return () => {
      active = false;
    };
  }, []);

  return (
    <article>
      <h1>{t.shortcuts.pageTitle}</h1>
      <p>{t.shortcuts.intro}</p>
      {auth === "checking" ? <p className="status-note">{t.auth.checking}</p> : null}
      {auth === "error" ? <p className="status-note">{t.auth.loginError}</p> : null}
      {auth === "anonymous" ? (
        <p className="hero-cta">
          <a className="btn-primary" href="/auth/login" onClick={() => savePendingRedirect("/shortcuts")}>
            {t.auth.loginButton}
          </a>
        </p>
      ) : null}
      {auth === "authenticated" ? <ShortcutHelper /> : null}
      <p>
        <a href="/">{t.shortcuts.backHome}</a>
      </p>
    </article>
  );
}
