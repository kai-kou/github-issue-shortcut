import { test, expect } from "@playwright/test";

const MOCK_GITHUB_URL = "http://localhost:8788";

// C1-1/C2-2 ショートカット作成ヘルパーの E2E（モック GitHub・モバイルエミュレーション）。
// カバー範囲: 未ログイン時のログイン誘導、ログイン後のプリセット作成・URL 生成・一覧表示・
// 編集・削除（端末内保存の CRUD が /shortcuts 画面から一通り動くこと・P1 で localStorage 正本へ移行）。
test.describe("ショートカット作成ヘルパー（モック GitHub・モバイルエミュレーション）", () => {
  test.beforeEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, {
      data: {
        installations: [
          {
            id: 1001,
            repos: [{ id: 1, full_name: "kai-kou/alpha", private: false, permissions: { push: true } }],
          },
        ],
        // ショートカットのラベルは Issue フォームと同じ LabelPicker（チェックボックス）で選ぶため、
        // 候補となる repo のラベル一覧をモックに用意する。
        labels: [
          { name: "bug", color: "d73a4a" },
          { name: "P1", color: "0e8a16" },
          { name: "enhancement", color: "a2eeef" },
        ],
      },
    });
  });

  test.afterEach(async ({ request }) => {
    await request.post(`${MOCK_GITHUB_URL}/mock/config`, { data: { installations: [] } });
  });

  test("未ログイン時はログイン誘導のみが表示される", async ({ page }) => {
    await page.goto("/shortcuts");
    await expect(page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /保存|Save/ })).toHaveCount(0);
  });

  // #128: 「リポジトリ未選択 → 案内文」「選択 → LabelPicker」の切り替え分岐を独立に固める。
  // CRUD テストは選択後の checkbox 操作しか通らないため、案内文の消失・トグルの出現・
  // 未選択へ戻したときの復帰が壊れても検出できなかった。
  test("リポジトリ未選択のときは案内文のみが表示され、選択で LabelPicker へ切り替わる", async ({ page }) => {
    const guide = page.getByText(/リポジトリを選択するとラベルを選べます|Select a repository to choose labels/);
    const labelPickerToggle = page.getByText(/ラベルを追加|Add labels/);

    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.goto("/shortcuts");
    await expect(page.getByRole("button", { name: /^保存$|^Save$/ })).toBeVisible();

    // 未選択: ラベルはリポジトリが決まらないと取得できないため、案内文だけを出す。
    await expect(guide).toBeVisible();
    await expect(labelPickerToggle).toHaveCount(0);

    const repoSelect = page.getByLabel(/リポジトリ（任意）|Repository \(optional\)/);
    await repoSelect.selectOption("kai-kou/alpha");
    await expect(labelPickerToggle).toBeVisible();
    await expect(guide).toHaveCount(0);

    // 未選択へ戻すと案内文に戻る（切り替えが片方向にならないことの回帰ガード）。
    await repoSelect.selectOption("");
    await expect(guide).toBeVisible();
    await expect(labelPickerToggle).toHaveCount(0);
  });

  test("ログイン後にプリセットを作成すると起動 URL 付きで一覧に表示され、編集・削除できる", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.goto("/shortcuts");
    await page.getByLabel(/リポジトリ（任意）|Repository \(optional\)/).selectOption("kai-kou/alpha");
    // リポジトリを選ぶと、Issue フォームと同じチェックボックス UI（LabelPicker）でラベルを選べる。
    await page.getByText(/ラベルを追加|Add labels/).click();
    await page.getByRole("checkbox", { name: "bug" }).check();
    await page.getByRole("checkbox", { name: "P1" }).check();
    await page.getByPlaceholder(/バグ報告|Bug report/).fill("バグ報告: ");
    await page.getByRole("button", { name: /^保存$|^Save$/ }).click();

    const generatedUrl = page.locator('.shortcut-row input[type="text"]');
    await expect(generatedUrl).toHaveValue(/\/new\?repo=kai-kou%2Falpha&labels=bug%2CP1&title=/);

    // 編集: ラベル選択を変更すると URL に反映される（既存ラベルがあるので LabelPicker は展開済み）。
    await page.getByRole("button", { name: /編集|Edit/ }).click();
    await page.getByRole("checkbox", { name: "bug" }).uncheck();
    await page.getByRole("checkbox", { name: "P1" }).uncheck();
    await page.getByRole("checkbox", { name: "enhancement" }).check();
    await page.getByRole("button", { name: /^保存$|^Save$/ }).click();
    await expect(generatedUrl).toHaveValue(/labels=enhancement/);

    // 削除: 確認 → 一覧から消える
    await page.getByRole("button", { name: /削除|Delete/ }).click();
    await page.getByRole("button", { name: /削除|Delete/ }).click();
    await expect(page.getByText(/まだショートカットがありません|No shortcuts yet/)).toBeVisible();
  });

  test("新規作成後はフォームがクリアされ、連打しても重複作成されない", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.goto("/shortcuts");
    const titleInput = page.getByPlaceholder(/バグ報告|Bug report/);
    await titleInput.fill("バグ報告: ");
    await page.getByRole("button", { name: /^保存$|^Save$/ }).click();

    await expect(page.locator(".shortcut-row")).toHaveCount(1);
    await expect(titleInput).toHaveValue("");

    // フォームが空のままなら保存はバリデーションエラーになり、誤って2件目が作られない。
    await page.getByRole("button", { name: /^保存$|^Save$/ }).click();
    await expect(page.getByText(/リポジトリ・ラベル・タイトルのいずれかを入力してください|Enter at least one of/)).toBeVisible();
    await expect(page.locator(".shortcut-row")).toHaveCount(1);

    // 後続テスト（および同一 e2e-user を使う他 spec）に汚染された端末内（localStorage）状態を残さない。
    await page.getByRole("button", { name: /削除|Delete/ }).click();
    await page.getByRole("button", { name: /削除|Delete/ }).click();
    await expect(page.getByText(/まだショートカットがありません|No shortcuts yet/)).toBeVisible();
  });

  test("リポジトリなしプリセットはアプリ内起動を引き受けず /new へのリンク遷移にフォールバックする（#135）", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    // リポジトリ未選択（タイトル雛形のみ）のプリセットを作る。起票先が決まらないため
    // アプリ内で起票シートを開けず、RepoPicker.openWithPreset は false を返す経路になる。
    await page.goto("/shortcuts");
    await page.getByPlaceholder(/バグ報告|Bug report/).fill("メモ: ");
    await page.getByRole("button", { name: /^保存$|^Save$/ }).click();
    await expect(page.locator(".shortcut-row")).toHaveCount(1);

    await page.goto("/");
    await page.locator(".shortcut-quicklist-item").first().click();

    // フォールバック: `<a href>` の通常遷移で /new?title=... が開き、雛形が適用される。
    await expect(page).toHaveURL(/\/new\?title=/);
    await page.getByRole("button", { name: "kai-kou/alpha" }).click();
    await expect(page.getByRole("textbox", { name: /タイトル|^Title$/ })).toHaveValue("メモ:");

    // 後続テスト（同一 e2e-user を使う他 spec）に端末内（localStorage）状態を残さない。
    await page.goto("/shortcuts");
    await page.getByRole("button", { name: /削除|Delete/ }).click();
    await page.getByRole("button", { name: /削除|Delete/ }).click();
    await expect(page.getByText(/まだショートカットがありません|No shortcuts yet/)).toBeVisible();
  });

  test("編集中の対象を削除すると、保存しても重複作成されずフォームがリセットされる", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /GitHub でログイン|Sign in with GitHub/ }).click();
    await expect(page.getByText(/e2e-user/)).toBeVisible();

    await page.goto("/shortcuts");
    const titleInput = page.getByPlaceholder(/バグ報告|Bug report/);
    await titleInput.fill("バグ報告: ");
    await page.getByRole("button", { name: /^保存$|^Save$/ }).click();
    await expect(page.locator(".shortcut-row")).toHaveCount(1);

    // 編集モードに入った状態で、その対象自身を削除する（保存時に title は trim される）。
    await page.getByRole("button", { name: /編集|Edit/ }).click();
    await expect(titleInput).toHaveValue("バグ報告:");
    await page.getByRole("button", { name: /削除|Delete/ }).click();
    await page.getByRole("button", { name: /削除|Delete/ }).click();
    await expect(page.getByText(/まだショートカットがありません|No shortcuts yet/)).toBeVisible();

    // フォームは「新規作成」にリセットされ、古い入力値が残らない（残っていると次の保存で
    // 削除したはずのショートカットが意図せず再作成されてしまう）。
    await expect(titleInput).toHaveValue("");
    await expect(page.getByRole("button", { name: /^キャンセル$|^Cancel$/ })).toHaveCount(0);
  });
});
