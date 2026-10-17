import { expect, type Page, test } from "@playwright/test";
import { isSupabaseUrl } from "../src/test/supabase-request-e2e";

// 一般の画面は Supabase に通信しない（CLAUDE.md、roadmap T3-4 の受入条件）
// ログインしていない状態で一般の画面を開き、左メニューで移り、設定を開いても、Supabase の API への通信（HTTP・WebSocket）がないことを確かめる。
// 「Supabase への通信」の判定は src/test/supabase-request-e2e.ts（e2e/permissions.spec.ts と共通）

/** ページが出した通信（HTTP と WebSocket）の URL を記録し始める */
function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  page.on("websocket", (socket) => urls.push(socket.url()));
  return urls;
}

// 各画面の見出しはモック（docs/design/mock）の h1 に合わせる。/collaborators は一般利用者には拒否の表示になる
const GENERAL_SCREENS = [
  { path: "/", heading: "札割りプランナー" },
  { path: "/list", heading: "札割り一覧" },
  { path: "/assign", heading: "割り振り" },
  { path: "/import", heading: "艦娘の取り込み" },
  { path: "/drift", heading: "計画と実際の札" },
  { path: "/collaborators", heading: "協力者" },
] as const;

test.describe("一般の画面は Supabase に通信しない（ログインしていない状態）", () => {
  for (const { path, heading } of GENERAL_SCREENS) {
    test(`${path} を開いても、Supabase への通信がない`, async ({ page }) => {
      // 準備
      const urls = recordRequests(page);

      // 実行
      await page.goto(path);
      await expect(
        page.getByRole("heading", { level: 1, name: heading, exact: true }),
      ).toBeVisible();
      await page.waitForLoadState("networkidle");

      // 検証
      expect(urls.filter(isSupabaseUrl)).toEqual([]);
    });
  }

  test("ホームから左メニューで一般の画面を順に移り、設定を開いても、Supabase への通信がない", async ({
    page,
  }) => {
    // 準備
    const urls = recordRequests(page);
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "メインメニュー" });
    await expect(nav).toBeVisible();

    // 実行：一覧・割振・取込・差分へ移り、設定を開いて閉じる
    for (const { label, heading } of [
      { label: "一覧", heading: "札割り一覧" },
      { label: "割振", heading: "割り振り" },
      { label: "取込", heading: "艦娘の取り込み" },
      { label: "差分", heading: "計画と実際の札" },
    ]) {
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(
        page.getByRole("heading", { level: 1, name: heading, exact: true }),
      ).toBeVisible();
    }
    await nav.getByRole("button", { name: "設定", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "設定" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "閉じる" }).filter({ hasText: "閉じる" }).click();
    await expect(dialog).toBeHidden();
    await page.waitForLoadState("networkidle");

    // 検証
    expect(urls.filter(isSupabaseUrl)).toEqual([]);
  });
});
