import { expect, type Page, test } from "@playwright/test";
import { ADMIN, configuredSupabaseUrl, FakeSupabase, NOW, signInAs } from "../src/test/permissions-e2e";

// イベント定義の画面を 1366×768 で使ったときの、段階の詳細と貼り付けの欄の見え方（UI／UX の指摘 中11。親が決めた直し方・ユーザーの承認済み）
//
// 指摘：1366×768 では上部のイベント情報の欄が約 270px あり、段階の詳細が画面の外。
//       「攻略サイトの艦名リストを貼り付け」を押しても開いた欄が画面外。
// 直し方：段階を選んだら段階の詳細へ、貼り付けの欄を開いたらその欄へスクロールし、貼り付けの欄ではフォーカスを移す
// （イベント情報の欄の折りたたみは単体テスト PlanEditor.event-panel-layout.test.tsx で確かめる）
//
// 管理者でログインした状態を、src/test/permissions-e2e.ts の signInAs・FakeSupabase で再現する（e2e/permissions.spec.ts と同じ）。
// ビルドのときの接続先（NEXT_PUBLIC_SUPABASE_URL・NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY の両方）が要る。
// 手元でどちらかがないまま実行したときは飛ばす（CI では飛ばさず失敗させる）

const SUPABASE_URL = configuredSupabaseUrl();
const MISSING_SUPABASE_URL =
  "NEXT_PUBLIC_SUPABASE_URL・NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY の両方を入れてビルド・実行してください（例 https://example.supabase.co と sb_publishable_dummy）";

/** 指摘で使った画面の大きさ */
const VIEWPORT = { width: 1366, height: 768 } as const;

/** 選ぶ段階（いちばん下の海域 E3 の、いちばん右の段階） */
const AREA = "E3";
const STAGE = "ゲージ4";

/** 時刻を固定し、偽物の Supabase を取り付け、管理者でログイン済みにして定義画面を開く */
async function openDefinitionAsAdmin(page: Page): Promise<FakeSupabase> {
  if (SUPABASE_URL === null) throw new Error(`Supabase の接続先がありません。${MISSING_SUPABASE_URL}`);
  await page.setViewportSize(VIEWPORT);
  await page.clock.setFixedTime(NOW);
  const fake = new FakeSupabase(SUPABASE_URL, ADMIN, { summerEndsAt: null });
  await fake.install(page);
  await signInAs(page, ADMIN, SUPABASE_URL);
  await page.goto("/definition");
  await expect(page.getByText(`ログイン中：${ADMIN.displayName}（管理者）`)).toBeVisible();
  return fake;
}

/** 攻略の流れの段階のボタンを押して選ぶ */
async function selectStage(page: Page, area: string, stage: string): Promise<void> {
  const row = page.getByRole("group", { name: area, exact: true });
  const button = row.locator("button[aria-pressed]").filter({ hasText: stage });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

test.describe("イベント定義の画面の 1366×768 での見え方（UI／UX の指摘 中11）", () => {
  test.beforeEach(() => {
    test.skip(SUPABASE_URL === null && !process.env.CI, `協力者・管理者の画面は確かめられません。${MISSING_SUPABASE_URL}`);
  });

  // 今（ed90ef3）の 1366×768 では、見出し（上端 約 600px）は画面の中にあるが、最初の特効グループ（上端 約 830px）は画面の外。
  // 見出しだけでは直す前から通ってしまうため、段階の詳細の中身（最初の特効グループ）も画面の中に見えることを確かめる
  test("段階（E3 ゲージ4）を選ぶと、段階の詳細の見出し「E3 ゲージ4」と、最初の特効グループが画面の中に見える", async ({ page }) => {
    // 準備
    const fake = await openDefinitionAsAdmin(page);

    // 実行
    await selectStage(page, AREA, STAGE);

    // 検証：見出しと最初の特効グループが画面の中に収まっている（スクロールして見せる）
    const detail = page.getByRole("region", { name: "段階の詳細" });
    const title = detail.getByRole("heading", { name: `${AREA} ${STAGE}` });
    await expect(title).toBeVisible();
    await expect(title).toBeInViewport({ ratio: 1 });
    await expect(detail.getByRole("group", { name: /^特効グループ 1：/ })).toBeInViewport({ ratio: 1 });
    expect(fake.unexpected).toEqual([]);
  });

  test("「攻略サイトの艦名リストを貼り付け」を押すと、開いた欄の「艦名リスト」が画面の中に見え、フォーカスがその欄にある", async ({
    page,
  }) => {
    // 準備
    const fake = await openDefinitionAsAdmin(page);
    await selectStage(page, AREA, STAGE);
    const detail = page.getByRole("region", { name: "段階の詳細" });

    // 実行
    await detail.getByRole("button", { name: "攻略サイトの艦名リストを貼り付け", exact: true }).click();

    // 検証
    const pasteBox = detail.getByRole("textbox", { name: "艦名リスト" });
    await expect(pasteBox).toBeVisible();
    await expect(pasteBox).toBeFocused();
    await expect(pasteBox).toBeInViewport({ ratio: 1 });
    // 貼り付けの欄の「特効グループとして追加」も画面の中に見える（欄が画面の下にはみ出さない）
    await expect(detail.getByRole("button", { name: "特効グループとして追加", exact: true })).toBeInViewport({ ratio: 1 });
    expect(fake.unexpected).toEqual([]);
  });
});
