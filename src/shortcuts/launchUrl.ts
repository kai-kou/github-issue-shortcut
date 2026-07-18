/** name は表示名（一覧・ホーム画面・PWA manifest.shortcuts での見出しに使う付加情報）。
 * 起票内容そのものではないため `buildLaunchUrl` の URL には含めない（#98）。 */
export type ShortcutPreset = { repo: string; labels: string[]; title: string; name: string };

/** プリセットから `/new?repo=&labels=&title=` の起動 URL を組み立てる（C1-1・FR-16）。
 * `parsePrefillParams`（B1-2）が読み取る形式と対称（labels はカンマ区切り）。name は含めない。 */
export function buildLaunchUrl(preset: ShortcutPreset, origin: string): string {
  const params = new URLSearchParams();
  if (preset.repo) params.set("repo", preset.repo);
  if (preset.labels.length > 0) params.set("labels", preset.labels.join(","));
  if (preset.title) params.set("title", preset.title);
  const query = params.toString();
  return `${origin}/new${query ? `?${query}` : ""}`;
}
