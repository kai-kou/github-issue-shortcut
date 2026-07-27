import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth/apiFetch";
import { useLanguage } from "../i18n/LanguageContext";
import { savePendingRedirect } from "../issues/prefillParams";
import { LabelPicker } from "../issues/LabelPicker";
import { useRepoLabels } from "../issues/useRepoLabels";
import { hasPushAccess } from "../repos/pushAccess";
import { buildLaunchUrl } from "./launchUrl";
import {
  createShortcut,
  deleteShortcut,
  listShortcuts,
  normalizeShortcutInput,
  updateShortcut,
  SHORTCUT_NAME_MAX_LENGTH,
  type Shortcut,
} from "./shortcutsStore";

type Repo = { id: number; fullName: string; pushAccess: boolean };

type AuthState =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "authenticated"; userId: number }
  | { status: "error" };
type ReposState = { status: "loading" } | { status: "error" } | { status: "ready"; repos: Repo[] };

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
  /** 保存先を所有ユーザーに紐付けるための GitHub ユーザー ID（別アカウント混入防止・#101）。 */
  userId: number;
}

function ShortcutForm({ editing, onSaved, onCancel, repos, userId }: ShortcutFormProps) {
  const { t } = useLanguage();
  const [repo, setRepo] = useState(editing?.repo ?? "");
  const [labels, setLabels] = useState<string[]>(editing?.labels ?? []);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"validation" | "save" | null>(null);

  // 選択中リポジトリの push 権限。ラベル取得の可否と LabelPicker の警告表示に使う
  // （リポジトリ未選択なら false = 取得しない）。判定は RepoPicker と共通関数を使う（#128）。
  const selectedPushAccess = useMemo(() => hasPushAccess(repos, repo), [repo, repos]);
  // Issue フォームと同じ取得フック・SWR キャッシュ・push 権限判定を共有する（B3-2・#102）。
  const labelsState = useRepoLabels(repo, selectedPushAccess);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input = normalizeShortcutInput({ repo, labels, title, name });
    if (!input) {
      setError("validation");
      return;
    }
    setError(null);
    setSaving(true);
    // 保存先は端末内 localStorage（P1）。同期処理だが、保存失敗（プライベートブラウジング等で
    // localStorage が使えない場合）は握り潰さずエラー表示に倒す。
    const saved = editing ? updateShortcut(userId, editing.id, input) : createShortcut(userId, input);
    setSaving(false);
    if (!saved) {
      setError("save");
      return;
    }
    onSaved(saved);
  }

  return (
    <form className="shortcut-form" onSubmit={handleSubmit}>
      <p>
        <strong>{t.shortcuts.formTitle}</strong>
      </p>
      <label>
        <span className="field-label">{t.shortcuts.nameLabel}</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.shortcuts.namePlaceholder}
          maxLength={SHORTCUT_NAME_MAX_LENGTH}
        />
      </label>
      <label>
        <span className="field-label">{t.shortcuts.repoLabel}</span>
        <select
          value={repo}
          onChange={(e) => {
            const next = e.target.value;
            // リポジトリを切り替えたら、前リポジトリで選んだラベルは破棄する。別リポジトリには
            // 存在しない可能性があり、キャッシュ由来 stale 表示中は LabelPicker の絞り込みも走らない
            // ため、残すと存在しないラベル付きのショートカットが作られてしまう（起票時に silently drop）。
            // 編集開始時の初期ラベルは onChange を通らないので保持される。
            if (next !== repo) setLabels([]);
            setRepo(next);
          }}
        >
          <option value="">{t.shortcuts.repoNoneOption}</option>
          {repos.map((r) => (
            <option key={r.id} value={r.fullName}>
              {r.fullName}
            </option>
          ))}
        </select>
      </label>
      {repo ? (
        <LabelPicker
          key={repo}
          pushAccess={selectedPushAccess}
          selected={labels}
          onChange={setLabels}
          initiallyOpen={labels.length > 0}
          labelsState={labelsState}
        />
      ) : (
        <div>
          <span className="field-label">{t.shortcuts.labelsLabel}</span>
          <p className="status-note">{t.shortcuts.labelsSelectRepoFirst}</p>
        </div>
      )}
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
  userId,
}: {
  shortcut: Shortcut;
  onEdit: () => void;
  onDeleted: () => void;
  userId: number;
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

  function handleDelete() {
    if (deleteShortcut(userId, shortcut.id)) {
      onDeleted();
    } else {
      setDeleteError(true);
    }
  }

  const summary = [shortcut.repo, shortcut.labels.join(","), shortcut.title].filter(Boolean).join(" · ");

  return (
    <li className="shortcut-row">
      {shortcut.name ? <p className="shortcut-name">{shortcut.name}</p> : null}
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

function ShortcutHelper({ userId }: { userId: number }) {
  const { t } = useLanguage();
  const [reposState, setReposState] = useState<ReposState>({ status: "loading" });
  // 正本は端末内 localStorage（P1）。初期表示は同期的に読めるため loading / error 状態を持たない。
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(() => listShortcuts(userId));
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
    return () => {
      active = false;
    };
  }, []);

  // 編集中の対象が一覧から消えた場合（＝その shortcut 自体を削除した場合）は編集状態を
  // リセットしてフォームを再マウントする。放置すると ShortcutForm の key
  // （editingId ベース）が変わらず古い入力値が残ったまま、editing prop だけ null になり、
  // 次の保存が「更新のつもり」で意図しない新規作成（POST）になってしまう。
  useEffect(() => {
    if (!editingId) return;
    if (!shortcuts.some((s) => s.id === editingId)) {
      setEditingId(null);
      setFormVersion((v) => v + 1);
    }
  }, [editingId, shortcuts]);

  function upsertShortcut(shortcut: Shortcut) {
    setShortcuts((current) => {
      const exists = current.some((s) => s.id === shortcut.id);
      return exists ? current.map((s) => (s.id === shortcut.id ? shortcut : s)) : [...current, shortcut];
    });
    setEditingId(null);
    setFormVersion((v) => v + 1);
  }

  function removeShortcut(id: string) {
    setShortcuts((current) => current.filter((s) => s.id !== id));
  }

  if (reposState.status === "loading") {
    return <p className="status-note">{t.repoPicker.loading}</p>;
  }
  if (reposState.status === "error") {
    return <p className="status-note">{t.shortcuts.loadError}</p>;
  }

  const editing = editingId ? shortcuts.find((s) => s.id === editingId) ?? null : null;

  return (
    <>
      <div className="card">
        <ShortcutForm
          key={`${editingId ?? "new"}-${formVersion}`}
          editing={editing}
          repos={reposState.repos}
          userId={userId}
          onSaved={upsertShortcut}
          onCancel={() => setEditingId(null)}
        />
      </div>
      <div className="card">
        <p>
          <strong>{t.shortcuts.listTitle}</strong>
        </p>
        {shortcuts.length === 0 ? (
          <p className="status-note">{t.shortcuts.empty}</p>
        ) : (
          <ul className="shortcut-list">
            {shortcuts.map((s) => (
              <ShortcutRow
                key={s.id}
                shortcut={s}
                userId={userId}
                onEdit={() => setEditingId(s.id)}
                onDeleted={() => removeShortcut(s.id)}
              />
            ))}
          </ul>
        )}
      </div>
      <div className="card">
        <p>
          <strong>{t.shortcuts.placementGuideTitle}</strong>
        </p>
        <p>{t.shortcuts.placementGuideBody}</p>
        <p className="status-note">{t.shortcuts.placementGuideNote}</p>
      </div>
    </>
  );
}

