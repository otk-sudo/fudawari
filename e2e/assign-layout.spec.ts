import { expect, type Page, test } from "@playwright/test";
import { ASSIGN_PATH, columnOf, routeLatestData, seedPlan, trayOf } from "../src/test/assign-e2e";
import { createBulkShips, summer2026Assignments, summer2026Definition, summer2026Ships } from "../src/test/fixtures";

// 割り振り画面の高さ（PR-14：T4-2 の点検の M3）の先に書いたテスト（TDD の Red）。直し方は親が決めた。
// - 控えの一覧（スクロールする部分）の最大の高さを、画面の高さに合わせる（今は 760px で決め打ち）。
//   1366×768 の画面でも、ページ全体（document）が縦にスクロールしない（document の高さが画面の高さ以下）
// - 艦の入れ方は e2e/assign-many-ships.spec.ts と同じ（routeLatestData・seedPlan）。
//   控えに多くの艦がいる場面（600 隻。全艦が控え）で、ページ全体がスクロールしないことを確かめる
// - テスト用データの割り当て（札の列に艦がいる）の場面は、控え（region「控えの艦」）の下端が画面の下端を越えないことだけを確かめる。
//   1366 幅では札の列が 2 段に折り返し、連合艦隊（8隻）などのカードで札の列だけで下端が約 923px になるため、
//   控えを直してもページ全体のスクロールは残る（PR-14 のテスト担当が計測。扱いは親が決める）
//
// PR-14 のレビュー M1・P4 で足したこと（親が決めた直し方：割り振り画面の .screen を min-height に戻し、控えを sticky と
// max-height: calc(100dvh - …) で画面に収める想定）
// - 札の列が 2 段になってページがスクロールするとき、下までスクロールしても左メニューは画面に固定されたまま
//   （上端 0・下端が画面の下端）。比べる相手の一覧（/list）は今も固定されている（守りのテスト）
// - 札の列の下に本文の余白が残る（ページの下端と、いちばん下の札の列の下端の間が 12px 以上。本文の下の余白は 16px）

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

/** 左メニュー（navigation「メインメニュー」） */
function sideNavOf(page: Page) {
  return page.getByRole("navigation", { name: "メインメニュー", exact: true });
}

/** ページのいちばん下までスクロールし、スクロールした量を返す（描き直しを 2 フレーム待つ） */
async function scrollToBottom(page: Page): Promise<number> {
  return page.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return window.scrollY;
  });
}

/** 左メニューが画面に固定されている（上端 0・下端が画面の下端。1px までのずれは許す）ことを確かめる */
async function expectSideNavPinned(page: Page, label: string): Promise<void> {
  const box = await sideNavOf(page).boundingBox();
  expect(box, `${label}：左メニューが見える`).not.toBeNull();
  if (box === null) return;
  const description = `${label}：左メニューの上端 ${Math.round(box.y)}px・下端 ${Math.round(box.y + box.height)}px／画面 ${VIEWPORT.height}px`;
  test.info().annotations.push({ type: "計測", description });
  expect(Math.abs(box.y), description).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y + box.height - VIEWPORT.height), description).toBeLessThanOrEqual(1);
}

test("1366×768 でテスト用データの割り当て（札の列が 2 段）のとき、下までスクロールしても左メニューは画面に固定されたまま（PR-14：レビュー M1）", async ({ page }) => {
  // 準備
  await seedPlan(page, { ships: summer2026Ships, assignments: summer2026Assignments });
  await openAssignScreen(page);

  // 実行：ページのいちばん下までスクロールする（札の列が画面より高いので、ページはスクロールする）
  const scrolled = await scrollToBottom(page);
  expect(scrolled, "ページがスクロールした量").toBeGreaterThan(0);

  // 検証
  await expectSideNavPinned(page, "割り振り");
});

test("1366×768 でテスト用データの割り当てのとき、いちばん下の札の列の下に本文の余白が残る（PR-14：レビュー P4）", async ({ page }) => {
  // 準備
  await seedPlan(page, { ships: summer2026Ships, assignments: summer2026Assignments });
  await openAssignScreen(page);

  // 実行
  await scrollToBottom(page);

  // 検証：ページの下端と、いちばん下の札の列の下端の間
  const columnBottoms = await Promise.all(
    summer2026Definition.fudas.map((fuda) =>
      columnOf(page, fuda.name).evaluate((element) => element.getBoundingClientRect().bottom + window.scrollY),
    ),
  );
  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const gap = documentHeight - Math.max(...columnBottoms);
  const description = `札の列の下の余白 ${Math.round(gap)}px（ページの高さ ${documentHeight}px）`;
  test.info().annotations.push({ type: "計測", description });
  expect(gap, description).toBeGreaterThanOrEqual(12);
});

test("比べる相手：一覧（/list）は 1366×768 で下までスクロールしても左メニューが画面に固定されている（守り）", async ({ page }) => {
  // 準備
  await seedPlan(page, { ships: summer2026Ships, assignments: summer2026Assignments });
  await page.goto("/list");
  await expect(page.getByRole("heading", { level: 1, name: "札割り一覧" })).toBeVisible();
  await expect(columnOfList(page)).toBeVisible();

  // 実行
  const scrolled = await scrollToBottom(page);
  expect(scrolled, "ページがスクロールした量").toBeGreaterThan(0);

  // 検証
  await expectSideNavPinned(page, "一覧");
});

/** 一覧の札の行（連合艦隊）。艦の行を描き終えたことの目安 */
function columnOfList(page: Page) {
  return page.getByRole("region", { name: "連合艦隊", exact: true }).first();
}
