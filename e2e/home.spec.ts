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
});
