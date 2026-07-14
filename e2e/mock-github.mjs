// E2E 用のモック GitHub OAuth サーバー（実 GitHub に触れず OAuth 往復を再現する）。
// - GET  /login/oauth/authorize    : ユーザー承認をシミュレートし redirect_uri へ code+state を返す
// - POST /login/oauth/access_token : トークン交換のレスポンスを返す
// - GET  /user                     : ログインユーザー情報を返す
// Worker（wrangler dev）の GITHUB_OAUTH_BASE / GITHUB_API_BASE をこのサーバーに向けて使う。
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_GITHUB_PORT ?? 8788);
const MOCK_USER = { id: 424242, login: "e2e-user", avatar_url: "https://example.com/avatar.png" };

const server = createServer((req, res) => {
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
    const to = new URL(redirectUri);
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

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "not found" }));
});

server.listen(PORT, () => console.log(`[mock-github] listening on http://localhost:${PORT}`));
