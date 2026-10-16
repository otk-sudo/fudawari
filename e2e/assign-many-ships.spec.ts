import { expect, type Locator, type Page, test } from "@playwright/test";
import { createShipMaster } from "../src/domain/master";
import { buildTray, createInitialTrayOptions, resetTrayOptions } from "../src/features/assign/tray";
import {
  ASSIGN_PATH,
  cardIn,
  columnOf,
  dragOver,
  drop,
  routeLatestData,
  seedPlan,
  startDrag,
  trayCountPattern,
  trayOf,
} from "../src/test/assign-e2e";
import { createBulkShips, summer2026Definition, summer2026MasterEntries } from "../src/test/fixtures";

// 割り振り画面を 600 隻で使っても重くならないこと（roadmap T2-8・PR-06、要件 3.3「600 隻以上でも扱えるようにする」）を、
// ビルドした静的書き出しで測って確かめる
//
// 計測の方法と目安（PR-06 で決めた。CI でも安定するよう緩めにしている）
// - データ：createBulkShips(600)（600 隻。全艦が控え）をブラウザ内の保存に書いてから測る
// - ① 割り振り画面を開いて（page.goto）から、控えの艦カードが見えるまで：3 秒以内
// - ② 控えの艦を 1 隻押してから、そのカードが開く（aria-expanded="true"）まで：1 秒以内
// - ③ 並び順を「Lv」に切り替えてから、新しい区切り（「Lv 140 以上」）で描き直すまで：1 秒以内
// - ④ 控えを末尾までスクロールしても、描く艦カードの数は全艦（600 隻）の 1/5 未満（仮想スクロールが効いている）で、
//   一覧の末尾の艦が見えている
// - ⑤ 区切りの見出しを押してから、その区切りを折りたたむまで：1 秒以内（roadmap の「折りたたみが重くならない」）
// - ⑥ 控えの艦を札の列に落としてから、その列に移るまで：1 秒以内（roadmap の「ドラッグが重くならない」）
// 時間は Playwright を動かしている側の時計で、操作の直前から、画面の変化を requestAnimationFrame ごとに調べて見つけるまでを測る
// （Playwright の操作の往復の時間も含む）。測った値は、テストの出力（console）とテストの注記（annotation「計測」）に出す。
// あわせて、仮想スクロールにしても崩れないこと（区切りの見出しの固定・開いたカードの高さ）を確かめる。
//
// 艦名と区切りはテスト用データのもの（routeLatestData で公開定義と艦船マスタを差し替える）。初めは「特効のある艦だけ」なので
// 「568 / 600隻」、「リセット」で「600 / 600隻」になる。テストごとにブラウザのコンテキストが分かれるため、保存は毎回空から始まる

/** 600 隻（全艦が控え） */
const SHIPS = createBulkShips(600);
/** 全艦の数 */
const TOTAL = SHIPS.length;

/** ① 割り振り画面を開いてから控えの艦カードが見えるまでの目安（ミリ秒） */
const OPEN_LIMIT_MS = 3000;
/** ② 控えの艦を押してからカードが開くまでの目安（ミリ秒） */
const SELECT_LIMIT_MS = 1000;
/** ③ 並び順を切り替えてから描き直すまでの目安（ミリ秒） */
const SORT_LIMIT_MS = 1000;
/** ④ 描いてよい艦カードの数（全艦の 1/5 未満） */
const MAX_RENDERED_CARDS = Math.floor(TOTAL / 5) - 1;
/** ⑤ 区切りの見出しを押してから折りたたむまでの目安（ミリ秒） */
const FOLD_LIMIT_MS = 1000;
/** ⑥ 控えの艦を札の列に落としてから移るまでの目安（ミリ秒） */
const DROP_LIMIT_MS = 1000;

/**
 * 「リセット」の後（全艦を出す・並び順は艦型）の控えの一覧の、最後の区切りの最後の艦。
 * 控えの組み立て（並べ替え・区切り）は buildTray（src/features/assign/tray.ts。単体テスト済み）と同じにする
 */
const LAST_SHIP_UID = (() => {
  const options = resetTrayOptions(createInitialTrayOptions());
  const tray = buildTray({
    definition: summer2026Definition,
    master: createShipMaster(summer2026MasterEntries),
    ships: SHIPS,
    assignments: {},
    options,
  });
  const last = tray.groups.at(-1)?.entries.at(-1);
  if (last === undefined) throw new Error("テスト用データの控えが空");
  return last.ship.uid;
})();

/** 札の列が 5 つとも、スクロールせずに見える大きさ（⑥でドラッグの途中にページをスクロールしないため） */
test.use({ viewport: { width: 1920, height: 1080 } });

