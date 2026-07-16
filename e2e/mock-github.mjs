// E2E 用のモック GitHub OAuth サーバー（実 GitHub に触れず OAuth 往復を再現する）。
// - GET  /login/oauth/authorize             : ユーザー承認をシミュレートし redirect_uri へ code+state を返す
// - POST /login/oauth/access_token          : トークン交換のレスポンスを返す
// - GET  /user                              : ログインユーザー情報を返す
// - GET  /user/installations                : App インストール一覧を返す（既定は e2e-user 常に 0 件・A2-1）
// - GET  /user/installations/:id/repositories: インストール別のアクセス可能リポジトリを返す（B2-1/B2-2）
// - POST /mock/config                       : インストール/リポジトリの応答内容をテストごとに上書きする
// Worker（wrangler dev）の GITHUB_OAUTH_BASE / GITHUB_API_BASE をこのサーバーに向けて使う。
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_GITHUB_PORT ?? 8788);
const MOCK_USER = { id: 424242, login: "e2e-user", avatar_url: "https://example.com/avatar.png" };

/** @type {{ installations: Array<{ id: number, repos: Array<{ id: number, full_name: string, private: boolean }> }> }} */
let mockConfig = { installations: [] };

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const json = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET" && url.pathname === "/health") return json(200, { status: "ok" });

  if (req.method === "GET" && url.pathname === "/login/oauth/authorize") {
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state") ?? "";
    if (!redirectUri) {
      res.writeHead(400);
      return res.end("missing redirect_uri");
    }
    let to;
    try {
      to = new URL(redirectUri);
    } catch {
      res.writeHead(400);
      return res.end("invalid redirect_uri");
    }
    to.searchParams.set("code", "mock_authorization_code");
    to.searchParams.set("state", state);
    res.writeHead(302, { Location: to.toString() });
    return res.end();
  }

  if (req.method === "POST" && url.pathname === "/login/oauth/access_token") {
    return json(200, {
      access_token: "mock_access_token",
      token_type: "bearer",
      expires_in: 28800,
      refresh_token: "mock_refresh_token",
      refresh_token_expires_in: 15897600,
      scope: "",
    });
  }

  if (req.method === "GET" && url.pathname === "/user") return json(200, MOCK_USER);

  // テストごとにインストール/リポジトリの応答内容を差し替える(B2-1/B2-2 の E2E で使用)。
  // 未設定時は installations: [] (= e2e-user は常に未インストール。A2-1 の既定シナリオを維持)。
  if (req.method === "POST" && url.pathname === "/mock/config") {
    try {
      const body = await readJsonBody(req);
      mockConfig = { installations: Array.isArray(body.installations) ? body.installations : [] };
      return json(200, { ok: true });
    } catch {
      res.writeHead(400);
      return res.end();
    }
  }

  if (req.method === "GET" && url.pathname === "/user/installations") {
    return json(200, {
      total_count: mockConfig.installations.length,
      installations: mockConfig.installations.map((i) => ({ id: i.id })),
    });
  }

  const repoMatch = url.pathname.match(/^\/user\/installations\/(\d+)\/repositories$/);
  if (req.method === "GET" && repoMatch) {
    const installation = mockConfig.installations.find((i) => String(i.id) === repoMatch[1]);
    const repos = installation?.repos ?? [];
    return json(200, { total_count: repos.length, repositories: repos });
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "not found" }));
});

server.listen(PORT, () => console.log(`[mock-github] listening on http://localhost:${PORT}`));
