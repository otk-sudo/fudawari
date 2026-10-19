import { expect, type Page, test } from "@playwright/test";
import type { Fuda, PublicDefinition } from "@/domain/definition/types";
import { createShipMaster } from "../src/domain/master";
import { buildTray, createInitialTrayOptions, resetTrayOptions } from "../src/features/assign/tray";
import { ASSIGN_PATH, cardIn, routeLatestData, seedPlan, trayCountPattern, trayOf } from "../src/test/assign-e2e";
import { createBulkShips, summer2026Definition, summer2026MasterEntries } from "../src/test/fixtures";

// 割り振り画面の控えの「絞り込み」の欄を開いていても、控えの艦の一覧をスクロールできること
// （2026-10-17 のユーザーの要望 2。要件 3.3「絞り込み」）の先に書いたテスト（TDD の Red）
//
// 要望：控えは画面の高さに収めてある（TrayPanel.module.css の height: var(--tray-max-height)〔calc(100dvh - ヘッダー帯の高さ -
// 本文の上下の余白 - お知らせの欄の高さ)〕と sticky）。
// 札が多い（例 12 札）と「絞り込み」の欄（改造状態・特効・特効が効く札）が大きくなり、艦の一覧がほとんど見えず、スクロールもできない。
// 直し方は次のどちらでもよい（このテストはどちらでも通るように、利用者と同じくホイールで動かして、最後の艦が見えるかを確かめる）
// - 欄を開いても、艦の一覧に最低限の高さ（例 160px 以上）が画面の中に残り、一覧の中をスクロールできる
// - 控えの全体（絞り込みの欄を含む）が、控えの中でスクロールできる
//
// 確かめ方
// - 画面は 1366×768（ノート PC でよくある大きさ）。艦は createBulkShips(600)（全艦が控え）。「リセット」で全艦を出す
// - 定義は 2026夏イベの定義（札 5）に、本番のイベントにありそうな長めの名前の札を 7 つ足した 12 札のもの
//   （公開定義の取得をこの定義を返す応答に差し替える。足した札はどの段階にも使わない）
// - 「絞り込み」を開いたまま、控えの上でホイールを回し（下のほう＝控えの下端か画面の下端の近い方から 24px 上）、
//   控えの一覧の最後の艦（buildTray で求める）のカードが、画面の中（IntersectionObserver で 99% 以上）かつ控えの枠の中に見えるまで続ける。
//   ホイールは、控えの見えている部分の下のほうと上のほう（上端から 40px。見出し・検索欄の上）で交互に回す
//   （一覧だけがスクロールする形でも、控えの全体がスクロールする形でも、どちらかが動くように）
// - 最後まで「絞り込み」は開いたまま（aria-expanded="true"）。欄の中身（最後の札のチェックボックス）もスクロールで画面の中に出せる（守り）
//
// 艦の入れ方と部品の探し方は e2e/assign-many-ships.spec.ts と同じ（src/test/assign-e2e.ts）

/** 確かめる画面の大きさ */
const VIEWPORT = { width: 1366, height: 768 } as const;
/** 控えの艦（600 隻。全艦が控え） */
const SHIPS = createBulkShips(600);
/** ホイールを回す回数の上限（1 回 1200px。600 隻のカード表示でも十分に末尾に届く回数） */
const MAX_WHEELS = 120;
/** 1 回のホイールで動かす量（px） */
const WHEEL_DELTA = 1200;

/** 足す札（ゲーム内の札番号は既存の 1〜5 の続き。どの段階にも使わない） */
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

/** 「リセット」の後（全艦を出す・並び順は艦型）の控えの一覧の、最後の区切りの最後の艦（buildTray と同じ組み立て） */
const LAST_SHIP_UID = (() => {
  const tray = buildTray({
    definition: DEFINITION_WITH_12_FUDAS,
    master: createShipMaster(summer2026MasterEntries),
    ships: SHIPS,
    assignments: {},
    options: resetTrayOptions(createInitialTrayOptions()),
  });
  const last = tray.groups.at(-1)?.entries.at(-1);
  if (last === undefined) throw new Error("テスト用データの控えが空");
  return last.ship.uid;
})();

test.use({ viewport: VIEWPORT });

test.beforeEach(async ({ page }) => {
  await routeLatestData(page);
  // 公開定義だけ、札が 12 ある定義に差し替える（後に登録した page.route が先に当たる）
  await page.route(
    (url) => url.pathname === "/data/latest-definition.json",
    (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DEFINITION_WITH_12_FUDAS) }),
  );
  await seedPlan(page, { ships: SHIPS, assignments: {} });
});

// ---- 補助 ----

/** ボタン「絞り込み」（名前は「絞り込み」とバッジの数） */
function filterButtonOf(page: Page) {
  return trayOf(page).getByRole("button", { name: /^絞り込み\s*\d*$/ });
}

/** 画面の中の矩形（上端・下端・左端・右端） */
interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** 控え（region）の画面の中の矩形 */
async function trayBox(page: Page): Promise<Box> {
  return trayOf(page).evaluate((element) => {
    const { top, bottom, left, right } = element.getBoundingClientRect();
    return { top, bottom, left, right };
  });
}

