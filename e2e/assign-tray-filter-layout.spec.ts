import { expect, type Locator, type Page, test } from "@playwright/test";
import type { Fuda, PublicDefinition } from "@/domain/definition/types";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import { ASSIGN_PATH, routeLatestData, seedPlan, trayOf } from "../src/test/assign-e2e";
import { createBulkShips, summer2026Assignments, summer2026Definition, summer2026Ships } from "../src/test/fixtures";

// 割り振り画面の控えの「絞り込み」の欄の置き方と高さの分け方（PR #38 のレビュー M1・高さの分け方・P1）の先に書いたテスト（TDD の Red）
//
// 親の決定
// - M1：欄の「閉じる」を欄の先頭（「改造状態」の見出しの右など）に移し、名前を「絞り込みを閉じる」にする。
//   欄を開いた直後、スクロールしなくても「絞り込みを閉じる」が見えている
// - 高さの分け方：艦の一覧に最低 160px を残し、残りを上の操作（見出し〜艦種タブ。絞り込みの欄を含む）が使う
//   （.list { flex: 1 1 0; min-height: 160px }、.controls { flex: 0 1 auto; min-height: 0 } の想定）。
//   欄を開いた直後、艦の一覧が画面の中・控えの枠の中に 160px 以上見えている。
//   札が 5 の定義なら、1366×768 でも欄を開いたまま艦種タブがスクロールなしで見えている（main では見えていた）
// - P1：欄を閉じているときは、上の操作（見出し・検索欄）の上でホイールを回すとページがスクロールする
//   （欄を開いているときの、欄の中のスクロールの連鎖止めは実装に任せるので確かめない）
//
// 場面（M1 と高さの分け方は 3 通りとも確かめる）
// - 1366×768・札 12（e2e/assign-tray-filter.spec.ts と同じ 12 札の定義。600 隻が全部控え）
// - 1920×1080・札 12（同じ）
// - 1366×768・札 12・お知らせあり（600 隻のうち 2 隻を定義にない札に置いておき、開くと控えに戻して「控えに戻しました」を出す。
//   作り方は e2e/assign-layout.spec.ts の PR-14b P2' と同じ）
// 「見えている」は IntersectionObserver の割合（祖先のスクロールで隠れた分を除く）が 99% 以上で、かつ控えの枠の中にあること。
// どれも欄を開いた直後で、ページも控えの中もスクロールしない
//
// 艦の入れ方と部品の探し方は e2e/assign-many-ships.spec.ts と同じ（src/test/assign-e2e.ts）

// ---- テスト用のデータ ----

/** 足す札（e2e/assign-tray-filter.spec.ts と同じ。ゲーム内の札番号は既存の 1〜5 の続き。どの段階にも使わない） */
const EXTRA_FUDAS: readonly Fuda[] = [
  { id: "x6", name: "第一遊撃部隊 第一部隊", color: "#C9A227", gameNumber: 6 },
  { id: "x7", name: "第一遊撃部隊 第三部隊", color: "#E07A5F", gameNumber: 7 },
  { id: "x8", name: "南西方面艦隊 護衛部隊", color: "#81B29A", gameNumber: 8 },
  { id: "x9", name: "北方部隊 第五艦隊", color: "#F2CC8F", gameNumber: 9 },
  { id: "x10", name: "第二水雷戦隊 突入部隊", color: "#3D405B", gameNumber: 10 },
  { id: "x11", name: "空母機動部隊 第一航空戦隊", color: "#9C6644", gameNumber: 11 },
  { id: "x12", name: "礼号作戦部隊 支援部隊", color: "#6D597A", gameNumber: 12 },
];

/** 札が 12 ある定義 */
const DEFINITION_WITH_12_FUDAS: PublicDefinition = {
  ...summer2026Definition,
  fudas: [...summer2026Definition.fudas, ...EXTRA_FUDAS],
};

/** 艦の一覧に残す最低の高さ（px） */
const MIN_LIST_HEIGHT = 160;
/** 見えているとみなす割合（IntersectionObserver） */
const VISIBLE_RATIO = 0.99;

// ---- 補助 ----

/** 公開定義の取得を definition を返す応答に差し替える（艦船マスタは routeLatestData のテスト用データ） */
async function routeDefinition(page: Page, definition: PublicDefinition): Promise<void> {
  await routeLatestData(page);
  // 後に登録した page.route が先に当たる
  await page.route(
    (url) => url.pathname === "/data/latest-definition.json",
    (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(definition) }),
  );
}

/** 場面 */
interface Scene {
  /** テスト名に使う説明 */
  label: string;
  viewport: { width: number; height: number };
  definition: PublicDefinition;
  ships: readonly OwnedShip[];
  assignments: AssignmentMap;
  /** 「控えに戻しました」のお知らせが出るか */
  notices: boolean;
}