test.beforeEach(async ({ page }) => {
  await routeLatestData(page);
  await seedPlan(page, { ships: SHIPS, assignments: {} });
});

// ---- 補助 ----

/** 控えに描いている艦カード */
function trayCards(page: Page): Locator {
  return trayOf(page).locator("[data-ship-uid]");
}

/** 控えの区切りの見出し（名前が title で始まり、aria-pressed を持たないボタン） */
function groupHeaderOf(page: Page, title: string): Locator {
  return trayOf(page)
    .locator("button[aria-expanded]:not([aria-pressed])")
    .filter({ hasText: new RegExp(`^\\s*[▾▸]?\\s*${title}`) });
}

/** 割り振り画面を開き、控えに艦カードが見えるまで待つ */
async function openAssignScreen(page: Page): Promise<void> {
  await page.goto(ASSIGN_PATH);
  await trayCards(page).first().waitFor({ state: "visible" });
}

/** 測った値をテストの出力と注記に出し、目安以内であることを確かめる */
function report(label: string, elapsedMs: number, limitMs: number): void {
  const description = `${label}：${Math.round(elapsedMs)} ms（目安 ${limitMs} ms 以内・${TOTAL} 隻）`;
  test.info().annotations.push({ type: "計測", description });
  console.log(`[計測] ${description}`);
  expect(elapsedMs, description).toBeLessThanOrEqual(limitMs);
}

/**
 * action を始めてから、ブラウザで condition(arg) が true になるまでの時間（ミリ秒）。condition は requestAnimationFrame ごとに調べる
 * （condition はブラウザで動くので、外の変数を使わず、必要な値は arg で渡す）
 */
async function measure(
  page: Page,
  action: () => Promise<void>,
  condition: (arg: string) => boolean,
  arg = "",
): Promise<number> {
  const startedAt = performance.now();
  await action();
  await page.waitForFunction(condition, arg, { polling: "raf", timeout: 10_000 });
  return performance.now() - startedAt;
}

/** 控えの中の、個体 ID が uid の艦カードが開いている（aria-expanded="true"）か（ブラウザで評価する） */
function trayCardIsExpanded(uid: string): boolean {
  const tray = document.querySelector('section[aria-label="控えの艦"]');
  const card = [...(tray?.querySelectorAll<HTMLElement>("[data-ship-uid]") ?? [])].find(
    (element) => element.dataset.shipUid === uid,
  );
  return card?.getAttribute("aria-expanded") === "true";
}

/**
 * 控えの中の、縦にスクロールする要素（overflow-y が auto か scroll で、中身がはみ出しているもの）を、末尾までスクロールする。
 * 仮想スクロールは描いた行を測って中身の高さを直すことがあるので、末尾に着いて落ち着くまで繰り返す。
 * スクロールした後の位置と大きさを返す
 */