/**
 * 控えの中の個体 ID が uid の艦カードの、画面の中に見えている割合（IntersectionObserver。祖先のスクロールで隠れた分は除く）と矩形。
 * 描いていなければ null
 */
async function cardVisibility(page: Page, uid: string): Promise<{ ratio: number; box: Box } | null> {
  return page.evaluate(async (targetUid) => {
    const tray = document.querySelector('section[aria-label="控えの艦"]');
    const card = [...(tray?.querySelectorAll<HTMLElement>("[data-ship-uid]") ?? [])].find(
      (element) => element.dataset.shipUid === targetUid,
    );
    if (card === undefined) return null;
    const ratio = await new Promise<number>((resolve) => {
      const observer = new IntersectionObserver((entries) => {
        observer.disconnect();
        resolve(entries[0]?.intersectionRatio ?? 0);
      });
      observer.observe(card);
    });
    const { top, bottom, left, right } = card.getBoundingClientRect();
    return { ratio, box: { top, bottom, left, right } };
  }, uid);
}

/** 描き直しを 2 フレーム待つ */
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

// ---- テスト ----

test("1366×768・札が 12 ある定義で「絞り込み」を開いたままでも、控えの上でホイールを回すと控えの一覧の最後の艦まで見られる（2026-10-17 の要望 2）", async ({
  page,
}) => {
  // 準備：全艦を出し、「絞り込み」を開く（特効が効く札のチェックボックスが 12）
  await page.goto(ASSIGN_PATH);
  await trayOf(page).locator("[data-ship-uid]").first().waitFor({ state: "visible" });
  await trayOf(page).getByRole("button", { name: "リセット", exact: true }).click();
  await expect(trayOf(page)).toContainText(trayCountPattern(SHIPS.length, SHIPS.length));
  await filterButtonOf(page).click();
  await expect(filterButtonOf(page)).toHaveAttribute("aria-expanded", "true");
  const fudaGroup = trayOf(page).getByRole("group", { name: "特効が効く札", exact: true });
  await expect(fudaGroup.getByRole("checkbox")).toHaveCount(DEFINITION_WITH_12_FUDAS.fudas.length);

  const before = await trayBox(page);
  const listBefore = await trayOf(page)
    .getByRole("tabpanel")
    .evaluate((element) => {
      const { top, bottom } = element.getBoundingClientRect();
      return { top, bottom };
    });
  const beforeDescription = `開いた直後：控え ${Math.round(before.top)}〜${Math.round(before.bottom)}px・艦の一覧 ${Math.round(listBefore.top)}〜${Math.round(listBefore.bottom)}px／画面 ${VIEWPORT.height}px`;
  test.info().annotations.push({ type: "計測", description: beforeDescription });

  // 実行：控えの見えている部分の下のほうでホイールを回し、最後の艦が見えるまで続ける
  let wheels = 0;
  let visibility = await cardVisibility(page, LAST_SHIP_UID);
  while (wheels < MAX_WHEELS && (visibility === null || visibility.ratio < 0.99)) {
    const box = await trayBox(page);
    const x = (box.left + box.right) / 2;
    // 下のほう（艦の一覧の上になりやすい）と上のほう（見出し・検索欄の上。控えの全体がスクロールする形ならそこが動く）を交互に使う
    const y = wheels % 2 === 0 ? Math.min(box.bottom, VIEWPORT.height) - 24 : Math.max(box.top, 0) + 40;
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, WHEEL_DELTA);
    await nextFrames(page);
    wheels += 1;
    visibility = await cardVisibility(page, LAST_SHIP_UID);
  }

  // 検証：最後の艦のカードが画面の中に見え（99% 以上）、控えの枠の中にある。「絞り込み」は開いたまま
  const after = await trayBox(page);
  const description = `ホイール ${wheels} 回：最後の艦 ${
    visibility === null
      ? "描いていない"
      : `見えている割合 ${visibility.ratio.toFixed(2)}・${Math.round(visibility.box.top)}〜${Math.round(visibility.box.bottom)}px`
  }・控え ${Math.round(after.top)}〜${Math.round(after.bottom)}px／画面 ${VIEWPORT.height}px`;
  test.info().annotations.push({ type: "計測", description });
  expect(visibility, description).not.toBeNull();
  if (visibility === null) return;
  expect(visibility.ratio, description).toBeGreaterThanOrEqual(0.99);
  expect(visibility.box.top, description).toBeGreaterThanOrEqual(after.top - 1);
  expect(visibility.box.bottom, description).toBeLessThanOrEqual(after.bottom + 1);
  expect(visibility.box.bottom, description).toBeLessThanOrEqual(VIEWPORT.height);
  await expect(cardIn(trayOf(page), LAST_SHIP_UID)).toBeVisible();
  await expect(filterButtonOf(page)).toHaveAttribute("aria-expanded", "true");

  // 検証（守り）：欄の中身も見られる（最後の札のチェックボックスを、スクロールで画面の中に出せる）
  const lastFudaName = DEFINITION_WITH_12_FUDAS.fudas.at(-1)?.name ?? "";
  const lastFudaBox = fudaGroup.getByRole("checkbox", { name: lastFudaName, exact: true });
  await lastFudaBox.scrollIntoViewIfNeeded();
  await expect(lastFudaBox).toBeInViewport();
});