const SHIPS_600 = createBulkShips(600);
const [NOTICE_SHIP_1, NOTICE_SHIP_2] = SHIPS_600;

/** 札 12 の 3 つの場面 */
const SCENES_12: readonly Scene[] = [
  {
    label: "1366×768・札 12",
    viewport: { width: 1366, height: 768 },
    definition: DEFINITION_WITH_12_FUDAS,
    ships: SHIPS_600,
    assignments: {},
    notices: false,
  },
  {
    label: "1920×1080・札 12",
    viewport: { width: 1920, height: 1080 },
    definition: DEFINITION_WITH_12_FUDAS,
    ships: SHIPS_600,
    assignments: {},
    notices: false,
  },
  {
    label: "1366×768・札 12・お知らせあり",
    viewport: { width: 1366, height: 768 },
    definition: DEFINITION_WITH_12_FUDAS,
    ships: SHIPS_600,
    // 定義にない札に置いた 2 隻（開くと控えに戻し、お知らせを出す）
    assignments:
      NOTICE_SHIP_1 === undefined || NOTICE_SHIP_2 === undefined
        ? {}
        : { [NOTICE_SHIP_1.uid]: "removed-fuda", [NOTICE_SHIP_2.uid]: "removed-fuda" },
    notices: true,
  },
];

/** ボタン「絞り込み」（名前は「絞り込み」とバッジの数。「絞り込みを閉じる」に当たらないよう、「絞り込み」と数だけの名前に限る） */
function filterButtonOf(page: Page): Locator {
  return trayOf(page).getByRole("button", { name: /^絞り込み\s*\d*$/ });
}

/** 場面のとおりに画面を開き、「絞り込み」を開く（スクロールはしない） */
async function openSceneWithFilter(page: Page, scene: Scene): Promise<void> {
  await page.setViewportSize(scene.viewport);
  await routeDefinition(page, scene.definition);
  await seedPlan(page, { ships: scene.ships, assignments: scene.assignments });
  await page.goto(ASSIGN_PATH);
  await trayOf(page).locator("[data-ship-uid]").first().waitFor({ state: "visible" });
  if (scene.notices) {
    await expect(page.getByRole("status").filter({ hasText: "控えに戻しました" })).toBeVisible();
  }
  await filterButtonOf(page).click();
  await expect(filterButtonOf(page)).toHaveAttribute("aria-expanded", "true");
  await expect(trayOf(page).getByRole("group", { name: "特効が効く札", exact: true }).getByRole("checkbox")).toHaveCount(
    scene.definition.fudas.length,
  );
  // 描き直し（仮想スクロールの測り直しを含む）を待つ
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))),
  );
}

/** 要素の見え方：画面の中に見えている割合（IntersectionObserver）、矩形、控えの枠 */
interface Visibility {
  ratio: number;
  top: number;
  bottom: number;
  trayTop: number;
  trayBottom: number;
}

/** locator の要素の見え方（IntersectionObserver の割合と、控えの枠との位置） */
async function visibilityOf(locator: Locator): Promise<Visibility> {
  return locator.evaluate(async (element) => {
    const ratio = await new Promise<number>((resolve) => {
      const observer = new IntersectionObserver((entries) => {
        observer.disconnect();
        resolve(entries[0]?.intersectionRatio ?? 0);
      });
      observer.observe(element);
    });
    const tray = element.closest('section[aria-label="控えの艦"]');
    const trayRect = tray?.getBoundingClientRect();
    const { top, bottom } = element.getBoundingClientRect();
    return { ratio, top, bottom, trayTop: trayRect?.top ?? Number.NaN, trayBottom: trayRect?.bottom ?? Number.NaN };
  });
}

/** 見え方を注記用の文にする */
function describeVisibility(label: string, visibility: Visibility): string {
  return `${label}：見えている割合 ${visibility.ratio.toFixed(2)}・${Math.round(visibility.top)}〜${Math.round(visibility.bottom)}px・控え ${Math.round(visibility.trayTop)}〜${Math.round(visibility.trayBottom)}px`;
}

/** 要素が画面の中（99% 以上）かつ控えの枠の中に見えていることを確かめる */
function expectVisibleInTray(visibility: Visibility, description: string): void {
  expect(visibility.ratio, description).toBeGreaterThanOrEqual(VISIBLE_RATIO);
  expect(visibility.top, description).toBeGreaterThanOrEqual(visibility.trayTop - 1);
  expect(visibility.bottom, description).toBeLessThanOrEqual(visibility.trayBottom + 1);
}

