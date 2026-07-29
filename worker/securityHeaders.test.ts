import { describe, expect, it } from "vitest";
import headersFile from "../public/_headers?raw";
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from "./securityHeaders";

/**
 * `public/_headers`（静的アセット用）と `worker/securityHeaders.ts`（Worker レスポンス用）は
 * 二重管理せざるを得ない（理由は securityHeaders.ts のコメント）。片方だけ更新すると
 * 「守れていない経路」が静かに生まれ、テストも CI も緑のままになるため、ここで一致を機械検証する。
 */
describe("public/_headers と Worker のセキュリティヘッダーの一致（#209）", () => {
  // `_headers` は「パスのパターン行 → その配下のヘッダー行」というブロック構造。行を平坦に集めると
  // **ヘッダーが別パスのブロックへ移動していても検出できない**（`/*` が空でもテストが緑になる）ため、
  // どのブロックに属するかを追いながら読む。
  const blocks = new Map<string, Map<string, string>>();
  let currentPath: string | null = null;
  for (const raw of headersFile.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (!raw.startsWith(" ") && !raw.startsWith("\t")) {
      currentPath = line;
      if (!blocks.has(currentPath)) blocks.set(currentPath, new Map());
      continue;
    }
    const separator = line.indexOf(":");
    if (currentPath === null || separator < 0) continue;
    blocks.get(currentPath)!.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  const rules = blocks.get("/*") ?? new Map<string, string>();

  it("全パス（/*）のブロックが存在し、空でない", () => {
    expect(blocks.has("/*")).toBe(true);
    expect(rules.size).toBeGreaterThan(0);
  });

  it("/* 以外のブロックにヘッダーが逃げていない（全ページ無防備になる壊れ方の検知）", () => {
    expect([...blocks.keys()]).toEqual(["/*"]);
  });

  it("Worker 側と同じヘッダー・同じ値を宣言している", () => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(rules.get(name)).toBe(value);
    }
  });

  it("_headers 側にだけ存在する余分なヘッダーがない", () => {
    expect([...rules.keys()].sort()).toEqual(Object.keys(SECURITY_HEADERS).sort());
  });
});

describe("CSP の内容", () => {
  it("インライン実行・eval を許可しない（ビルド成果物にインライン script / style が無い前提）", () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-inline");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
  });

  it("埋め込み（クリックジャッキング）とプラグインを禁止する", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  });

  it("アバターの読み込み元として GitHub の CDN だけを追加で許可する", () => {
    // `img-src` を絞りすぎると /api/me が返す avatar_url が表示できなくなる（default-src 'self'
    // だけでは本番のアバターがブロックされる）。許可先が広がっていないことも同時に守る。
    expect(CONTENT_SECURITY_POLICY).toContain("img-src 'self' data: https://avatars.githubusercontent.com");
    expect(CONTENT_SECURITY_POLICY).not.toContain("img-src 'self' data: https:;");
  });
});
