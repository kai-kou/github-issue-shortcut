/** 選択中リポジトリに push 権限があるかを判定する（ラベル取得の可否と LabelPicker の
 * 警告表示に使う・B3-2 / B5-3）。RepoPicker（起票フォーム）と ShortcutHelperPage
 * （ショートカット作成フォーム）で判定基準がドリフトしないよう共通化している（#128）。
 *
 * リポジトリ未選択（空文字・null）や、一覧に存在しない fullName の場合は false を返す
 * （権限不明のときはラベルを取得せず警告表示に倒す安全側の既定）。 */
export function hasPushAccess(
  repos: readonly { fullName: string; pushAccess: boolean }[],
  fullName: string | null | undefined,
): boolean {
  if (!fullName) return false;
  return repos.find((r) => r.fullName === fullName)?.pushAccess ?? false;
}
