import { expect, type Page, test } from "@playwright/test";
import { ASSIGN_PATH, routeLatestData, seedPlan, trayOf } from "../src/test/assign-e2e";
import { createBulkShips, summer2026Assignments, summer2026Ships } from "../src/test/fixtures";

// 割り振り画面の高さ（PR-14：T4-2 の点検の M3）の先に書いたテスト（TDD の Red）。直し方は親が決めた。
// - 控えの一覧（スクロールする部分）の最大の高さを、画面の高さに合わせる（今は 760px で決め打ち）。
//   1366×768 の画面でも、ページ全体（document）が縦にスクロールしない（document の高さが画面の高さ以下）
// - 艦の入れ方は e2e/assign-many-ships.spec.ts と同じ（routeLatestData・seedPlan）。
//   控えに多くの艦がいる場面（600 隻。全艦が控え）で、ページ全体がスクロールしないことを確かめる
// - テスト用データの割り当て（札の列に艦がいる）の場面は、控え（region「控えの艦」）の下端が画面の下端を越えないことだけを確かめる。
//   1366 幅では札の列が 2 段に折り返し、連合艦隊（8隻）などのカードで札の列だけで下端が約 923px になるため、
//   控えを直してもページ全体のスクロールは残る（PR-14 のテスト担当が計測。扱いは親が決める）

/** 確かめる画面の大きさ（ノート PC でよくある大きさ） */
const VIEWPORT = { width: 1366, height: 768 } as const;

test.use({ viewport: VIEWPORT });

test.beforeEach(async ({ page }) => {
  await routeLatestData(page);
});

/** 割り振り画面を開き、控えに艦カードが見えるまで待つ */
async function openAssignScreen(page: Page): Promise<void> {
  await page.goto(ASSIGN_PATH);
  await trayOf(page).locator("[data-ship-uid]").first().waitFor({ state: "visible" });
}

/** ページ全体の高さと画面の高さ（ブラウザで測る） */
async function pageHeights(page: Page): Promise<{ document: number; viewport: number }> {
  return page.evaluate(() => ({
    document: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    viewport: window.innerHeight,
  }));
}

/** ページ全体が縦にスクロールしないことを確かめる（測った値は注記にも出す） */
async function expectNoPageScroll(page: Page, label: string): Promise<void> {
  const heights = await pageHeights(page);
  const description = `${label}：document ${heights.document}px／画面 ${heights.viewport}px`;
  test.info().annotations.push({ type: "計測", description });
  expect(heights.document, description).toBeLessThanOrEqual(heights.viewport);
}

test("1366×768 で控えに 600 隻いても、ページ全体は縦にスクロールしない（控えの一覧の中だけがスクロールする）", async ({ page }) => {
  // 準備
  await seedPlan(page, { ships: createBulkShips(600), assignments: {} });

  // 実行
  await openAssignScreen(page);

  // 検証：初め（特効のある艦だけ）と、「リセット」で全艦を出した後
  await expectNoPageScroll(page, "初め");
  await trayOf(page).getByRole("button", { name: "リセット", exact: true }).click();
  await expectNoPageScroll(page, "リセットの後");

  // 検証：控えの一覧は中でスクロールできる（全艦を画面の高さに収めているのではない）
  const listScrolls = await trayOf(page)
    .getByRole("tabpanel")
    .evaluate((element) => element.scrollHeight > element.clientHeight);
  expect(listScrolls).toBe(true);
});

test("1366×768 でテスト用データの割り当て（札の列に艦がいる）でも、控えの下端は画面の下端を越えない", async ({ page }) => {
  // 準備
  await seedPlan(page, { ships: summer2026Ships, assignments: summer2026Assignments });

  // 実行
  await openAssignScreen(page);

  // 検証：ページの一番上にいるときの控え（region）の下端
  const trayBottom = await trayOf(page).evaluate((element) => element.getBoundingClientRect().bottom + window.scrollY);
  const description = `控えの下端 ${Math.round(trayBottom)}px／画面 ${VIEWPORT.height}px`;
  test.info().annotations.push({ type: "計測", description });
  expect(trayBottom, description).toBeLessThanOrEqual(VIEWPORT.height);
});