async function scrollTrayToEnd(page: Page): Promise<{ scrollTop: number; clientHeight: number; scrollHeight: number }> {
  return trayOf(page).evaluate(async (tray) => {
    const candidates = [tray, ...tray.querySelectorAll<HTMLElement>("*")].filter((element) => {
      const { overflowY } = getComputedStyle(element);
      return (overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight + 1;
    });
    const list = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (list === undefined) throw new Error("控えの中に、縦にスクロールする要素がない");
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    let stableFrames = 0;
    for (let i = 0; i < 200 && stableFrames < 5; i += 1) {
      list.scrollTop = list.scrollHeight;
      await nextFrame();
      const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
      stableFrames = atEnd ? stableFrames + 1 : 0;
    }
    return { scrollTop: list.scrollTop, clientHeight: list.clientHeight, scrollHeight: list.scrollHeight };
  });
}

/** 控えの中の縦にスクロールする要素を、中身の高さの ratio（0〜1）の位置までスクロールする */
async function scrollTrayTo(page: Page, ratio: number): Promise<void> {
  await trayOf(page).evaluate(async (tray, at) => {
    const candidates = [tray, ...tray.querySelectorAll<HTMLElement>("*")].filter((element) => {
      const { overflowY } = getComputedStyle(element);
      return (overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight + 1;
    });
    const list = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (list === undefined) throw new Error("控えの中に、縦にスクロールする要素がない");
    list.scrollTop = (list.scrollHeight - list.clientHeight) * at;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, ratio);
}

// ---- テスト ----

test.describe(`割り振り画面を ${TOTAL} 隻で使う（計測）`, () => {
  test(`① 割り振り画面を開いてから控えの艦カードが見えるまで ${OPEN_LIMIT_MS} ms 以内`, async ({ page }) => {
    // 実行
    const startedAt = performance.now();
    await openAssignScreen(page);
    const elapsed = performance.now() - startedAt;

    // 検証
    await expect(trayOf(page)).toContainText(trayCountPattern(568, TOTAL));
    report("① 開いてから控えの艦カードが見えるまで", elapsed, OPEN_LIMIT_MS);
  });

  test(`② 控えの艦を押してからカードが開くまで ${SELECT_LIMIT_MS} ms 以内`, async ({ page }) => {
    // 準備
    await openAssignScreen(page);
    const card = trayCards(page).first();
    const uid = await card.getAttribute("data-ship-uid");
    if (uid === null) throw new Error("艦カードに data-ship-uid がない");

    // 実行
    const elapsed = await measure(page, () => card.click(), trayCardIsExpanded, uid);

    // 検証
    await expect(cardIn(trayOf(page), uid)).toHaveAttribute("aria-pressed", "true");
    report("② 押してからカードが開くまで", elapsed, SELECT_LIMIT_MS);
  });

  test(`③ 並び順を「Lv」に切り替えてから描き直すまで ${SORT_LIMIT_MS} ms 以内`, async ({ page }) => {
    // 準備
    await openAssignScreen(page);
    const sort = trayOf(page).getByRole("combobox", { name: "並び順" });

    // 実行
    const elapsed = await measure(
      page,
      async () => {
        await sort.selectOption({ label: "Lv" });
      },
      () => {
        const tray = document.querySelector('section[aria-label="控えの艦"]');
        return [...(tray?.querySelectorAll("button[aria-expanded]") ?? [])].some((button) =>
          /Lv 140 以上/.test(button.textContent ?? ""),
        );
      },
    );

    // 検証
    await expect(groupHeaderOf(page, "Lv 140 以上")).toBeVisible();
    report("③ 並び順を切り替えてから描き直すまで", elapsed, SORT_LIMIT_MS);
  });

  test(`④ 控えを末尾までスクロールしても、描く艦カードは全艦の 1/5 未満（${MAX_RENDERED_CARDS} 枚以下）で、末尾の艦が見える`, async ({
    page,
  }) => {
    // 準備：「リセット」で全艦（600 隻）を出す
    await openAssignScreen(page);
    await trayOf(page).getByRole("button", { name: "リセット", exact: true }).click();
    await expect(trayOf(page)).toContainText(trayCountPattern(TOTAL, TOTAL));
    const before = await trayCards(page).count();

    // 実行
    const scroll = await scrollTrayToEnd(page);

    // 検証
    await expect(cardIn(trayOf(page), LAST_SHIP_UID)).toBeVisible();
    const after = await trayCards(page).count();
    const description = `④ 描いた艦カード：先頭 ${before} 枚・末尾 ${after} 枚（目安 ${MAX_RENDERED_CARDS} 枚以下・${TOTAL} 隻。末尾までのスクロール ${Math.round(scroll.scrollTop)} px）`;
    test.info().annotations.push({ type: "計測", description });
    console.log(`[計測] ${description}`);
    expect(before, description).toBeLessThanOrEqual(MAX_RENDERED_CARDS);
    expect(after, description).toBeLessThanOrEqual(MAX_RENDERED_CARDS);
  });

  test(`⑤ 区切りの見出しを押してから折りたたむまで ${FOLD_LIMIT_MS} ms 以内`, async ({ page }) => {
    // 準備：先頭の区切りは大和型
    await openAssignScreen(page);
    const header = groupHeaderOf(page, "大和型");
    await expect(header).toHaveAttribute("aria-expanded", "true");

    // 実行
    const elapsed = await measure(
      page,
      () => header.click(),
      () => {
        const tray = document.querySelector('section[aria-label="控えの艦"]');
        const button = [...(tray?.querySelectorAll("button[aria-expanded]:not([aria-pressed])") ?? [])].find((element) =>
          /大和型/.test(element.textContent ?? ""),
        );
        return button?.getAttribute("aria-expanded") === "false";
      },
    );

    // 検証：大和型の艦（大和改二重）を描かない
    await expect(trayCards(page).filter({ hasText: "大和改二重" })).toHaveCount(0);
    report("⑤ 見出しを押してから折りたたむまで", elapsed, FOLD_LIMIT_MS);
  });

  test(`⑥ 控えの艦を札の列に落としてから移るまで ${DROP_LIMIT_MS} ms 以内`, async ({ page }) => {
    // 準備：控えの先頭の艦のドラッグを始め、連合艦隊の見出しの上へ
    await openAssignScreen(page);
    const card = trayCards(page).first();
    const uid = await card.getAttribute("data-ship-uid");
    if (uid === null) throw new Error("艦カードに data-ship-uid がない");
    const rengo = columnOf(page, "連合艦隊");
    await startDrag(page, card);
    await dragOver(page, rengo.getByRole("heading", { name: "連合艦隊", exact: true }));
    await expect(rengo, "前提：ドラッグが始まっていること").toHaveAttribute("data-drop-highlight", "true");

    // 実行
    const elapsed = await measure(
      page,
      () => drop(page),
      (shipUid) => {
        const column = [...document.querySelectorAll("section")].find(
          (section) => section.querySelector("h2")?.textContent === "連合艦隊",
        );
        return [...(column?.querySelectorAll<HTMLElement>("[data-ship-uid]") ?? [])].some(
          (element) => element.dataset.shipUid === shipUid,
        );
      },
      uid,
    );

    // 検証
    await expect(cardIn(rengo, uid)).toBeVisible();
    report("⑥ 落としてから札の列に移るまで", elapsed, DROP_LIMIT_MS);
  });
});

test.describe(`割り振り画面を ${TOTAL} 隻で使う（仮想スクロールでも崩れない）`, () => {
  test("控えをスクロールした途中でも、一番上に区切りの見出しが固定されて見える", async ({ page }) => {
    // 準備：並び順「Lv」（5 区切り・113〜114 隻ずつ）
    await openAssignScreen(page);
    await trayOf(page).getByRole("combobox", { name: "並び順" }).selectOption({ label: "Lv" });
    await expect(groupHeaderOf(page, "Lv 140 以上")).toBeVisible();

    // 実行：中身の高さの半分ほどまでスクロールする（どれかの区切りの途中）
    await scrollTrayTo(page, 0.45);

    // 検証：スクロールする要素の上端に、区切りの見出しが見えている（艦カードに隠れていない）
    const pinned = await trayOf(page).evaluate((tray) => {
      const list = [tray, ...tray.querySelectorAll<HTMLElement>("*")]
        .filter((element) => {
          const { overflowY } = getComputedStyle(element);
          return (overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight + 1;
        })
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (list === undefined) return null;
      const top = list.getBoundingClientRect().top;
      for (const header of list.querySelectorAll<HTMLElement>("button[aria-expanded]:not([aria-pressed])")) {
        const rect = header.getBoundingClientRect();
        if (rect.height === 0 || Math.abs(rect.top - top) > 4) continue;
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (hit !== null && header.contains(hit)) return header.textContent?.trim() ?? "";
      }
      return null;
    });
    expect(pinned, "スクロールする要素の上端に、区切りの見出しが見えていること").not.toBeNull();
    expect(pinned).toMatch(/Lv \d+ 以上/);
  });

  test("控えの艦を押して開いたカードは、すぐ下の艦カードと重ならない（行の高さの変化を仮想スクロールが拾う）", async ({
    page,
  }) => {
    // 準備：表示を「カード」にする
    await openAssignScreen(page);
    await trayOf(page).getByRole("group", { name: "表示の詰め具合" }).getByRole("button", { name: "カード" }).click();
    const card = trayCards(page).first();
    const uid = await card.getAttribute("data-ship-uid");
    if (uid === null) throw new Error("艦カードに data-ship-uid がない");

    // 実行：開く
    await card.click();
    await expect(cardIn(trayOf(page), uid)).toHaveAttribute("aria-expanded", "true");

    // 検証：開いたカードの下端が、すぐ下の艦カードの上端より上にある（描き直しが落ち着くまで待つ）
    await expect
      .poll(
        () =>
          trayOf(page).evaluate((tray, openedUid) => {
            const cards = [...tray.querySelectorAll<HTMLElement>("[data-ship-uid]")];
            const opened = cards.find((element) => element.dataset.shipUid === openedUid);
            if (opened === undefined) return "開いたカードが見つからない";
            const bottom = opened.getBoundingClientRect().bottom;
            const below = cards
              .filter((element) => element !== opened)
              .map((element) => element.getBoundingClientRect())
              .filter((rect) => rect.height > 0 && rect.top >= opened.getBoundingClientRect().top + 1)
              .sort((a, b) => a.top - b.top)[0];
            if (below === undefined) return "すぐ下の艦カードが見つからない";
            return below.top >= bottom - 1 ? "重なっていない" : `重なっている（開いたカードの下端 ${bottom}・下のカードの上端 ${below.top}）`;
          }, uid),
        { timeout: 5_000 },
      )
      .toBe("重なっていない");
  });
});
