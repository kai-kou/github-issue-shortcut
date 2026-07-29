import { test, expect } from "@playwright/test";

// セキュリティヘッダー（#209）が **実際に配信される** ことを配信経路ごとに固定する。
//
// なぜ E2E が要るか: ヘッダーの経路は 2 つに分かれている。
// - 静的アセット（index.html / JS / CSS）… Worker を経由せず asset server が `public/_headers` を適用
// - Worker のレスポンス（/api/* /auth/* /setup）… `worker/index.ts` のミドルウェアが適用
// ユニットテストは Worker 側しか通らず、`_headers` の破損や `wrangler.jsonc` の `run_worker_first`
// 変更（Worker 経由ルートが変わりミドルウェアが効かなくなる）を 1 件も検出できない。
// 「本番でページに CSP が付かないのに CI は緑」を防ぐのがこの spec の役割。
const EXPECTED = {
  "content-security-policy":
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; " +
    "img-src 'self' data: https://avatars.githubusercontent.com",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
};

test.describe("セキュリティヘッダーの配信（#209）", () => {
  // 静的アセット経路（ページ本体・SPA フォールバック）と Worker 経路の両方を通す。
  for (const [label, path] of [
    ["ページ本体（静的アセット）", "/"],
    ["SPA フォールバック（クライアントルート）", "/shortcuts"],
    ["静的アセット（manifest）", "/manifest.webmanifest"],
    ["Worker の JSON 応答", "/api/health"],
    ["Worker のリダイレクト", "/setup"],
  ] as const) {
    test(`${label} に CSP・nosniff・frame 拒否・referrer 制限が付く`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      const headers = res.headers();
      for (const [name, value] of Object.entries(EXPECTED)) {
        expect(headers[name], `${path} の ${name}`).toBe(value);
      }
    });
  }

  test("CSP 下でもアプリが描画され、CSP 違反が発生しない", async ({ page }) => {
    // ヘッダーが付いているだけでは不十分で、その内容がアプリの実構成（外部 JS/CSS なし・
    // インライン script なし）と噛み合っていることまで確認する。違反が出れば画面が壊れる。
    const violations: string[] = [];
    page.on("console", (msg) => {
      if (msg.text().includes("Content Security Policy")) violations.push(msg.text());
    });
    await page.goto("/");
    await expect(page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ })).toBeVisible();
    expect(violations).toEqual([]);
  });
});
