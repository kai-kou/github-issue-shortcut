import { test, expect } from "@playwright/test";

// OAuth ログインフローの E2E（モック GitHub・Pixel モバイルエミュレーション）。
// 実コード（ブラウザ ↔ Worker）を通し、実 GitHub には触れない。
// カバー範囲: /auth/login（state+PKCE）→ 認可（モック）→ /auth/callback（トークン交換・
// セッション発行）→ /api/me でログイン表示 → /api/installations（A2-1・App 未インストール誘導）→ /auth/logout。
// 実機 Android 固有（WebAPK・standalone PWA の Chrome Custom Tab 経由 OAuth）は対象外。
test.describe("OAuth ログインフロー（モック GitHub・モバイルエミュレーション）", () => {
  test("ログイン → セッション確立 → ログイン表示 → ログアウト", async ({ page }) => {
    // readiness: 鍵・鍵バージョン・client_id・レート制限バインディングが揃っていること。
    // E2E は緩い上限のバインディング（ISSUE_RATE_LIMIT_RELAXED_ENABLED=1）で動かすため、
    // 「本番でその緩和フラグが立っていないこと」を見る rateLimiterStrict だけは意図的に false
    // （＝全体としては 503）。本番では 200 / ready:true になる（tools/smoke_prod.sh）。
    const ready = await page.request.get("/api/ready");
    const checks = (await ready.json()).checks as Record<string, boolean>;
    expect(checks.encryptionKey).toBe(true);
    expect(checks.keyVersion).toBe(true);
    expect(checks.clientId).toBe(true);
    expect(checks.rateLimiter).toBe(true);
    expect(checks.rateLimiterStrict).toBe(false);

    await page.goto("/");

    const loginLink = page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ });
    await expect(loginLink).toBeVisible();

    // フルページリダイレクト: /auth/login → モック authorize → /auth/callback → /
    await loginLink.click();

    // 復帰後、モックユーザー（e2e-user）でログイン中表示になる（トップバーのアカウントチップ）
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    // ログイン状態・ログアウトはサイドパネルに集約された。パネルを開いてから操作する。
    await page.getByRole("button", { name: /メニューを開く|Open menu/ }).first().click();
    const logoutButton = page.getByRole("button", { name: /ログアウト|Sign out/ });
    await expect(logoutButton).toBeVisible();

    // /api/me が認証済みを返す（セッション Cookie が確立している）
    const me = await page.request.get("/api/me");
    expect(me.status()).toBe(200);
    expect((await me.json()).login).toBe("e2e-user");

    // A2-1: モック GitHub は installations 0 件を返すため、App インストール誘導が表示される
    const installations = await page.request.get("/api/installations");
    expect(installations.status()).toBe(200);
    expect((await installations.json()).installed).toBe(false);
    await expect(page.getByRole("link", { name: /GitHub App をインストール|Install GitHub App/ })).toBeVisible();

    // ログアウトの削除範囲を検証するため、端末内データを仕込む（#181）。
    await page.evaluate(() => {
      localStorage.setItem("issue-shortcut:recent-repos", JSON.stringify(["e2e-user/private-repo"]));
      localStorage.setItem("issue-shortcut:recent-submissions", JSON.stringify([{ key: "abc", at: Date.now() }]));
      localStorage.setItem("issue-shortcut:draft", JSON.stringify({ repo: "e2e-user/repo", title: "書きかけ", body: "" }));
      localStorage.setItem(
        "issue-shortcut:offline-queue",
        JSON.stringify([
          { id: "q1", repo: "e2e-user/repo", title: "未送信の起票", body: "本文", labels: [], queuedAt: Date.now(), status: "pending" },
        ]),
      );
    });

    // ログアウト → 未ログイン状態（ログインリンク）に戻る
    await logoutButton.click();
    await expect(
      page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }),
    ).toBeVisible();

    // ログアウトでは「共有端末で次の利用者に見えてはいけないもの」だけを消し、**未送信の入力は残す**
    // （#181・プライバシーポリシー §6 の記述と一致。誤ってログアウトしただけで起票内容を失わせない）。
    const afterLogout = await page.evaluate(() => ({
      recentRepos: localStorage.getItem("issue-shortcut:recent-repos"),
      recentSubmissions: localStorage.getItem("issue-shortcut:recent-submissions"),
      draft: localStorage.getItem("issue-shortcut:draft"),
      offlineQueue: localStorage.getItem("issue-shortcut:offline-queue"),
    }));
    expect(afterLogout.recentRepos).toBeNull();
    expect(afterLogout.recentSubmissions).toBeNull();
    expect(afterLogout.draft).not.toBeNull();
    expect(afterLogout.offlineQueue).not.toBeNull();
  });

  // A4-3: アカウント削除（FR-12・PR-3）。本アプリ側データの削除 + GitHub 側連携解除の案内を検証する。
  test("アカウント削除 → 本アプリ側データ削除 + 連携解除の案内表示", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    // 削除がローカルの SWR キャッシュ（repos/shortcuts）も消すことを検証するためキャッシュを仕込む
    // （#101・PR #113 レビューで検出した回帰の防止）。あわせて #181 で削除対象に加えた
    // 「最近使ったリポジトリ・送信履歴・下書き・オフラインキュー」も仕込み、プライバシーポリシーが
    // 述べる削除範囲と実装が一致することを検証する。
    await page.evaluate(() => {
      localStorage.setItem("issue-shortcut:repos-cache", "{}");
      localStorage.setItem("issue-shortcut:shortcuts-cache", "{}");
      localStorage.setItem("issue-shortcut:recent-repos", JSON.stringify(["e2e-user/private-repo"]));
      localStorage.setItem("issue-shortcut:recent-submissions", JSON.stringify([{ key: "abc", at: Date.now() }]));
      localStorage.setItem("issue-shortcut:draft", JSON.stringify({ repo: "e2e-user/repo", title: "秘密の下書き", body: "" }));
      localStorage.setItem(
        "issue-shortcut:offline-queue",
        JSON.stringify([
          { id: "q1", repo: "e2e-user/repo", title: "未送信の起票", body: "本文", labels: [], queuedAt: Date.now(), status: "pending" },
        ]),
      );
      localStorage.setItem("issue-shortcut:locale", "ja");
    });

    // アカウント削除はサイドパネルのアカウントセクションに集約された。
    await page.getByRole("button", { name: /メニューを開く|Open menu/ }).first().click();
    await page.getByRole("button", { name: /アカウント削除|Delete account/ }).click();
    await page.getByRole("button", { name: /削除する|^Delete$/ }).click();

    // 削除後: GitHub 側連携解除の案内リンクが表示される（Done Criteria）
    await expect(
      page.getByRole("link", { name: /GitHub App の連携管理を開く|Manage GitHub App connection/ }),
    ).toBeVisible();

    // サーバー側でセッションが破棄されている（同一 Cookie での API 呼び出しが 401）
    const me = await page.request.get("/api/me");
    expect(me.status()).toBe(401);

    // 削除で端末内データが消える（`clearAllLocalUserData`・#101 / #181 の回帰防止）。
    // プライバシーポリシー §6 が名指しする対象がすべて消え、個人データでない UI 言語だけが残る。
    const stored = await page.evaluate(() => ({
      repos: localStorage.getItem("issue-shortcut:repos-cache"),
      shortcuts: localStorage.getItem("issue-shortcut:shortcuts-cache"),
      recentRepos: localStorage.getItem("issue-shortcut:recent-repos"),
      recentSubmissions: localStorage.getItem("issue-shortcut:recent-submissions"),
      draft: localStorage.getItem("issue-shortcut:draft"),
      offlineQueue: localStorage.getItem("issue-shortcut:offline-queue"),
      locale: localStorage.getItem("issue-shortcut:locale"),
    }));
    expect(stored.repos).toBeNull();
    expect(stored.shortcuts).toBeNull();
    expect(stored.recentRepos).toBeNull();
    expect(stored.recentSubmissions).toBeNull();
    // 未送信の下書き・キューは「アカウント削除」でのみ消える（ログアウトでは残す・#181）。
    expect(stored.draft).toBeNull();
    expect(stored.offlineQueue).toBeNull();
    // UI 言語は個人データではないため残す。
    expect(stored.locale).toBe("ja");

    // 削除後にハンバーガーを再度押しても、stale な認証情報（ログアウト・再削除・ユーザー名）が再表示されず、
    // 匿名扱い（ログイン導線）になる（correctness#2 の回帰防止）。
    await page.getByRole("button", { name: /メニューを開く|Open menu/ }).first().click();
    const drawer = page.getByRole("dialog", { name: /メニュー|Menu/ });
    await expect(drawer.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ })).toBeVisible();
    await expect(drawer.getByRole("button", { name: /ログアウト|Sign out/ })).toHaveCount(0);
  });
});
