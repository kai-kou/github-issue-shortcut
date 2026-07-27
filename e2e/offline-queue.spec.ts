import { test, expect } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// オフラインキュー E2E（B4-2・FR-22・FR-23）。
// カバー範囲: ネットワーク到達不能時に起票がキューへ積まれてキュー件数が表示され、
// オンライン復帰後に自動でクライアント主導の再送が行われ GitHub へ反映されること。
// 4xx（サーバーエラー）はキュー自動再送の対象外として扱われる（failed のまま残り、成功表示にならない）。
// 再送経路はこのクライアント主導の 1 本のみ（Service Worker 側の Workbox Background Sync は
// 1 度も発火しておらず、有効化するとこの経路と二重起票しうるため #177 で撤去した）。
test.describe("オフラインキュー（モック GitHub・モバイルエミュレーション）", () => {
  test.beforeEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [{ id: 1, full_name: "kai-kou/alpha", private: false }],
          },
        ],
      },
    });
  });

  test.afterEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [] } });
  });

  test("オフライン時にキュー表示され、オンライン復帰後に自動送信されて GitHub に反映される", async ({ page, request }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("オフラインで起票");

    // ネットワーク到達不能を再現する（fetch がネットワークエラーとして失敗する）。
    await page.route("**/api/issues", (route) => route.abort());
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();

    await expect(page.getByText(/オフラインです|You're offline/)).toBeVisible();
    // キュー件数（1 件）が起票先選択画面に表示される。
    await expect(page.getByText(/送信待ちのオフラインキュー|Pending offline queue/)).toBeVisible();

    // reload してもキューが端末（localStorage）から復元され、件数表示が残る。
    await page.reload();
    await expect(page.getByText(/送信待ちのオフラインキュー|Pending offline queue/)).toBeVisible();

    // オンライン復帰: ルートを解除し、online イベントを発火してクライアント主導の再送を促す。
    await page.unroute("**/api/issues");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    // 再送が成功し GitHub へ反映されると、キュー表示が消える。
    await expect(page.getByText(/送信待ちのオフラインキュー|Pending offline queue/)).toHaveCount(0, { timeout: 10_000 });

    // 「重複せず 1 件だけ」を、キュー表示が消えたという間接証拠ではなくモック GitHub の
    // 作成件数で直接検証する（#148）。
    const created = await (await request.get(`${MOCK_GITHUB_URL}/mock/issue-count`)).json();
    expect(created).toEqual({ count: 1 });
  });

  test("online イベントが連続発火しても再送は 1 回だけ実行される（再入ガードの回帰）", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("二重再送しない");

    await page.route("**/api/issues", (route) => route.abort());
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/送信待ちのオフラインキュー|Pending offline queue/)).toBeVisible();

    // オンライン復帰の通知が短時間に連続で届いても（実機では電波の掴み直しで起こりうる）、
    // 再送処理の再入ガード（useOfflineQueueSync の flushingRef）により送信は 1 回だけになる。
    await page.unroute("**/api/issues");

    // 送信回数はブラウザが実際に投げた POST の数で数える。作成件数（/mock/issue-count）だけでは
    // 端末内の二重送信防止（submitGuard の 30 秒窓）が二重送信を吸収してしまい、
    // クライアントのガードが壊れても 1 件のままになる＝ガードの回帰を検出できないため。
    let issuePostCount = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/issues")) issuePostCount += 1;
    });

    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
    });

    await expect(page.getByText(/送信待ちのオフラインキュー|Pending offline queue/)).toHaveCount(0, {
      timeout: 10_000,
    });
    expect(issuePostCount, "online 二重発火でも起票 POST は 1 回だけ").toBe(1);
    const created = await (await request.get(`${MOCK_GITHUB_URL}/mock/issue-count`)).json();
    expect(created).toEqual({ count: 1 });
  });

  test("送信済みの client_request_id での再送はネットワークに出ない（端末内の冪等性キー・B4-4）", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("冪等性キーの検証");

    await page.route("**/api/issues", (route) => route.abort());
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/送信待ちのオフラインキュー|Pending offline queue/)).toBeVisible();

    // キューに積まれた client_request_id を控えておく（送信成功後はキューから消えるため）。
    const sentId = await page.evaluate(() => {
      const queue = JSON.parse(localStorage.getItem("issue-shortcut:offline-queue") ?? "[]") as { id: string }[];
      return queue[0]?.id ?? "";
    });
    expect(sentId).not.toBe("");

    await page.unroute("**/api/issues");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByText(/送信待ちのオフラインキュー|Pending offline queue/)).toHaveCount(0, {
      timeout: 10_000,
    });
    expect(await (await request.get(`${MOCK_GITHUB_URL}/mock/issue-count`)).json()).toEqual({ count: 1 });

    // 送信済みの id を持つエントリをキューへ戻す（別タブが既に送信した id がこのタブのキューに
    // 残っている状況の再現）。タイトルだけ変えるのは、内容ベースの 30 秒窓ではなく **id 側の
    // ガード**（IndexedDB・26 時間窓）が効いていることを分離して確かめるため。

    let issuePostCount = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/issues")) issuePostCount += 1;
    });

    await page.evaluate((id) => {
      localStorage.setItem(
        "issue-shortcut:offline-queue",
        JSON.stringify([
          {
            id,
            repo: "kai-kou/alpha",
            title: "冪等性キーの検証（再送）",
            body: "",
            labels: [],
            queuedAt: Date.now(),
            status: "pending",
          },
        ]),
      );
    }, sentId);
    await page.reload();

    // 予約済みの id なので送信されず、キューからは（送信済みとして）取り除かれる。
    await expect(page.getByText(/送信待ちのオフラインキュー|Pending offline queue/)).toHaveCount(0, {
      timeout: 10_000,
    });
    expect(issuePostCount, "送信済み id の再送は POST しない").toBe(0);
    expect(await (await request.get(`${MOCK_GITHUB_URL}/mock/issue-count`)).json()).toEqual({ count: 1 });
  });

  test("4xx はキュー自動再送の対象外として扱われる", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    // モック GitHub のマジック文字列（422）を使い、再送時にサーバーエラーになるケースを再現する。
    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("__mock_422__");

    await page.route("**/api/issues", (route) => route.abort());
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/オフラインです|You're offline/)).toBeVisible();

    // オンライン復帰。再送は行われるが 422 が返るため、自動再送は行われず失敗のままキューに残る
    // （手動での再送・破棄は D2-1・#22 のスコープ）。成功表示にはならず、失敗件数の表示に切り替わる。
    await page.unroute("**/api/issues");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByText(/送信に失敗した起票|Failed to send/)).toBeVisible();
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toHaveCount(0);

    // D2-1: failed 項目が一覧表示され、タイトルとエラー理由が確認できる（一覧は起票シート＝モーダルの
    // 背面にあるため、シートを閉じてから確認する）。
    await page.getByRole("button", { name: /閉じる|Close/ }).click();
    await expect(page.locator(".offline-queue-item-title").getByText("__mock_422__")).toBeVisible();
  });

  test("TTL 超過の pending は自動再送されず、期限切れとして手動確認へ回る（#91）", async ({ page, request }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    // モック GitHub のマジック文字列（422）を使い、後段で「手動再送が期限切れとは無関係な理由で
    // 失敗する」ケースまで検証できるようにする。
    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("__mock_422__");

    await page.route("**/api/issues", (route) => route.abort());
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/送信待ちのオフラインキュー|Pending offline queue/)).toBeVisible();

    // 端末に残ったキューの queuedAt を TTL（24h）超過へ書き換え、数日放置された状態を再現する。
    // 端末内の重複防止窓（26h・sentRequestIds）が切れた後に自動再送すると重複起票しうるため、この状態では
    // 自動再送を止めてユーザーの確認に委ねるのが期待挙動（#91）。
    await page.unroute("**/api/issues");
    await page.evaluate(() => {
      const key = "issue-shortcut:offline-queue";
      const queue = JSON.parse(localStorage.getItem(key) ?? "[]") as { queuedAt: number }[];
      for (const entry of queue) entry.queuedAt -= 25 * 60 * 60 * 1000;
      localStorage.setItem(key, JSON.stringify(queue));
    });

    let issuePostCount = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/issues")) issuePostCount += 1;
    });

    // 再読み込みでオンライン状態のまま自動再送（マウント時の flush）が走る条件を作る。
    await page.reload();

    // 期限切れとして failed 一覧に現れ、pending の件数表示は消える。
    await expect(page.getByText(/送信に失敗した起票|Failed to send/)).toBeVisible();
    await expect(page.getByText(/自動再送を停止しました|automatic resending stopped/)).toBeVisible();
    await expect(page.getByText(/送信待ちのオフラインキュー|Pending offline queue/)).toHaveCount(0);

    // 自動再送そのものが起きていないことを POST 数と作成件数の両方で確認する。
    expect(issuePostCount, "TTL 超過のキューは自動再送しない").toBe(0);
    const created = await (await request.get(`${MOCK_GITHUB_URL}/mock/issue-count`)).json();
    expect(created).toEqual({ count: 0 });

    // 手動での救済導線（D2-1）は残る。一覧は起票シート（モーダル）の背面にあるため、
    // シートを閉じてから操作する。
    await page.getByRole("button", { name: /閉じる|Close/ }).click();

    // 期限切れ項目の手動再送はワンタップで送らず確認を挟む（重複起票の可能性を明示する）。
    await page.getByRole("button", { name: /^再送$|^Resend$/ }).click();
    await expect(page.getByText(/重複して作成されます|will create a duplicate/)).toBeVisible();
    expect(issuePostCount, "確認前に再送 POST を投げない").toBe(0);
    await page.getByRole("button", { name: /^キャンセル$|^Cancel$/ }).click();
    await expect(page.getByText(/重複して作成されます|will create a duplicate/)).toHaveCount(0);
    expect(issuePostCount, "キャンセルでは再送しない").toBe(0);

    // 確認して再送すると送信されるが、この内容は 422 が返るためキューに残る。このとき errorCode は
    // validation_failed に上書きされる。期限切れの記録（expired フラグ）が errorCode と独立に
    // 保持されていないと、2 回目以降の再送が確認なしのワンタップに戻ってしまう（Layer 2 レビュー指摘）。
    await page.getByRole("button", { name: /^再送$|^Resend$/ }).click();
    await page.getByRole("button", { name: /^再送する$|^Resend anyway$/ }).click();
    await expect.poll(() => issuePostCount).toBe(1);
    await expect(page.getByText(/送信に失敗した起票|Failed to send/)).toBeVisible();

    // 回帰ガード: 期限切れ以外の理由で失敗した後も、再送には必ず確認が挟まる。
    await page.getByRole("button", { name: /^再送$|^Resend$/ }).click();
    await expect(page.getByText(/重複して作成されます|will create a duplicate/)).toBeVisible();
    expect(issuePostCount, "確認前に再送 POST を投げない（2 回目）").toBe(1);
    await page.getByRole("button", { name: /^キャンセル$|^Cancel$/ }).click();

    // 破棄でキューから消える。
    await page.getByRole("button", { name: /^破棄$|^Discard$/ }).click();
    await page.getByRole("button", { name: /^破棄する$|^Yes, discard$/ }).click();
    await expect(page.getByText(/送信に失敗した起票|Failed to send/)).toHaveCount(0);
  });

  test("D2-1: failed 項目を手動で再送・破棄できる", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    await page.getByRole("textbox", { name: /タイトル|^Title$/ }).fill("__mock_422__");

    await page.route("**/api/issues", (route) => route.abort());
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/オフラインです|You're offline/)).toBeVisible();

    await page.unroute("**/api/issues");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByText(/送信に失敗した起票|Failed to send/)).toBeVisible();
    // 起票シート（モーダル）が一覧の手前に被さっているため、閉じてから操作する。
    await page.getByRole("button", { name: /閉じる|Close/ }).click();

    // 手動再送: サーバーには依然 422 を返すマジック文字列のままなので、再送してもキューに残る
    // （手動再送のリクエストが実際に送られること自体を検証する）。
    let resendRequestSeen = false;
    await page.route("**/api/issues", async (route) => {
      resendRequestSeen = true;
      await route.continue();
    });
    await page.getByRole("button", { name: /^再送$|^Resend$/ }).click();
    await expect.poll(() => resendRequestSeen).toBe(true);
    await expect(page.getByText(/送信に失敗した起票|Failed to send/)).toBeVisible();
    await page.unroute("**/api/issues");

    // 破棄: 確認 → 実行でキューから消え、失敗件数の表示も消える。
    await page.getByRole("button", { name: /^破棄$|^Discard$/ }).click();
    await page.getByRole("button", { name: /^破棄する$|^Yes, discard$/ }).click();
    await expect(page.getByText(/送信に失敗した起票|Failed to send/)).toHaveCount(0);
    await expect(page.locator(".offline-queue-item-title").getByText("__mock_422__")).toHaveCount(0);
  });
});
