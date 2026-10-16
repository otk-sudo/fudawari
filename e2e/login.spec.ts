import { expect, test } from "@playwright/test";

// ログインの画面（/login）を、JavaScript が動く前の状態（書き出した HTML のまま）で確かめる（PR-10b のレビュー対応・親の決定 1）
// - 「ログイン」ボタンは押せない（JavaScript が読み込まれる前に送ると、パスワードが URL に出たり、何も起きずに消えたりするため）
// - フォームは method="post"（万一送られても、パスワードを URL のクエリに載せない）
// - パスワードの欄で Enter を押しても送られない（押せないボタンしかないフォームは、暗黙の送信をしない）

test.describe("JavaScript が動く前のログインの画面", () => {
  test.use({ javaScriptEnabled: false });

  test("「ログイン」ボタンは押せず、フォームは method=\"post\"", async ({ page }) => {
    // 準備・実行
    await page.goto("/login");

    // 検証
    await expect(page.getByRole("button", { name: "ログイン", exact: true })).toBeDisabled();
    await expect(page.locator("form")).toHaveAttribute("method", /^post$/i);
  });

  test("パスワードの欄で Enter を押しても送られず、URL にパスワードが出ない", async ({ page }) => {
    // 準備
    await page.goto("/login");
    await page.getByLabel("ID", { exact: true }).fill("taro-01");
    await page.getByLabel("パスワード", { exact: true }).fill("secret-password-1");

    // 実行
    await page.getByLabel("パスワード", { exact: true }).press("Enter");

    // 検証：画面は移らず、URL にクエリが付かない
    await expect(page).toHaveURL(/\/login\/?$/);
    expect(page.url()).not.toContain("secret-password-1");
  });
});
