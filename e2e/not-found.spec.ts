import { expect, test } from "@playwright/test";

// 存在しない URL の画面（PR-14：T4-2 の点検の M2）の先に書いたテスト（TDD の Red）。直し方は親が決めた。
// - 静的書き出しの 404 の画面（src/app/not-found.tsx を新しく作る想定）を日本語にする：
//   見出し（h1）「ページが見つかりません」と、ホーム（/）へのリンク（名前に「ホーム」を含む）を本文（main）に出す
// - Next.js の既定の英語の「This page could not be found」は出さない
// 左メニュー（共通の枠）にも「ホームへ」のリンクがあるので、ホームへのリンクは本文（main）の中で探す

/** 存在しないパス（日本語を含む。ブラウザは符号化して送る） */
const MISSING_PATH = "/存在しないパス";

test.describe("存在しない URL の画面", () => {
  test("日本語で「ページが見つかりません」とホームへのリンクを出し、英語の既定の文は出さない", async ({ page }) => {
    // 準備・実行
    await page.goto(MISSING_PATH);

    // 検証
    await expect(page.getByRole("heading", { level: 1, name: "ページが見つかりません" })).toBeVisible();
    const homeLink = page.getByRole("main").getByRole("link", { name: /ホーム/ });
    await expect(homeLink).toBeVisible();
    await expect(homeLink).toHaveAttribute("href", "/");
    await expect(page.getByText("This page could not be found")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  });

  test("ホームへのリンクを押すとホーム（見出し「札割りプランナー」）へ移る", async ({ page }) => {
    // 準備
    await page.goto(MISSING_PATH);

    // 実行
    await page.getByRole("main").getByRole("link", { name: /ホーム/ }).click();

    // 検証
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "札割りプランナー", exact: true })).toBeVisible();
  });
});
