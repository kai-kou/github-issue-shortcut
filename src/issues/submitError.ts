import type { Translations } from "../i18n/translations";

/** `/api/issues` の失敗レスポンス（`{ error: { code, message } }`・B5-2・FR-9）から表示コードを読み取る。 */
export async function submitErrorCode(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { code?: string } };
    return data.error?.code ?? "upstream_failed";
  } catch {
    return "upstream_failed";
  }
}

/** エラー種別ごとに識別可能な文言へ振り分ける（B5-2）。未知のコードは汎用メッセージにフォールバックする。 */
export function submitErrorMessage(code: string, t: Translations): string {
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