/**
 * 艦の一覧（tabpanel）のうち、画面の中・控えの枠の中に見えている高さ（px）。
 * 一覧の矩形を、控えの枠・画面（0〜innerHeight）・一覧の祖先のスクロールする要素の見えている範囲で切り取った高さ
 */
async function visibleListHeight(page: Page): Promise<{ height: number; listTop: number; listBottom: number }> {
  return trayOf(page)
    .getByRole("tabpanel")
    .evaluate((list) => {
      const rect = list.getBoundingClientRect();
      let top = Math.max(rect.top, 0);
      let bottom = Math.min(rect.bottom, window.innerHeight);
      for (let parent = list.parentElement; parent !== null; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const clips = style.overflowY !== "visible" || parent.matches('section[aria-label="控えの艦"]');
        if (!clips) continue;
        const parentRect = parent.getBoundingClientRect();
        top = Math.max(top, parentRect.top);
        bottom = Math.min(bottom, parentRect.bottom);
        if (parent.matches('section[aria-label="控えの艦"]')) break;
      }
      return { height: Math.max(0, bottom - top), listTop: rect.top, listBottom: rect.bottom };
    });
}

// ---- テスト ----

for (const scene of SCENES_12) {
  test.describe(`${scene.label}で「絞り込み」を開いた直後（スクロールしない）`, () => {
    test(`M1：欄の先頭の「絞り込みを閉じる」が、画面の中・控えの枠の中に見えている（${scene.label}）`, async ({ page }) => {
      // 準備・実行
      await openSceneWithFilter(page, scene);

      // 検証
      const closeButton = trayOf(page).getByRole("button", { name: "絞り込みを閉じる", exact: true });
      await expect(closeButton, "名前が「絞り込みを閉じる」のボタンがある").toHaveCount(1);
      const visibility = await visibilityOf(closeButton);
      const description = describeVisibility(`${scene.label}・「絞り込みを閉じる」`, visibility);
      test.info().annotations.push({ type: "計測", description });
      expectVisibleInTray(visibility, description);
    });

    test(`高さの分け方：艦の一覧が、画面の中・控えの枠の中に ${MIN_LIST_HEIGHT}px 以上見えている（${scene.label}）`, async ({
      page,
    }) => {
      // 準備・実行
      await openSceneWithFilter(page, scene);

      // 検証
      const list = await visibleListHeight(page);
      const description = `${scene.label}・艦の一覧：見えている高さ ${Math.round(list.height)}px（一覧 ${Math.round(list.listTop)}〜${Math.round(list.listBottom)}px）`;
      test.info().annotations.push({ type: "計測", description });
      expect(list.height, description).toBeGreaterThanOrEqual(MIN_LIST_HEIGHT - 1);
    });
  });
}

test.describe("1366×768・札 5（2026夏イベの定義）で「絞り込み」を開いた直後（スクロールしない）", () => {
  const scene: Scene = {
    label: "1366×768・札 5",
    viewport: { width: 1366, height: 768 },
    definition: summer2026Definition,
    ships: SHIPS_600,
    assignments: {},
    notices: false,
  };

  test("艦種タブがすべて、画面の中・控えの枠の中に見えている（main では見えていた）", async ({ page }) => {
    // 準備・実行
    await openSceneWithFilter(page, scene);

    // 検証
    const tabs = trayOf(page).getByRole("tablist", { name: "艦種", exact: true }).getByRole("tab");
    const count = await tabs.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const tab = tabs.nth(i);
      const name = (await tab.textContent()) ?? "";
      const visibility = await visibilityOf(tab);
      const description = describeVisibility(`${scene.label}・艦種タブ「${name}」`, visibility);
      test.info().annotations.push({ type: "計測", description });
      expectVisibleInTray(visibility, description);
    }
  });

  test(`艦の一覧も、画面の中・控えの枠の中に ${MIN_LIST_HEIGHT}px 以上見えている（守り）`, async ({ page }) => {
    // 準備・実行
    await openSceneWithFilter(page, scene);

    // 検証
    const list = await visibleListHeight(page);
    const description = `${scene.label}・艦の一覧：見えている高さ ${Math.round(list.height)}px（一覧 ${Math.round(list.listTop)}〜${Math.round(list.listBottom)}px）`;
    test.info().annotations.push({ type: "計測", description });
    expect(list.height, description).toBeGreaterThanOrEqual(MIN_LIST_HEIGHT - 1);
  });
});

