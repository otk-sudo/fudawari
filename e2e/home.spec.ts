import { expect, test } from "@playwright/test";

test.describe("トップ画面", () => {
  test("見出し「札割りプランナー」が見える", async ({ page }) => {
    // 準備・実行
    await page.goto("/");

    // 検証（name は既定では部分一致のため、単体テストとそろえて完全一致で探す）
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "札割りプランナー",
        exact: true,
      }),
    ).toBeVisible();
  });

  test("html 要素の lang が ja である", async ({ page }) => {
    // 準備・実行
    await page.goto("/");

    // 検証
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  });

  // PR-14（favicon）：アイコン（「札」の 1 文字。src/app/icon.svg などを置く想定）を出す。
  // ファイル名・形式には依存しない：HTML の <link rel="icon">（rel に icon を含むもの）があり、その href を取得すると画像が返ることを確かめる
  test("HTML にアイコン（rel に icon を含む link）があり、その href から画像を取得できる", async ({ page, request }) => {
    // 準備・実行
    await page.goto("/");

    // 検証：link があり、href が空でない
    const iconLink = page.locator('head link[rel~="icon"]').first();
    await expect(iconLink).toHaveCount(1);
    const href = await iconLink.getAttribute("href");
    expect(href, "アイコンの link の href").toBeTruthy();

    // 検証：取得すると 200 で、画像（image/…）が返る
    const response = await request.get(new URL(href ?? "", page.url()).toString());
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"] ?? "").toMatch(/^image\//);
    expect((await response.body()).byteLength).toBeGreaterThan(0);
  });
});
