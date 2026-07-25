/** スマート入力（B3-3・FR-20）: 入力中の `#repo` `@label` トークンをインライン認識するための純ロジック。
 * UI（ハイライト描画・タップ解除）は HighlightedTextInput / IssueForm / RepoPicker 側が担う。 */

export interface SmartToken {
  prefix: "#" | "@";
  /** プレフィックスを含む生テキスト（例: "@bug"）。 */
  raw: string;
  /** プレフィックスを除いた名前部分（例: "bug"）。 */
  name: string;
  start: number;
  end: number;
}

// 直前が行頭または空白であることをトークンの開始条件とする（メールアドレスの "@" 等を誤認識しないため）。
const TOKEN_RE = /(^|\s)([#@])(\S+)/g;

/** `text` 内から指定した prefix（`#` または `@`）のトークンをすべて抽出する。 */
export function findTokens(text: string, prefix: "#" | "@"): SmartToken[] {
  const tokens: SmartToken[] = [];
  const re = new RegExp(TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const [, lead, p, name] = match;
    if (p !== prefix) continue;
    const start = match.index + lead.length;
    tokens.push({ prefix: p as "#" | "@", raw: `${p}${name}`, name, start, end: start + 1 + name.length });
  }
  return tokens;
}

/** 空白の後続がある（＝入力確定済み）トークンのみを返す。末尾のトークンは入力中の可能性があるため除く。 */
export function committedTokens(tokens: SmartToken[], text: string): SmartToken[] {
  return tokens.filter((t) => t.end < text.length);
}

/** 大文字小文字を無視した完全一致でトークンが有効かを判定する。 */
export function isTokenMatched(token: SmartToken, validNames: ReadonlySet<string> | ReadonlyMap<string, string>): boolean {
  return validNames.has(token.name.toLowerCase());
}

/** 入力中（＝末尾にあり、まだ空白で確定していない）のトークンを返す。候補リストの表示条件に使う
 * （#145）。`committedTokens` の逆条件であり、確定済みトークンには候補を出さない。 */
export function activeToken(tokens: SmartToken[], text: string): SmartToken | null {
  const last = tokens[tokens.length - 1];
  return last && last.end === text.length ? last : null;
}

/** 入力中トークンの名前に前方一致（大文字小文字無視）する候補を返す（#145）。
 * 名前が空（`@` だけ）のときは全件を対象にする。完全一致が 1 件だけの場合は既に認識済み
 * （ハイライト + チップで示される）なので候補を出さない。 */
export function suggestNames(candidates: readonly string[], prefix: string, limit: number): string[] {
  const needle = prefix.toLowerCase();
  const matches = candidates.filter((name) => name.toLowerCase().startsWith(needle));
  if (matches.length === 1 && matches[0].toLowerCase() === needle) return [];
  return matches.slice(0, limit);
}

/** トークンを完全な名前へ置き換える（#145 の候補タップ）。末尾に空白を足して「確定済み」にし、
 * 既存の確定トークン → ラベル自動反映の経路へそのまま乗せる。 */
export function replaceToken(text: string, token: SmartToken, name: string): string {
  const before = text.slice(0, token.start);
  const after = text.slice(token.end);
  const replaced = `${before}${token.prefix}${name} ${after}`;
  return after.startsWith(" ") ? replaced.replace(/\s{2,}/g, " ") : replaced;
}

/** 指定したトークン群を `text` から取り除き、生じた余分な空白を畳んで整形する。 */
export function stripTokens(text: string, tokens: SmartToken[]): string {
  if (tokens.length === 0) return text;
  const sorted = [...tokens].sort((a, b) => a.start - b.start);
  let result = "";
  let cursor = 0;
  for (const t of sorted) {
    result += text.slice(cursor, t.start);
    cursor = Math.max(cursor, t.end);
  }
  result += text.slice(cursor);
  return result.replace(/\s{2,}/g, " ").trim();
}
