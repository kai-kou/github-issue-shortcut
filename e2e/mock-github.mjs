// E2E 用のモック GitHub OAuth サーバー（実 GitHub に触れず OAuth 往復を再現する）。
// - GET  /login/oauth/authorize             : ユーザー承認をシミュレートし redirect_uri へ code+state を返す
// - POST /login/oauth/access_token          : トークン交換 / リフレッシュのレスポンスを返す（単回使用ローテーションを再現）
// - GET  /mock/refresh-count                : refresh_token グラントが走った回数（Web Locks 1本化の検証用・#164）
// - GET  /user                              : ログインユーザー情報を返す
// - GET  /user/installations                : App インストール一覧を返す（既定は e2e-user 常に 0 件・A2-1）
// - GET  /user/installations/:id/repositories: インストール別のアクセス可能リポジトリを返す（B2-1/B2-2）
// - GET  /repos/:owner/:repo/labels         : リポジトリのラベル一覧を返す（B3-2）
// - POST /repos/:owner/:repo/issues         : Issue 作成をシミュレートし number/html_url を返す（B4-1）
// - GET  /mock/last-issue                   : 直近の Issue 作成リクエストボディを返す（labels 送信の E2E 検証用）
// - GET  /mock/issue-count                  : 作成された Issue の件数を返す（オフライン再送の重複なし検証・#148）
// - POST /mock/config                       : インストール/リポジトリ/ラベルの応答内容をテストごとに上書きする
// Worker（wrangler dev）の GITHUB_OAUTH_BASE / GITHUB_API_BASE をこのサーバーに向けて使う。
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_GITHUB_PORT ?? 8788);
// avatar_url はモックサーバー自身を指す（UI が <img src> に使うため、外部ホストだと
// egress 制限のある CI で接続待ちがぶら下がりフレーク要因になる。404 応答で高速に解決させる）。
const MOCK_USER = { id: 424242, login: "e2e-user", avatar_url: "http://localhost:8788/avatar.png" };

/**
 * @type {{
 *   installations: Array<{ id: number, repos: Array<{ id: number, full_name: string, private: boolean, permissions?: { push?: boolean } }> }>,
 *   labels: Array<{ name: string, color: string }>,
 *   labelsByRepo: Record<string, Array<{ name: string, color: string }>>,
 * }}
 */
let mockConfig = { installations: [], labels: [], labelsByRepo: {} };
let nextIssueNumber = 1;
let lastIssueRequestBody = null;
// GitHub App の access token 既定 TTL（8 時間）。`POST /mock/config` の `accessTokenTtl` で
// 上書きすると「ログイン直後から失効している」状況を作れる（自動リフレッシュの E2E・#164）。
const DEFAULT_ACCESS_TOKEN_TTL = 28800;
let accessTokenTtl = DEFAULT_ACCESS_TOKEN_TTL;
// GitHub の refresh token は単回使用ローテーション。いま有効な 1 本だけを保持し、古い値での
// リフレッシュは bad_refresh_token で拒否する（多重リフレッシュが起きたらテストが落ちる）。
let validRefreshToken = "mock_refresh_token";
let refreshCount = 0;
let nextRefreshSerial = 0;
// 実際に作成された Issue の件数（#148）。オフラインキューの再送で「GitHub 側に 1 件だけ
// 作られたか」を、キュー表示が消えたという間接証拠ではなく直接検証するために数える。
let issueCreateCount = 0;

// タイトルにこのマジック文字列を使うと、Issue 作成 API が対応する GitHub エラーを返す
// （B5-2/FR-9 の E2E: エラー種別ごとの表示分岐を検証するためのトリガー）。
const ISSUE_CREATION_ERROR_TRIGGERS = {
  __mock_401__: { status: 401, body: { message: "Bad credentials" } },
  __mock_403_rate_limit__: {
    status: 403,
    body: { message: "You have exceeded a secondary rate limit" },
    headers: { "Retry-After": "30" },
  },
  __mock_422__: { status: 422, body: { message: "Validation failed" } },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

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
    const params = new URLSearchParams(await readRawBody(req));
    if (params.get("grant_type") === "refresh_token") {
      // 単回使用ローテーション: 既に消費済み（＝古い）refresh token は拒否する。
      if (params.get("refresh_token") !== validRefreshToken) {
        return json(200, { error: "bad_refresh_token", error_description: "refresh token already used" });
      }
      refreshCount += 1;
      validRefreshToken = `mock_refresh_token_${++nextRefreshSerial}`;
      return json(200, {
        access_token: `mock_access_token_${nextRefreshSerial}`,
        token_type: "bearer",
        // リフレッシュ後は通常 TTL に戻す（リフレッシュ直後の再リフレッシュ連鎖を避ける）。
        expires_in: DEFAULT_ACCESS_TOKEN_TTL,
        refresh_token: validRefreshToken,
        refresh_token_expires_in: 15897600,
        scope: "",
      });
    }
    validRefreshToken = "mock_refresh_token";
    return json(200, {
      access_token: "mock_access_token",
      token_type: "bearer",
      expires_in: accessTokenTtl,
      refresh_token: validRefreshToken,
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
      mockConfig = {
        installations: Array.isArray(body.installations) ? body.installations : [],
        labels: Array.isArray(body.labels) ? body.labels : [],
        // repo 別ラベル（任意）。未指定 repo は既存の `labels`（グローバル）へフォールバックする
        // ため、labelsByRepo を使わない既存テストは無改修のまま動く（後方互換）。
        labelsByRepo:
          body.labelsByRepo && typeof body.labelsByRepo === "object" ? body.labelsByRepo : {},
      };
      // access token の TTL（既定 8 時間）。小さくすると「失効済みトークンでの再訪」を再現できる。
      accessTokenTtl = Number.isFinite(body.accessTokenTtl) ? body.accessTokenTtl : DEFAULT_ACCESS_TOKEN_TTL;
      // テストごとの初期化点。作成件数・リフレッシュ回数もここでリセットし、spec 間で持ち越さない。
      issueCreateCount = 0;
      refreshCount = 0;
      return json(200, { ok: true });
    } catch {
      res.writeHead(400);
      return res.end();
    }
  }

  if (req.method === "GET" && url.pathname === "/mock/last-issue") {
    return json(200, lastIssueRequestBody ?? {});
  }

  if (req.method === "GET" && url.pathname === "/mock/issue-count") {
    return json(200, { count: issueCreateCount });
  }

  if (req.method === "GET" && url.pathname === "/mock/refresh-count") {
    return json(200, { count: refreshCount });
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

  const labelsMatch = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/labels$/);
  if (req.method === "GET" && labelsMatch) {
    const repoFullName = labelsMatch[1];
    const perRepo = mockConfig.labelsByRepo[repoFullName];
    return json(200, perRepo ?? mockConfig.labels);
  }

  const issueMatch = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/issues$/);
  if (req.method === "POST" && issueMatch) {
    const body = await readJsonBody(req);
    if (!body.title) {
      res.writeHead(422);
      return res.end();
    }
    const trigger = ISSUE_CREATION_ERROR_TRIGGERS[body.title];
    if (trigger) {
      res.writeHead(trigger.status, { "Content-Type": "application/json", ...(trigger.headers ?? {}) });
      return res.end(JSON.stringify(trigger.body));
    }
    lastIssueRequestBody = body;
    issueCreateCount += 1;
    const number = nextIssueNumber++;
    return json(201, { number, html_url: `https://github.com/${issueMatch[1]}/issues/${number}` });
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "not found" }));
});

server.listen(PORT, () => console.log(`[mock-github] listening on http://localhost:${PORT}`));
