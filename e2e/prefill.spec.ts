import { test, expect } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// B1-2 の URL パラメータ起動 E2E（モック GitHub・モバイルエミュレーション）。
// カバー範囲: `/new?repo=&labels=&title=` で開くとリポジトリ/ラベル/タイトルが初期選択済みで
// 表示され、自動送信されないこと（FR-19）。および未ログイン時にログイン → コールバック復帰後も
// 同じプレフィルが復元されること（FR-15「未ログイン時はログイン後に復元」）。
test.describe("URL パラメータ起動（モック GitHub・モバイルエミュレーション）", () => {
  test.beforeEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [
              { id: 1, full_name: "kai-kou/alpha", private: false, permissions: { push: true } },
              { id: 2, full_name: "kai-kou/beta", private: false, permissions: { push: true } },
            ],
          },
        ],
        labels: [
          { name: "bug", color: "d73a4a" },
          { name: "enhancement", color: "a2eeef" },
        ],
      },
    });
  });

  test.afterEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [], labels: [] } });
  });

  test("ログイン済みで開くと各項目が初期選択済みで表示され、送信操作をするまで自動送信されない", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.goto(
      "/new?repo=kai-kou%2Falpha&labels=bug&title=%E3%83%97%E3%83%AC%E3%83%95%E3%82%A3%E3%83%AB%E8%B5%B7%E7%A5%A8",
    );

    // リポジトリが初期選択済み → フォームが表示される
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("プレフィル起票");

    // ラベルは事前指定があると展開済みで表示され、チェック済みになっている
    const bugCheckbox = page.getByRole("checkbox", { name: "bug" });
    await expect(bugCheckbox).toBeVisible();
    await expect(bugCheckbox).toBeChecked();

    // 自動送信はされない（ユーザーの送信操作が必須・FR-19）
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toHaveCount(0);

    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();

    const lastIssue = await (await page.request.get(`${MOCK_GITHUB_URL}/mock/last-issue`)).json();
    expect(lastIssue.title).toBe("プレフィル起票");
    expect(lastIssue.labels).toEqual(["bug"]);
  });

  test("未ログインで開いてログインすると、コールバック復帰後も同じプレフィルが復元される", async ({ page }) => {
    await page.goto(
      "/new?repo=kai-kou%2Falpha&title=%E6%9C%AA%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3%E3%83%97%E3%83%AC%E3%83%95%E3%82%A3%E3%83%AB",
    );
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();

    await expect(page.getByText(/e2e-user/)).toBeVisible();
    await expect(page).toHaveURL(/\/new\?/);
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("未ログインプレフィル");
  });

  test("プレフィル後に別リポジトリへ手動で切り替えると、プレフィルは引き継がれない", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.goto(
      "/new?repo=kai-kou%2Falpha&labels=bug&title=%E3%83%97%E3%83%AC%E3%83%95%E3%82%A3%E3%83%AB%E8%B5%B7%E7%A5%A8",
    );
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("プレフィル起票");

    // プレフィル対象外の別リポジトリへ手動で切り替える（ボトムシートを閉じてから選び直す・B1-3）
    await page.getByRole("button", { name: /閉じる|Close/ }).click();
    await page.getByRole("button", { name: "kai-kou/beta" }).click();

    // 切り替え後のフォームはプレフィルを引き継がず空のまま
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("");
    await page.getByText(/ラベルを追加|Add labels/).click();
    await expect(page.getByRole("checkbox", { name: "bug" })).not.toBeChecked();
  });

  test("URL のラベルがリポジトリに実在しない場合、送信内容から自動的に除外される", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.goto(
      "/new?repo=kai-kou%2Falpha&labels=not-a-real-label&title=%E5%AD%98%E5%9C%A8%E3%81%97%E3%81%AA%E3%81%84%E3%83%A9%E3%83%99%E3%83%AB",
    );
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("存在しないラベル");

    // 実在しないラベル名はラベル一覧取得後に自動的に選択解除され、送信リクエストに含まれない
    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();

    // labels が空になったリクエストは labels フィールド自体を省略する（worker/github.ts createIssue）。
    const lastIssue = await (await page.request.get(`${MOCK_GITHUB_URL}/mock/last-issue`)).json();
    expect(lastIssue.labels).toBeUndefined();
  });

  // B3-4: Web Share Target は manifest の params マッピング（vite.config.ts）で
  // /new?title=&body=&url= へのブラウザ GET 遷移を発生させる（共有シート自体は Playwright から
  // 起動できないため、実機の共有操作が生成するのと同じ URL への遷移で検証する）。
  test("Web Share Target 経由（title/body/url）で開くと本文にプレフィルされ、リポジトリ選択後も引き継がれる", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.goto(
      "/new?title=%E3%82%B7%E3%82%A7%E3%82%A2%E3%81%97%E3%81%9F%E8%A8%98%E4%BA%8B&body=%E8%A6%8B%E3%81%A6%EF%BC%9A+https%3A%2F%2Fexample.com%2Fpost&url=https%3A%2F%2Fexample.com%2Fpost",
    );

    // repo が無いプレフィルなのでリポジトリ未選択（フォーム自体は repo 選択後に表示される）
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "kai-kou/alpha" }).click();

    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("シェアした記事");
    // body に既に url が含まれているため重複追記されない
    await expect(page.getByRole("textbox", { name: /本文|Body/ })).toHaveValue("見て： https://example.com/post");

    await page.getByRole("button", { name: /Issue を作成|Create issue/ }).click();
    await expect(page.getByText(/Issue を作成しました|Issue created/)).toBeVisible();

    const lastIssue = await (await page.request.get(`${MOCK_GITHUB_URL}/mock/last-issue`)).json();
    expect(lastIssue.title).toBe("シェアした記事");
    expect(lastIssue.body).toBe("見て： https://example.com/post");
  });

  // #98: WebAPK が既存アプリを start_url（"/"）で再利用起動すると、ホーム画面に手動追加した
  // `/new?...` ショートカットのクエリが location から失われる（実機の WebAPK 起動自体は Playwright
  // から再現できないため、Launch Handler API の window.launchQueue.setConsumer に実際の起動 URL が
  // 渡されるのと同じ形で consumer を直接呼び出し、ログイン済みでも prefill が復元されることを検証する）。
  // Chromium は window.launchQueue をネイティブ実装済みの読み取り専用プロパティとして提供するため、
  // 単純な代入では上書きできず Object.defineProperty で強制的に差し替える。
  test("ログイン済みで launchQueue 経由の起動 URL（WebAPK 再利用起動を模擬）でも prefill が復元される", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "launchQueue", {
        configurable: true,
        value: {
          setConsumer(consumer: (launchParams: { targetURL: string }) => void) {
            (window as unknown as { __launchConsumer: typeof consumer }).__launchConsumer = consumer;
          },
        },
      });
    });

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    // WebAPK 再利用起動で location は "/" のまま、実際の起動 URL は launchParams.targetURL でのみ届く。
    await page.evaluate(() => {
      const w = window as unknown as { __launchConsumer: (p: { targetURL: string }) => void };
      w.__launchConsumer({
        targetURL: `${window.location.origin}/new?repo=kai-kou%2Falpha&labels=bug&title=%E5%86%8D%E5%88%A9%E7%94%A8%E8%B5%B7%E7%A5%A8`,
      });
    });

    await expect(page).toHaveURL(/\/new\?/);
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("再利用起票");
    const bugCheckbox = page.getByRole("checkbox", { name: "bug" });
    await expect(bugCheckbox).toBeChecked();
  });

  // #98 セルフレビュー指摘: `navigate-existing` は同一インスタンスを繰り返し再利用するため、
  // 既に別リポジトリを選択済みの状態から更に別のショートカットで再起動されても、新しい
  // prefill.repo に切り替わる必要がある（「未選択のときだけ適用」だと2回目以降を無視してしまう）。
  test("launchQueue 経由の再利用起動が2回続くと、選択済みリポジトリがあっても新しい起動の repo に切り替わる", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "launchQueue", {
        configurable: true,
        value: {
          setConsumer(consumer: (launchParams: { targetURL: string }) => void) {
            (window as unknown as { __launchConsumer: typeof consumer }).__launchConsumer = consumer;
          },
        },
      });
    });

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.evaluate(() => {
      const w = window as unknown as { __launchConsumer: (p: { targetURL: string }) => void };
      w.__launchConsumer({ targetURL: `${window.location.origin}/new?repo=kai-kou%2Falpha&title=1%E5%9B%9E%E7%9B%AE` });
    });
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("1回目");

    // アプリを閉じずに（同一インスタンスのまま）別のショートカットから再度起動される。
    await page.evaluate(() => {
      const w = window as unknown as { __launchConsumer: (p: { targetURL: string }) => void };
      w.__launchConsumer({ targetURL: `${window.location.origin}/new?repo=kai-kou%2Fbeta&title=2%E5%9B%9E%E7%9B%AE` });
    });
    await expect(page.getByRole("button", { name: "kai-kou/beta" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "kai-kou/alpha" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("2回目");
  });
});