/** ショートカット作成ヘルパー画面（C1-1/C2-2・FR-16）。プリセット URL の生成 CRUD + ホーム画面配置ガイド。
 * ログインが前提のため、未ログイン時はログイン導線のみ表示する。 */
export function ShortcutHelperPage() {
  const { t } = useLanguage();
  const [auth, setAuth] = useState<AuthState>({ status: "checking" });

  useEffect(() => {
    let active = true;
    // ショートカットの保存先（localStorage）は GitHub ユーザー ID で所有者を紐付けるため、
    // ログイン判定だけでなく githubUserId も受け取る（#101・別アカウント混入防止）。
    apiFetch("/api/me")
      .then(async (res): Promise<AuthState> => {
        if (res.status === 401) return { status: "anonymous" };
        if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
        const me = (await res.json()) as { githubUserId?: number };
        if (typeof me.githubUserId !== "number") throw new Error("githubUserId missing");
        return { status: "authenticated", userId: me.githubUserId };
      })
      .then((next) => active && setAuth(next))
      .catch(() => active && setAuth({ status: "error" }));
    return () => {
      active = false;
    };
  }, []);

  return (
    <article>
      <h1>{t.shortcuts.pageTitle}</h1>
      <p>{t.shortcuts.intro}</p>
      {auth.status === "checking" ? <p className="status-note">{t.auth.checking}</p> : null}
      {auth.status === "error" ? <p className="status-note">{t.auth.loginError}</p> : null}
      {auth.status === "anonymous" ? (
        <p className="hero-cta">
          <a className="btn-primary" href="/auth/login" onClick={() => savePendingRedirect("/shortcuts")}>
            {t.auth.loginButton}
          </a>
        </p>
      ) : null}
      {auth.status === "authenticated" ? <ShortcutHelper userId={auth.userId} /> : null}
      <p>
        <a href="/">{t.shortcuts.backHome}</a>
      </p>
    </article>
  );
}
