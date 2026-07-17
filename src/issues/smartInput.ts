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
