import { useState, type FormEvent } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { loadDraft, saveDraft, clearDraft } from "./draft";
import { LabelPicker } from "./LabelPicker";

export type IssueInput = { title: string; body: string; labels: string[] };

interface IssueFormProps {
  repoFullName: string;
  /** ユーザーがこのリポジトリへ push 権限を持つか（B3-2・B5-3・FR-14）。false ならラベル選択を警告表示に切り替える。 */
  pushAccess: boolean;
  onSubmit: (input: IssueInput) => void;
  submitting?: boolean;
  /** URL パラメータ起動（B1-2・FR-15）の初期値。下書き（B5-1）が存在する場合はそちらを優先する。 */
  initialTitle?: string | null;
  initialLabels?: string[];
  /** URL パラメータ起動 / Web Share Target（B1-2・B3-4・FR-15・FR-18）の本文初期値。 */
  initialBody?: string | null;
}

/** 対象リポジトリ向けの下書きがあれば初期値として使う（自リポジトリ以外の下書きは復元しない）。 */
function draftFor(repoFullName: string) {
  const draft = loadDraft();
  return draft && draft.repo === repoFullName ? draft : null;
}

/** タイトル必須・本文任意の起票フォーム（B3-1）。GitHub への実作成は onSubmit の呼び出し元（B4-1）が行う。
 * 送信失敗・中断時は入力内容を端末（localStorage）に下書き保存し、再訪時に復元する（B5-1）。 */
export function IssueForm({
  repoFullName,
  pushAccess,
  onSubmit,
  submitting = false,
  initialTitle,
  initialLabels,
  initialBody,
}: IssueFormProps) {
  const { t } = useLanguage();
  const [initialDraft] = useState(() => draftFor(repoFullName));
  const [title, setTitle] = useState(() => initialDraft?.title ?? initialTitle ?? "");
  const [body, setBody] = useState(() => initialDraft?.body ?? initialBody ?? "");
  const [labels, setLabels] = useState<string[]>(() => initialLabels ?? []);

  const canSubmit = title.trim().length > 0 && !submitting;

  function persist(nextTitle: string, nextBody: string) {
    if (nextTitle.trim() || nextBody.trim()) {
      saveDraft({ repo: repoFullName, title: nextTitle, body: nextBody });
    } else {
      clearDraft();
    }
  }

  function handleTitleChange(value: string) {
    setTitle(value);
    persist(value, body);
  }

  function handleBodyChange(value: string) {
    setBody(value);
    persist(title, value);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ title: title.trim(), body: body.trim(), labels });
  }

  return (
    <form className="issue-form" onSubmit={handleSubmit}>
      <p className="target-repo">
        {t.issueForm.targetRepoLabel}: <strong>{repoFullName}</strong>
      </p>
      <label>
        <span className="field-label">{t.issueForm.titleLabel}</span>
        <input
          type="text"
          enterKeyHint="send"
          autoCapitalize="sentences"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder={t.issueForm.titlePlaceholder}
        />
      </label>
      <label>
        <span className="field-label">{t.issueForm.bodyLabel}</span>
        <textarea
          enterKeyHint="enter"
          value={body}
          onChange={(e) => handleBodyChange(e.target.value)}
          placeholder={t.issueForm.bodyPlaceholder}
        />
      </label>
      <LabelPicker
        key={repoFullName}
        repoFullName={repoFullName}
        pushAccess={pushAccess}
        selected={labels}
        onChange={setLabels}
        initiallyOpen={(initialLabels?.length ?? 0) > 0}
      />
      <div className="submit-row">
        <button type="submit" disabled={!canSubmit}>
          {submitting ? t.issueForm.submitting : t.issueForm.submitButton}
        </button>
      </div>
    </form>
  );
}
