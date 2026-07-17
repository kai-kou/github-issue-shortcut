import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { loadDraft, saveDraft, clearDraft } from "./draft";
import { LabelPicker } from "./LabelPicker";
import { useRepoLabels } from "./useRepoLabels";
import { HighlightedTextInput } from "./HighlightedTextInput";
import { committedTokens, findTokens, isTokenMatched, stripTokens, type SmartToken } from "./smartInput";

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
  /** 送信結果（成功/エラー）の表示要素。sticky な送信バーに隠れないよう送信ボタンの直上に描画する（§3.2）。 */
  children?: ReactNode;
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
  children,
}: IssueFormProps) {
  const { t } = useLanguage();
  const [initialDraft] = useState(() => draftFor(repoFullName));
  const [title, setTitle] = useState(() => initialDraft?.title ?? initialTitle ?? "");
  const [body, setBody] = useState(() => initialDraft?.body ?? initialBody ?? "");
  const [labels, setLabels] = useState<string[]>(() => initialLabels ?? []);

  // タイトル欄のスマート入力（B3-3・FR-20）: `@label` トークンをインライン認識する。
  // ラベル一覧は LabelPicker のチェックボックスとここでのトークン照合が同じ取得結果を共有する。
  const labelsState = useRepoLabels(repoFullName, pushAccess);
  const labelIndex = useMemo(() => {
    const map = new Map<string, string>();
    if (labelsState.status === "ready") {
      for (const label of labelsState.labels) map.set(label.name.toLowerCase(), label.name);
    }
    return map;
  }, [labelsState]);
  const titleTokens = useMemo(() => findTokens(title, "@"), [title]);
  const matchedTitleTokens = useMemo(
    () => titleTokens.filter((tok) => isTokenMatched(tok, labelIndex)),
    [titleTokens, labelIndex],
  );
  const displayTitleTokens = useMemo(
    () => titleTokens.map((tok) => ({ ...tok, matched: isTokenMatched(tok, labelIndex) })),
    [titleTokens, labelIndex],
  );
  const cleanTitle = useMemo(() => stripTokens(title, matchedTitleTokens), [title, matchedTitleTokens]);

  // 空白の後続がある（＝入力確定済みの）@label トークンだけを、入力中にラベル選択へ自動反映する
  // （末尾のトークンはまだ入力中の可能性があるため対象外・タップ削除やチェックボックス解除で戻せる）。
  useEffect(() => {
    const committed = committedTokens(matchedTitleTokens, title);
    if (committed.length === 0) return;
    setLabels((prev) => {
      const additions = committed
        .map((tok) => labelIndex.get(tok.name.toLowerCase()))
        .filter((name): name is string => typeof name === "string" && !prev.includes(name));
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  }, [matchedTitleTokens, title, labelIndex]);

  const canSubmit = cleanTitle.length > 0 && !submitting;

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

  /** 認識済みトークンをタップで解除する（B3-3 Done Criteria）。テキストからも紐づくラベルからも取り除く。 */
  function removeSmartToken(token: SmartToken) {
    const name = labelIndex.get(token.name.toLowerCase());
    handleTitleChange(stripTokens(title, [token]));
    if (name) setLabels((prev) => prev.filter((l) => l !== name));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    // 末尾のトークン（入力確定前）も送信時点では確定として扱い、ラベルへ反映してからタイトルを送る。
    const extraLabels = matchedTitleTokens
      .map((tok) => labelIndex.get(tok.name.toLowerCase()))
      .filter((name): name is string => typeof name === "string" && !labels.includes(name));
    onSubmit({
      title: cleanTitle,
      body: body.trim(),
      labels: extraLabels.length > 0 ? [...labels, ...extraLabels] : labels,
    });
  }

  return (
    <form className="issue-form" onSubmit={handleSubmit}>
      <p className="target-repo">
        {t.issueForm.targetRepoLabel}: <strong>{repoFullName}</strong>
      </p>
      <label>
        <span className="field-label">{t.issueForm.titleLabel}</span>
        <HighlightedTextInput
          value={title}
          onChange={handleTitleChange}
          tokens={displayTitleTokens}
          placeholder={t.issueForm.titlePlaceholder}
          enterKeyHint="send"
          autoCapitalize="sentences"
          autoFocus
        />
      </label>
      {matchedTitleTokens.length > 0 ? (
        <ul className="smart-token-chips" aria-label={t.issueForm.smartTokenListLabel}>
          {matchedTitleTokens.map((tok) => (
            <li key={`${tok.start}-${tok.raw}`}>
              <button
                type="button"
                aria-label={`${t.issueForm.removeSmartTokenLabel}: ${tok.raw}`}
                onClick={() => removeSmartToken(tok)}
              >
                {tok.raw} <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
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
        pushAccess={pushAccess}
        selected={labels}
        onChange={setLabels}
        initiallyOpen={(initialLabels?.length ?? 0) > 0}
        labelsState={labelsState}
      />
      {children}
      <div className="submit-row">
        <button type="submit" disabled={!canSubmit}>
          {submitting ? t.issueForm.submitting : t.issueForm.submitButton}
        </button>
      </div>
    </form>
  );
}