test.describe("P1：欄を閉じているとき、上の操作の上でホイールを回すとページがスクロールする（1366×500・札 5・札の列に艦がいる）", () => {
  /** ページがスクロールできる低い画面（札の列に艦がいると、ページの高さが画面を越える） */
  const VIEWPORT = { width: 1366, height: 500 } as const;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await routeDefinition(page, summer2026Definition);
    await seedPlan(page, { ships: summer2026Ships, assignments: summer2026Assignments });
    await page.goto(ASSIGN_PATH);
    await trayOf(page).locator("[data-ship-uid]").first().waitFor({ state: "visible" });
    await expect(filterButtonOf(page)).toHaveAttribute("aria-expanded", "false");
    // 前提：ページが縦にスクロールできる
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 50);
    expect(scrollable, "前提：1366×500 でページが縦にスクロールできる").toBe(true);
  });

  /** target の真ん中でホイールを回し、ページのスクロールの位置を返す（描き直しを待つ） */
  async function wheelOver(page: Page, target: Locator): Promise<number> {
    const box = await target.boundingBox();
    if (box === null) throw new Error("ホイールを回す相手が見えない");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
    // スクロールが起きるまで少し待つ（起きなければ 2 秒で諦めて、今の位置を返す）
    await page.waitForFunction(() => window.scrollY > 0, undefined, { timeout: 2000 }).catch(() => undefined);
    return page.evaluate(() => window.scrollY);
  }

  test("見出し「控え」の上でホイールを回すと、ページがスクロールする", async ({ page }) => {
    // 準備
    const heading = trayOf(page).getByRole("heading", { name: "控え", exact: true });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // 実行
    const scrollY = await wheelOver(page, heading);

    // 検証
    const description = `見出しの上でホイール：ページのスクロール ${Math.round(scrollY)}px`;
    test.info().annotations.push({ type: "計測", description });
    expect(scrollY, description).toBeGreaterThan(0);
  });

  test("検索欄の上でホイールを回すと、ページがスクロールする", async ({ page }) => {
    // 準備
    const search = trayOf(page).getByRole("searchbox", { name: "図鑑ID・名称で検索", exact: true });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // 実行
    const scrollY = await wheelOver(page, search);

    // 検証
    const description = `検索欄の上でホイール：ページのスクロール ${Math.round(scrollY)}px`;
    test.info().annotations.push({ type: "計測", description });
    expect(scrollY, description).toBeGreaterThan(0);
  });
});

// ---- 守り：控えは画面の高さいっぱいまで使う（艦の一覧が中身よりはるかに多いとき）----
// 高さの分け方を変えても（例：艦の一覧を flex: 1 1 0 にする）、控えの高さが「上の操作＋一覧の最低の 160px」まで縮まないこと。
// 控えは高さの上限（max-height）だけを持つので、一覧の高さの基準を 0 にすると、控えが中身に合わせて縮み、
// 欄を閉じていても一覧が 160px しかなくなる（親の想定の CSS を仮に当てて確かめた）。
// 600 隻（全艦が控え）では、今（main と PR #38）の控えの下端は画面の下端から約 21px（本文の下の余白 16px ほか）

/** 控えの下端と画面の下端の差の上限（px） */
const TRAY_BOTTOM_GAP_LIMIT = 40;

for (const guard of [
  { label: "1366×768・札 12・欄を閉じている", scene: SCENES_12[0], openFilter: false },
  { label: "1920×1080・札 12・欄を閉じている", scene: SCENES_12[1], openFilter: false },
  { label: "1920×1080・札 12・欄を開いている", scene: SCENES_12[1], openFilter: true },
] as const) {
  test(`守り：控えに 600 隻いるとき、控えは画面の高さいっぱいまで使う（下端が画面の下端から ${TRAY_BOTTOM_GAP_LIMIT}px 以内。${guard.label}）`, async ({
    page,
  }) => {
    // 準備
    const scene = guard.scene;
    if (scene === undefined) throw new Error("場面がない");
    await page.setViewportSize(scene.viewport);
    await routeDefinition(page, scene.definition);
    await seedPlan(page, { ships: scene.ships, assignments: scene.assignments });

    // 実行
    await page.goto(ASSIGN_PATH);
    await trayOf(page).locator("[data-ship-uid]").first().waitFor({ state: "visible" });
    if (guard.openFilter) {
      await filterButtonOf(page).click();
      await expect(filterButtonOf(page)).toHaveAttribute("aria-expanded", guard.openFilter ? "true" : "false");
    }
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))),
    );

    // 検証
    const edges = await trayOf(page).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, viewport: window.innerHeight };
    });
    const description = `${guard.label}：控え ${Math.round(edges.top)}〜${Math.round(edges.bottom)}px／画面 ${edges.viewport}px`;
    test.info().annotations.push({ type: "計測", description });
    expect(edges.bottom, description).toBeGreaterThanOrEqual(edges.viewport - TRAY_BOTTOM_GAP_LIMIT);
    expect(edges.bottom, description).toBeLessThanOrEqual(edges.viewport);
  });
}
