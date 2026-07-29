import { describe, expect, it } from "vitest";
import headersFile from "../public/_headers?raw";
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from "./securityHeaders";

/**
 * `public/_headers`（静的アセット用）と `worker/securityHeaders.ts`（Worker レスポンス用）は
 * 二重管理せざるを得ない（理由は securityHeaders.ts のコメント）。片方だけ更新すると
 * 「守れていない経路」が静かに生まれ、テストも CI も緑のままになるため、ここで一致を機械検証する。
 */
describe("public/_headers と Worker のセキュリティヘッダーの一致（#209）", () => {
  const lines = headersFile.split("\n").map((line) => line.trim());
  const rules = new Map(
    lines
      .filter((line) => line && !line.startsWith("#") && line.includes(":"))
      .map((line) => {
        const separator = line.indexOf(":");
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const;
      }),
  );

  it("全パス（/*）に適用される", () => {
    expect(lines).toContain("/*");
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
