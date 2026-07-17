export type ShortcutPreset = { repo: string; labels: string[]; title: string };

/** プリセットから `/new?repo=&labels=&title=` の起動 URL を組み立てる（C1-1・FR-16）。
 * `parsePrefillParams`（B1-2）が読み取る形式と対称（labels はカンマ区切り）。 */
export function buildLaunchUrl(preset: ShortcutPreset, origin: string): string {
  const params = new URLSearchParams();
  if (preset.repo) params.set("repo", preset.repo);
  if (preset.labels.length > 0) params.set("labels", preset.labels.join(","));
  if (preset.title) params.set("title", preset.title);
  const query = params.toString();
  return `${origin}/new${query ? `?${query}` : ""}`;
}
