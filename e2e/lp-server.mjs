// LP（site/）を配信するだけの静的サーバー。E2E から http:// で開くために使う。
// file:// だと localStorage が SecurityError になり、言語設定の永続化を検証できないため
// （本番と同じ http オリジンで回す）。依存ゼロ・Node 標準モジュールのみ。
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "site");
const PORT = Number(process.env.LP_PORT || 8790);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer((req, res) => {
  const requestPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  // ".." を含むパスでドキュメントルート外へ出られないようにする
  const relative = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(ROOT, relative.endsWith("/") ? `${relative}index.html` : relative);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    res.writeHead(404).end("Not Found");
    return;
  }
  if (stats.isDirectory()) {
    res.writeHead(404).end("Not Found");
    return;
  }

  res.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(filePath)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(filePath).pipe(res);
}).listen(PORT, () => {
  console.log(`LP static server on http://localhost:${PORT}`);
});
