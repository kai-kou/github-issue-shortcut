import { useState, type FormEvent } from "react";
import { useLanguage } from "../i18n/LanguageContext";

export type IssueInput = { title: string; body: string };

interface IssueFormProps {
  repoFullName: string;
  onSubmit: (input: IssueInput) => void;
  submitting?: boolean;
}

/** タイトル必須・本文任意の起票フォーム（B3-1）。GitHub への実作成は onSubmit の呼び出し元（B4-1）が行う。 */
export function IssueForm({ repoFullName, onSubmit, submitting = false }: IssueFormProps) {
  const { t } = useLanguage();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const canSubmit = title.trim().length > 0 && !submitting;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ title: title.trim(), body: body.trim() });
  }

  return (
    <form onSubmit={handleSubmit}>
      <p>
        {t.issueForm.targetRepoLabel}: <strong>{repoFullName}</strong>
      </p>
      <label>
        {t.issueForm.titleLabel}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t.issueForm.titlePlaceholder}
        />
      </label>
      <label>
        {t.issueForm.bodyLabel}
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t.issueForm.bodyPlaceholder} />
      </label>
      <button type="submit" disabled={!canSubmit}>
        {submitting ? t.issueForm.submitting : t.issueForm.submitButton}
      </button>
    </form>
  );
}
