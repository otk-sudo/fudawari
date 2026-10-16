import { expect, type Locator, type Page, test } from "@playwright/test";

// 共通の枠（左メニュー・設定のウィンドウ）と、各画面のルートの入れ物を確かめる（PR-03）

function sideNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "メインメニュー" });
}

function navLink(page: Page, name: string): Locator {
  return sideNav(page).getByRole("link", { name, exact: true });
}

function settingsDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "設定" });
}

// 右上の「×」と下の「閉じる」は、どちらも名前が「閉じる」のボタン（モックどおり）。文字で見分ける
function crossButton(dialog: Locator): Locator {
  return dialog.getByRole("button", { name: "閉じる" }).filter({ hasText: "×" });
}

function footerCloseButton(dialog: Locator): Locator {
  return dialog
    .getByRole("button", { name: "閉じる" })
    .filter({ hasText: "閉じる" });
}

// 各画面の見出しはモック（docs/design/mock）の h1 に合わせる
const SCREENS = [
  { path: "/list", heading: "札割り一覧" },
  { path: "/assign", heading: "割り振り" },
  { path: "/import", heading: "艦娘の取り込み" },
  { path: "/drift", heading: "計画と実際の札" },
  { path: "/definition", heading: "イベント定義" },
  { path: "/collaborators", heading: "協力者" },
] as const;

test.describe("左メニューでの移動", () => {
  test("ホームから一覧・割り振り・取り込み・差分へ移動でき、「札」でホームへ戻れる", async ({
    page,
  }) => {
    // 準備
    await page.goto("/");
    await expect(sideNav(page)).toBeVisible();

    // 実行・検証：一般の画面を順に開く
    const steps = [
      { label: "一覧", path: "/list", heading: "札割り一覧" },
      { label: "割振", path: "/assign", heading: "割り振り" },
      { label: "取込", path: "/import", heading: "艦娘の取り込み" },
      { label: "差分", path: "/drift", heading: "計画と実際の札" },
    ];
    for (const { label, path, heading } of steps) {
      await test.step(`「${label}」で ${path} へ移動する`, async () => {
        await navLink(page, label).click();

        await expect(page).toHaveURL(path);
        await expect(
          page.getByRole("heading", { level: 1, name: heading, exact: true }),
        ).toBeVisible();
        await expect(navLink(page, label)).toHaveAttribute(
          "aria-current",
          "page",
        );
      });
    }

    // 実行・検証：「札」でホームへ戻る
    await test.step("「札」でホームへ戻る", async () => {
      await navLink(page, "ホームへ").click();

      await expect(page).toHaveURL("/");
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "札割りプランナー",
          exact: true,
        }),
      ).toBeVisible();
      await expect(navLink(page, "ホームへ")).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
  });
});

test.describe("各画面のルートの入れ物", () => {
  for (const { path, heading } of SCREENS) {
    test(`${path} を直接開くと、見出し「${heading}」と左メニューが出る`, async ({
      page,
    }) => {
      // 準備・実行
      const response = await page.goto(path);

      // 検証
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole("heading", { level: 1, name: heading, exact: true }),
      ).toBeVisible();
      await expect(sideNav(page)).toBeVisible();
    });
  }

  for (const path of ["/login", "/invite"]) {
    test(`${path} を直接開くと、画面（見出し）が出る`, async ({ page }) => {
      // 準備・実行
      const response = await page.goto(path);

      // 検証：見出しの文言はまだ決めていないため、ページがあることと見出しが 1 つあることだけを見る
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    });
  }
});

test.describe("設定のウィンドウ", () => {
  test("左メニューの「設定」で画面を移動せずに開き、「×」で閉じる", async ({
    page,
  }) => {
    // 準備
    await page.goto("/list");

    // 実行：開く
    await sideNav(page).getByRole("button", { name: "設定", exact: true }).click();

    // 検証：開いている。画面は移動していない
    const dialog = settingsDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(
      dialog.getByText("表示などの設定はこのブラウザに保存されます"),
    ).toBeVisible();
    await expect(page).toHaveURL("/list");

    // 実行・検証：「×」で閉じる
    await crossButton(dialog).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL("/list");
  });

  test("ホームの「設定」タイルで開き、下の「閉じる」で閉じる", async ({
    page,
  }) => {
    // 準備
    await page.goto("/");

    // 実行：開く（左メニューの「設定」ではなく、説明つきのタイルを押す）
    await page
      .getByRole("button", { name: "設定" })
      .filter({ hasText: "画面モードや文字の大きさなど" })
      .click();

    // 検証
    const dialog = settingsDialog(page);
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL("/");

    // 実行・検証：「閉じる」で閉じる
    await footerCloseButton(dialog).click();
    await expect(dialog).toBeHidden();
  });

  test("開いている間は後ろの左メニューを押せず、背景をクリックすると閉じる（画面は移動しない）", async ({
    page,
  }) => {
    // 準備：後ろにある「割振」の位置を覚えてから開く
    await page.goto("/");
    const assignBox = await navLink(page, "割振").boundingBox();
    if (!assignBox) {
      throw new Error("左メニューの「割振」の位置が取れない");
    }
    await sideNav(page).getByRole("button", { name: "設定", exact: true }).click();
    const dialog = settingsDialog(page);
    await expect(dialog).toBeVisible();

    // 実行：ウィンドウの外（背景の暗い部分の下に「割振」がある位置）をクリックする
    await page.mouse.click(
      assignBox.x + assignBox.width / 2,
      assignBox.y + assignBox.height / 2,
    );

    // 検証：ウィンドウは閉じ、「割振」へは移動していない
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL("/");
  });
});

test.describe("一般利用者の左メニュー（既定の権限）", () => {
  test("ログインしていなければ「管理」の区切り・「定義」・「協力者」を出さない", async ({
    page,
  }) => {
    // 準備・実行
    await page.goto("/");

    // 検証：左メニューが出ていることを確かめてから、管理の項目がないことを見る
    await expect(navLink(page, "一覧")).toBeVisible();
    await expect(navLink(page, "定義")).toHaveCount(0);
    await expect(navLink(page, "協力者")).toHaveCount(0);
    await expect(sideNav(page).getByText("管理", { exact: true })).toHaveCount(0);
  });

  test("ホームにも「管理」の区分を出さない", async ({ page }) => {
    // 準備・実行
    await page.goto("/");

    // 検証：「札割り」の区分が出ていることを確かめてから、「管理」がないことを見る
    await expect(page.getByRole("heading", { name: "札割り", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^管理/ })).toHaveCount(0);
  });
});
