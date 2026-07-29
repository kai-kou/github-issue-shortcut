/**
 * LP（site/）の画像アセットを生成する。
 *
 *   node tools/build_lp_assets.mjs
 *
 * 生成物（いずれもコミット対象。CI では生成しない）:
 *   - site/assets/og.png            OGP 画像 1200x630
 *   - site/assets/hero-form.png     起票フォームの切り出し（ヒーロー用）
 *   - site/assets/smart-input.png   スマート入力の切り出し（機能カード用）
 *
 * 元データは `npm run screenshots` が生成する docs/assets/screenshots/*.png。
 * 画像処理ライブラリを増やさずに済むよう、既に開発依存にある Playwright の
 * Chromium で描画してスクリーンショットする（design-guidelines D-6 と同じ方針）。
 */
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outPath = resolve(repoRoot, "site/assets/og.png");
const toDataUri = (relPath) =>
  "data:image/png;base64," + readFileSync(resolve(repoRoot, relPath)).toString("base64");
const iconDataUri = toDataUri("public/icons/icon-192.png");

/** 元スクリーンショット（780x1688）から切り出す領域。y は元画像のピクセル座標。 */
const CROPS = [
  {
    source: "docs/assets/screenshots/issue-form.png",
    out: "site/assets/hero-form.png",
    // 背景に透ける灰色のリポジトリ選択画面を削り、ボトムシート（起票フォーム）を主役にする
    y: 540,
    height: 1148,
  },
  {
    source: "docs/assets/screenshots/smart-input.png",
    out: "site/assets/smart-input.png",
    // タイトル欄に `@b` を打った直後のラベル候補（bug / backlog）だけを切り出す
    y: 745,
    height: 352,
  },
];

const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; margin: 0; }
      body {
        width: 1200px;
        height: 630px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 28px;
        padding: 76px 88px;
        background:
          radial-gradient(52% 62% at 12% 8%, rgba(9, 105, 218, 0.32), transparent 68%),
          radial-gradient(48% 58% at 92% 96%, rgba(31, 136, 61, 0.34), transparent 66%),
          #0d1117;
        color: #e6edf3;
        font-family: system-ui, -apple-system, "Noto Sans JP", sans-serif;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 16px;
        font-size: 27px;
        font-weight: 700;
        color: #9198a1;
        letter-spacing: 0.01em;
      }
      .brand img { width: 46px; height: 46px; border-radius: 12px; }
      h1 {
        font-size: 78px;
        font-weight: 800;
        line-height: 1.24;
        letter-spacing: -0.028em;
      }
      h1 em {
        font-style: normal;
        background: linear-gradient(100deg, #79c0ff, #56d364);
        -webkit-background-clip: text;
        color: transparent;
      }
      p {
        font-size: 31px;
        line-height: 1.6;
        color: #9198a1;
        max-width: 720px;
        line-break: strict;
        word-break: keep-all;
      }
      .tags { display: flex; gap: 14px; margin-top: 8px; }
      .tag {
        padding: 11px 24px;
        border: 1px solid #30363d;
        border-radius: 999px;
        background: rgba(22, 27, 34, 0.75);
        font-size: 24px;
        font-weight: 600;
        color: #e6edf3;
      }
    </style>
  </head>
  <body>
    <div class="brand"><img src="${iconDataUri}" alt="" />GitHub Issue Shortcut</div>
    <h1>思いついた瞬間を、<br /><em>数秒で Issue</em> に。</h1>
    <p>Android のホーム画面から直行する GitHub Issue 起票 PWA</p>
    <div class="tags">
      <span class="tag">PAT 不要</span>
      <span class="tag">権限は Issues のみ</span>
      <span class="tag">オープンソース（MIT）</span>
    </div>
  </body>
</html>`;

// 既定は Playwright が管理する Chromium。別途用意した実行ファイルを使うときは
// OG_CHROMIUM_PATH で上書きする（Playwright のバージョンと同梱ブラウザがずれる環境向け）。
const browser = await chromium.launch(
  process.env.OG_CHROMIUM_PATH ? { executablePath: process.env.OG_CHROMIUM_PATH } : {}
);
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: "load" });
await page.screenshot({ path: outPath });
console.log(`wrote ${outPath}`);

for (const crop of CROPS) {
  const target = resolve(repoRoot, crop.out);
  await page.setViewportSize({ width: 780, height: crop.height });
  await page.setContent(
    `<body style="margin:0"><img src="${toDataUri(crop.source)}" style="display:block;width:780px;margin-top:-${crop.y}px"></body>`,
    { waitUntil: "load" }
  );
  await page.screenshot({
    path: target,
    clip: { x: 0, y: 0, width: 780, height: crop.height },
  });
  console.log(`wrote ${target}`);
}

await browser.close();
