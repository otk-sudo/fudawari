import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  ASSIGN_PATH,
  cardIn,
  columnOf,
  dragAndDrop,
  dragOver,
  drop,
  panelOf,
  routeLatestData,
  seedPlan,
  shipCountPattern,
  trayOf,
  undoButtonOf,
} from "../src/test/assign-e2e";
import {
  createBulkShips,
  summer2026Assignments,
  summer2026Definition,
  summer2026MasterEntries,
  summer2026Ships,
} from "../src/test/fixtures";

// 割り振り画面の UI／UX レビュー（2026-10-19）の指摘の先に書いたテスト（TDD の Red）。直し方は親が決めた（ユーザーの承認済み）。
//
// 【高1】控えで艦カードを開いてから閉じる（「×」〔選択をやめる〕・同じ艦をもう一度押す）と、控えが勝手にスクロールして、
//   その艦の名前の行が固定した区切りの見出しの下に隠れる。見えている位置をつかむと見出しを拾い、別の艦が動く。
//   → 閉じた後も、その艦の名前の行は固定した見出しに隠れず見えている（控えのスクロール領域に scroll-padding-top〔固定した
//     見出しの高さ〕、またはカードに scroll-margin-top の想定）。
//   勝手なスクロールは、閉じたときにカードへフォーカスが移る（×）・押したカードにフォーカスが来る（もう一度押す）ときに、
//   ブラウザがカードを一覧の上端にそろえて見せるために起きる（固定した見出しの高さを考えない）。
//   本番ではテスト用データより特効の段階が多く、開いたカードが控えの一覧より高いのでそのまま起きた。テスト用データの艦は開いても
//   一覧より低いので、開いた後に一覧を少しスクロールして「開いたカードの上端が一覧の上端より上にある」（倍率を読もうとして
//   スクロールした）状態を作ってから閉じる。
// 【高3】「ここに置く」やドラッグで札へ移したら、その艦のカードは閉じる（開いた状態を残さない）。
//   続けて置いても「特効を表示中：n隻」が増え続けず、札の列も開いたカードで伸び続けない。
//   要件 3.3「開いたカードは、別の艦を選んでも閉じない」はそのまま（単体テスト AssignScreen.place-close.test.tsx）
// 【中4】割り振り画面で、ヘッダー（元に戻す・一覧で確認）と選んだ艦のパネルがページと一緒に流れる。
//   → ヘッダーを固定（sticky）し、選んだ艦のパネルは sticky＋max-height（画面の高さ）＋中でスクロール。
//   1366×768 で艦を選び、ページを下までスクロールしても、ヘッダーと、パネルの艦名・×・最初の「〇〇に置く」が画面の中に見えている
//   （ほかの要素〔固定したヘッダーなど〕に隠れていない）
// 【中12 の割り振りの分】艦を選んだとき、置けない・特効のない札の列を opacity で全体ごと薄くしていて、文字のコントラストが約 2:1。
//   → opacity で全体を薄くせず、背景や枠だけを抑え、文字は 4.5:1 以上。11px の文字は 12px 以上（calc(12px * var(--font-scale))）。
//   ダーク・ライトの両方で、艦を選んだときの札の列の見出しの文字（札名・段階の行）と「ここに置く」の文字と背景の
//   コントラスト比が 4.5 以上（WCAG の相対輝度。祖先の背景を重ね、祖先の opacity も掛けて実際の見え方で測る）
//
// 段階名の作り方（海域＋段階名）は別の作業で変わるので、段階名の文字では探さない（札の列の見出しの中の文字の要素をすべて測る）。
// 艦の入れ方は e2e/assign-many-ships.spec.ts と同じ（routeLatestData・seedPlan）。

test.beforeEach(async ({ page }) => {
  await routeLatestData(page);
});

// ---- 共通の補助 ----

/** 控えに描いている艦カード */
function trayCards(page: Page): Locator {
  return trayOf(page).locator("[data-ship-uid]");
}

/** 割り振り画面を開き、控えに艦カードが見えるまで待つ */
async function openAssignScreen(page: Page): Promise<void> {
  await page.goto(ASSIGN_PATH);
  await trayCards(page).first().waitFor({ state: "visible" });
}

/** 描き直しを 2 フレーム待つ */
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** ページのいちばん下までスクロールし、スクロールした量を返す（描き直しを 2 フレーム待つ） */
async function scrollToBottom(page: Page): Promise<number> {
  return page.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return window.scrollY;
  });
}

/**
 * 要素が画面の中に見えていて、ほかの要素に隠れていないか（中ほどの点で document.elementFromPoint が要素自身か中の要素を返す）。
 * 見えていれば "見えている"、見えていなければ理由の文を返す（expect.poll で待てるように、文で返す）
 */
async function visibilityOf(target: Locator): Promise<string> {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const where = `上端 ${Math.round(rect.top)}px・下端 ${Math.round(rect.bottom)}px／画面 ${window.innerHeight}px`;
    if (rect.height === 0 || rect.width === 0) return `大きさが 0（${where}）`;
    if (rect.top < 0 || rect.bottom > window.innerHeight) return `画面の外にはみ出している（${where}）`;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (hit === null || !element.contains(hit)) {
      return `ほかの要素に隠れている（${where}。中ほどで拾ったのは「${(hit?.textContent ?? "").trim().slice(0, 20)}」）`;
    }
    return "見えている";
  });
}

// ---- 【高1】開いて閉じた後も、その艦の名前の行が固定した見出しに隠れない ----

test.describe("【高1】控えで艦カードを開いてから閉じても、その艦の名前の行は固定した区切りの見出しに隠れない", () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  /** 600 隻（全艦が控え） */
  const SHIPS = createBulkShips(600);
  /** 個体 ID → 艦名（テスト用データのマスタで引く） */
  const NAME_BY_UID = new Map(
    SHIPS.map((ship) => [ship.uid, summer2026MasterEntries.find((entry) => entry.id === ship.shipId)?.name ?? ""]),
  );

  /** 控えの一覧（スクロールする role="tabpanel"） */
  function trayListOf(page: Page): Locator {
    return trayOf(page).getByRole("tabpanel");
  }

  /**
   * 並び順「Lv」で控えの一覧を区切りの途中までスクロールし（一番上に区切りの見出しが固定される）、
   * 固定した見出しより下にすっかり見えている艦カードを 1 枚選んで、その個体 ID を返す
   */
  async function prepareStickyScene(page: Page): Promise<string> {
    await seedPlan(page, { ships: SHIPS, assignments: {} });
    await openAssignScreen(page);
    await trayOf(page).getByRole("combobox", { name: "並び順" }).selectOption({ label: "Lv" });
    await expect(trayListOf(page).locator("button[aria-expanded]:not([aria-pressed])").first()).toContainText(/Lv \d+ 以上/);
    // 「Lv 140 以上」の区切り（113 隻ほど）の途中
    await trayListOf(page).evaluate((list) => {
      list.scrollTop = 1000;
    });
    await nextFrames(page);

    const scene = await trayListOf(page).evaluate((list) => {
      const listTop = list.getBoundingClientRect().top;
      const header = [...list.querySelectorAll<HTMLElement>("button[aria-expanded]:not([aria-pressed])")].find(
        (element) => {
          const rect = element.getBoundingClientRect();
          if (rect.height === 0 || Math.abs(rect.top - listTop) > 4) return false;
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return hit !== null && element.contains(hit);
        },
      );
      if (header === undefined) return null;
      const headerBottom = header.getBoundingClientRect().bottom;
      const card = [...list.querySelectorAll<HTMLElement>("[data-ship-uid]")]
        .filter((element) => element.getBoundingClientRect().top >= headerBottom + 40)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      return card === undefined ? null : (card.dataset.shipUid ?? null);
    });
    if (scene === null) throw new Error("前提：控えの一覧の一番上に区切りの見出しが固定され、その下に艦カードが見えていること");
    return scene;
  }

  /** 艦カードを開き、開いたカードの上端が一覧の上端より 20px 上に来るまで一覧をスクロールする（名前の行は上に隠れる） */
  async function openAndScrollPast(page: Page, uid: string): Promise<void> {
    const card = cardIn(trayOf(page), uid);
    await card.click();
    await expect(card).toHaveAttribute("aria-expanded", "true");
    await trayListOf(page).evaluate((list, id) => {
      const target = [...list.querySelectorAll<HTMLElement>("[data-ship-uid]")].find((element) => element.dataset.shipUid === id);
      if (target === undefined) throw new Error("開いたカードが描かれていない");
      list.scrollTop += target.getBoundingClientRect().top - list.getBoundingClientRect().top + 20;
    }, uid);
    await nextFrames(page);
  }

  /** 艦カードの中の艦名の要素（名前の行） */
  function nameRowOf(page: Page, uid: string): Locator {
    const name = NAME_BY_UID.get(uid);
    if (name === undefined || name === "") throw new Error(`テスト用データに ${uid} の艦名がない`);
    return cardIn(trayOf(page), uid).getByText(name, { exact: true });
  }

  /**
   * 名前の行が、固定した区切りの見出しに重ならず、一覧の中に見えているか（中ほどの点で拾うのがその艦のカード）。
   * 見えていれば "見えている"、見えていなければ理由の文を返す
   */
  async function nameRowState(page: Page, uid: string): Promise<string> {
    const nameRow = nameRowOf(page, uid);
    if ((await nameRow.count()) === 0) return "名前の行が描かれていない";
    return nameRow.evaluate((element, id) => {
      const list = element.closest<HTMLElement>('[role="tabpanel"]');
      if (list === null) return "控えの一覧の外にある";
      const listRect = list.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const header = [...list.querySelectorAll<HTMLElement>("button[aria-expanded]:not([aria-pressed])")].find(
        (button) => {
          const box = button.getBoundingClientRect();
          return box.height > 0 && Math.abs(box.top - listRect.top) <= 4;
        },
      );
      const headerBottom = header?.getBoundingClientRect().bottom ?? listRect.top;
      const where = `名前の行 ${Math.round(rect.top - listRect.top)}〜${Math.round(rect.bottom - listRect.top)}px・固定した見出しの下端 ${Math.round(headerBottom - listRect.top)}px・一覧の高さ ${Math.round(listRect.height)}px（一覧の上端から）`;
      if (rect.top < headerBottom - 1) return `固定した見出しに重なっている（${where}）`;
      if (rect.bottom > listRect.bottom + 1) return `一覧の下にはみ出している（${where}）`;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const card = hit?.closest<HTMLElement>("[data-ship-uid]");
      if (card?.dataset.shipUid !== id) {
        return `中ほどで拾うのがその艦のカードではない（${where}。拾ったのは「${(hit?.textContent ?? "").trim().slice(0, 20)}」）`;
      }
      return "見えている";
    }, uid);
  }

  test("開いて「×」（選択をやめる）で閉じた後、その艦の名前の行は固定した見出しに隠れず見えている", async ({ page }) => {
    // 準備
    const uid = await prepareStickyScene(page);
    await openAndScrollPast(page, uid);

    // 実行
    await panelOf(page).getByRole("button", { name: "選択をやめる", exact: true }).click();

    // 検証
    await expect(panelOf(page)).toHaveCount(0);
    await expect.poll(() => nameRowState(page, uid), { timeout: 3_000 }).toBe("見えている");
  });

  test("開いて同じ艦をもう一度押して閉じた後、その艦の名前の行は固定した見出しに隠れず見えている", async ({ page }) => {
    // 準備
    const uid = await prepareStickyScene(page);
    await openAndScrollPast(page, uid);

    // 実行：もう一度押す。Playwright の click は、押す前にカード全体を一覧の中に入れる（ブラウザのスクロールで入れるので、
    // キーボードでカードにフォーカスを移したときと同じく、固定した見出しの高さを考えずにカードの上端を一覧の上端にそろえる）。
    // マウスで見えている所をそのまま押す（座標で押す）と、今の実装でもスクロールは起きない（名前の行は上に隠れたまま閉じる）
    await cardIn(trayOf(page), uid).click();

    // 検証
    await expect(cardIn(trayOf(page), uid)).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => nameRowState(page, uid), { timeout: 3_000 }).toBe("見えている");
  });

  test("開いて「×」で閉じた後、見えている名前の行をつかんで札の列へドラッグすると、その艦が動く", async ({ page }) => {
    // 準備
    const uid = await prepareStickyScene(page);
    await openAndScrollPast(page, uid);
    await panelOf(page).getByRole("button", { name: "選択をやめる", exact: true }).click();
    await expect(panelOf(page)).toHaveCount(0);
    await nextFrames(page);
    const nameBox = await nameRowOf(page, uid).boundingBox();
    if (nameBox === null) throw new Error("名前の行が見えていない");
    const start = { x: nameBox.x + Math.min(20, nameBox.width / 2), y: nameBox.y + nameBox.height / 2 };
    const rengo = columnOf(page, "連合艦隊");

    // 実行：名前の行の位置を押してドラッグを始め、連合艦隊の見出しの上で離す
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 12, start.y, { steps: 4 });
    await dragOver(page, rengo.getByRole("heading", { name: "連合艦隊", exact: true }));
    await drop(page);

    // 検証：その艦（ほかの艦ではない）が連合艦隊へ移った
    await expect(cardIn(rengo, uid)).toBeVisible();
    await expect(rengo).toContainText(shipCountPattern(1));
  });
});

// ---- 【高3】札へ移したら、その艦のカードは閉じる ----

test.describe("【高3】「ここに置く」やドラッグで札へ移したら、その艦のカードは閉じる", () => {
  /** 札の列が 5 つとも、スクロールせずに見える大きさ */
  test.use({ viewport: { width: 1920, height: 1080 } });

  /** 「特効を表示中：n隻」の帯の文 */
  function openBandOf(page: Page): Locator {
    return trayOf(page).getByText(/特効を表示中/);
  }

  test.beforeEach(async ({ page }) => {
    await seedPlan(page, { ships: createBulkShips(600), assignments: {} });
  });

  test("控えの艦を 8 隻続けて「ここに置く」で連合艦隊へ置いても、「特効を表示中」は出ず、列は開いたカードで伸びない", async ({
    page,
  }) => {
    // 準備
    await openAssignScreen(page);
    const rengo = columnOf(page, "連合艦隊");
    const columnHeight = async (): Promise<number> => (await rengo.boundingBox())?.height ?? 0;
    const heights = [await columnHeight()];

    for (let placed = 1; placed <= 8; placed += 1) {
      // 実行：控えの先頭の艦を選び、連合艦隊の「ここに置く」で置く
      const card = trayCards(page).first();
      const uid = await card.getAttribute("data-ship-uid");
      if (uid === null) throw new Error("艦カードに data-ship-uid がない");
      await card.click();
      await expect(cardIn(trayOf(page), uid)).toHaveAttribute("aria-pressed", "true");
      await rengo.getByRole("button", { name: /^ここに置く/ }).click();
      await expect(rengo).toContainText(shipCountPattern(placed));

      // 検証：置いた艦のカードは閉じ、「特効を表示中」の帯は出ない
      await expect(cardIn(rengo, uid), `${placed} 隻目のカード`).toHaveAttribute("aria-expanded", "false");
      await expect(openBandOf(page), `${placed} 隻目を置いた後`).toHaveCount(0);
      heights.push(await columnHeight());
    }

    // 検証：列は 1 隻置くごとに閉じたカード 1 枚分ずつ伸びる（開いたカードの倍率の行で余分に伸びない）
    const steps = heights.slice(1).map((height, index) => Math.round(height - (heights[index] ?? 0)));
    const description = `連合艦隊の列の高さ ${heights.map(Math.round).join(" → ")}px（1 隻ごとの伸び ${steps.join("・")}px）`;
    test.info().annotations.push({ type: "計測", description });
    expect(Math.max(...steps) - Math.min(...steps.slice(1)), description).toBeLessThanOrEqual(1);
    await expect(rengo.locator('[data-ship-uid][aria-expanded="true"]')).toHaveCount(0);
  });

  test("開いた控えの艦をドラッグして札の列へ落とすと、その艦のカードは閉じ、「特効を表示中」は出ない", async ({ page }) => {
    // 準備：控えの先頭の艦を選んで開く
    await openAssignScreen(page);
    const card = trayCards(page).first();
    const uid = await card.getAttribute("data-ship-uid");
    if (uid === null) throw new Error("艦カードに data-ship-uid がない");
    await card.click();
    await expect(cardIn(trayOf(page), uid)).toHaveAttribute("aria-expanded", "true");
    const rengo = columnOf(page, "連合艦隊");

    // 実行
    await dragAndDrop(page, cardIn(trayOf(page), uid), rengo.getByRole("heading", { name: "連合艦隊", exact: true }));

    // 検証
    await expect(cardIn(rengo, uid)).toBeVisible();
    await expect(cardIn(rengo, uid)).toHaveAttribute("aria-expanded", "false");
    await expect(openBandOf(page)).toHaveCount(0);
  });
});

// ---- 【中4】ヘッダーと選んだ艦のパネルを画面に留める ----

test.describe("【中4】1366×768 で艦を選んでページを下までスクロールしても、ヘッダーと選んだ艦のパネルが見えている", () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test("ヘッダーの「元に戻す」「一覧で確認」と、パネルの艦名・「×」・最初の「〇〇に置く」が画面の中に見えている", async ({ page }) => {
    // 準備：テスト用データの割り当て（札の列が 2 段になり、ページが縦にスクロールする）で、控えの利根改二を選ぶ
    await seedPlan(page, { ships: summer2026Ships, assignments: summer2026Assignments });
    await openAssignScreen(page);
    await cardIn(trayOf(page), "tone").click();
    const panel = panelOf(page);
    await expect(panel.getByRole("heading", { name: "利根改二", exact: true })).toBeVisible();

    // 実行
    const scrolled = await scrollToBottom(page);
    expect(scrolled, "前提：ページがスクロールした量").toBeGreaterThan(0);

    // 検証
    const targets: [string, Locator][] = [
      ["ヘッダーの「元に戻す」", undoButtonOf(page)],
      ["ヘッダーの「一覧で確認」", page.locator("header").getByRole("link", { name: "一覧で確認", exact: true })],
      ["パネルの艦名", panel.getByRole("heading", { name: "利根改二", exact: true })],
      ["パネルの「×」", panel.getByRole("button", { name: "選択をやめる", exact: true })],
      ["パネルの最初の「〇〇に置く」", panel.getByRole("button", { name: /に置く$/ }).first()],
    ];
    for (const [label, target] of targets) {
      await expect.poll(() => visibilityOf(target), { message: label, timeout: 2_000 }).toBe("見えている");
    }
  });

  test("パネルは画面の高さに収まる（上端が画面の上端より下、下端が画面の下端より上）", async ({ page }) => {
    // 準備
    await seedPlan(page, { ships: summer2026Ships, assignments: summer2026Assignments });
    await openAssignScreen(page);
    await cardIn(trayOf(page), "tone").click();
    await expect(panelOf(page)).toBeVisible();

    // 実行
    const scrolled = await scrollToBottom(page);
    expect(scrolled, "前提：ページがスクロールした量").toBeGreaterThan(0);

    // 検証
    const edges = await panelOf(page).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, viewport: window.innerHeight };
    });
    const description = `パネルの上端 ${Math.round(edges.top)}px・下端 ${Math.round(edges.bottom)}px／画面 ${edges.viewport}px`;
    test.info().annotations.push({ type: "計測", description });
    expect(edges.top, description).toBeGreaterThanOrEqual(0);
    expect(edges.bottom, description).toBeLessThanOrEqual(edges.viewport);
  });
});

// ---- 【中12 の割り振りの分】薄くした札の列の文字のコントラスト ----

/** 測った文字の要素 1 つ */
interface TextSample {
  /** どの札の列のどこか（例「第三十一戦隊（薄い）：見出し」） */
  where: string;
  /** 要素の文字（先頭の 20 文字） */
  text: string;
  /** 文字と背景のコントラスト比（実際の見え方） */
  ratio: number;
  /** 文字の大きさ（px） */
  fontSize: number;
  /** 祖先を含めて掛けた opacity */
  opacity: number;
  /** 祖先に filter があれば、その値（計算に含められないので、あれば失敗にする） */
  filter: string | null;
}

/**
 * 札の列ごとに、見出し（札名・段階の行など、見出しの中で文字を持つ要素すべて）と「ここに置く」の文字を測る（ブラウザで評価する）。
 * 色は canvas に塗って sRGB の値に直す（rgb・color(srgb …)・oklab などの書き方を問わない）。
 * 背景は html から要素まで、祖先の背景色を順に重ねる（最初は白）。opacity は内側の要素から順に、その要素の後ろ（祖先の背景を
 * 重ねたもの）と混ぜる。WCAG 2 の相対輝度でコントラスト比を出す
 */
function sampleColumnTexts(sections: Element[]): TextSample[] {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("canvas が使えない");
  type Rgba = { r: number; g: number; b: number; a: number };
  const parse = (value: string): Rgba => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000";
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const over = (top: Rgba, bottom: Rgba, alpha: number): Rgba => ({
    r: top.r * alpha + bottom.r * (1 - alpha),
    g: top.g * alpha + bottom.g * (1 - alpha),
    b: top.b * alpha + bottom.b * (1 - alpha),
    a: 1,
  });
  const luminance = (color: Rgba): number => {
    const channel = (value: number): number => {
      const v = value / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  };
  const contrast = (a: Rgba, b: Rgba): number => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
  };

  const measure = (element: Element): Omit<TextSample, "where" | "text"> => {
    const chain: Element[] = [];
    for (let node: Element | null = element; node !== null; node = node.parentElement) chain.unshift(node);
    let background: Rgba = { r: 255, g: 255, b: 255, a: 1 };
    // opacity の要素と、その要素の後ろ（祖先の背景を重ねたもの）
    const groups: { opacity: number; backdrop: Rgba }[] = [];
    let filter: string | null = null;
    for (const node of chain) {
      const style = getComputedStyle(node);
      const opacity = Number(style.opacity);
      if (opacity < 1) groups.unshift({ opacity, backdrop: background });
      if (style.filter !== "none" && filter === null) filter = style.filter;
      const color = parse(style.backgroundColor);
      if (color.a > 0) background = over(color, background, color.a);
    }
    const textColor = parse(getComputedStyle(element).color);
    let foreground = over(textColor, background, textColor.a);
    let backgroundSeen = background;
    let opacity = 1;
    for (const group of groups) {
      foreground = over(foreground, group.backdrop, group.opacity);
      backgroundSeen = over(backgroundSeen, group.backdrop, group.opacity);
      opacity *= group.opacity;
    }
    return {
      ratio: Math.round(contrast(foreground, backgroundSeen) * 100) / 100,
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      opacity: Math.round(opacity * 100) / 100,
      filter,
    };
  };

  /** root の中（root を含む）で、自分の直下に空でない文字を持つ要素 */
  const textElements = (root: Element): Element[] =>
    [root, ...root.querySelectorAll("*")].filter((element) =>
      [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== ""),
    );

  const samples: TextSample[] = [];
  for (const section of sections) {
    const heading = section.querySelector("h2");
    const name = heading?.textContent?.trim() ?? "（札名なし）";
    const label = `${name}${section.getAttribute("data-dimmed") === "true" ? "（薄い）" : ""}`;
    const head = heading?.parentElement;
    const parts: [string, Element][] = [];
    if (head !== null && head !== undefined) parts.push(["見出し", head]);
    for (const button of section.querySelectorAll("button")) {
      if ((button.textContent ?? "").trim().startsWith("ここに置く")) parts.push(["ここに置く", button]);
    }
    for (const [part, root] of parts) {
      for (const element of textElements(root)) {
        samples.push({
          where: `${label}：${part}`,
          text: (element.textContent ?? "").trim().slice(0, 20),
          ...measure(element),
        });
      }
    }
  }
  return samples;
}

/** 定義の札の列（名前が札名の region）をすべて */
function allColumns(page: Page): Locator {
  const [first, ...rest] = summer2026Definition.fudas.map((fuda) => columnOf(page, fuda.name));
  if (first === undefined) throw new Error("テスト用データの定義に札がない");
  return rest.reduce((all, column) => all.or(column), first);
}

// 画面モード：既定はダーク（<html data-theme="dark">）。ライトは <html data-theme="light"> を直接付けて確かめる
// （設定のウィンドウでライトを選んだときと同じ属性。ThemeSync は画面モードが変わったときだけ属性を書くので、付けた値は残る）
for (const theme of ["dark", "light"] as const) {
  test.describe(`【中12】${theme === "dark" ? "ダーク" : "ライト"}で艦を選んだとき、札の列の見出しと「ここに置く」の文字が読める`, () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    /** テスト用データの割り当てで開き、控えの利根改二（連合艦隊・ウルシー攻撃部隊で特効あり。ほかの 3 列は薄くなる）を選ぶ */
    async function selectTone(page: Page): Promise<TextSample[]> {
      await seedPlan(page, { ships: summer2026Ships, assignments: summer2026Assignments });
      await openAssignScreen(page);
      const html = page.locator("html");
      await expect(html, "前提：既定の画面モードはダーク").toHaveAttribute("data-theme", "dark");
      if (theme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      await cardIn(trayOf(page), "tone").click();
      await expect(panelOf(page)).toBeVisible();
      // 前提：画面モードと文字の大きさ（標準）
      await expect(html).toHaveAttribute("data-theme", theme);
      await expect(html).not.toHaveAttribute("data-font-size", /small|large/);
      const bodyIsDark = await page.evaluate(() => {
        const match = /\d+(\.\d+)?/g.exec(getComputedStyle(document.body).backgroundColor);
        return match !== null && Number(match[0]) < 128;
      });
      expect(bodyIsDark, "前提：ページの背景が画面モードの色になっている").toBe(theme === "dark");
      // 前提：特効のない札の列は薄い（data-dimmed="true"）
      await expect(page.locator('section[data-dimmed="true"]')).toHaveCount(3);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const columns = allColumns(page);
      await expect(columns).toHaveCount(summer2026Definition.fudas.length);
      return columns.evaluateAll(sampleColumnTexts);
    }

    test("札名・段階の行・「ここに置く」の文字と背景のコントラスト比が 4.5 以上（祖先の opacity も掛けた見え方）", async ({
      page,
    }) => {
      // 準備・実行
      const samples = await selectTone(page);

      // 検証
      expect(samples.some((sample) => sample.where.includes("ここに置く")), "前提：「ここに置く」を測れている").toBe(true);
      const report = samples.map(
        (sample) => `${sample.where}「${sample.text}」 ${sample.ratio}:1（${sample.fontSize}px・opacity ${sample.opacity}）`,
      );
      test.info().annotations.push({ type: "計測", description: report.join("\n") });
      const filtered = samples.filter((sample) => sample.filter !== null);
      expect(filtered.map((sample) => `${sample.where}「${sample.text}」 filter: ${sample.filter}`), "filter で薄くしていない（計算に含められない）").toEqual([]);
      const low = samples.filter((sample) => sample.ratio < 4.5);
      expect(low.map((sample) => `${sample.where}「${sample.text}」 ${sample.ratio}:1（opacity ${sample.opacity}）`)).toEqual([]);
    });

    test("札名・段階の行・「ここに置く」の文字は 12px 以上（標準の文字の大きさ）", async ({ page }) => {
      // 準備・実行
      const samples = await selectTone(page);

      // 検証
      const small = samples.filter((sample) => sample.fontSize < 12);
      expect(small.map((sample) => `${sample.where}「${sample.text}」 ${sample.fontSize}px`)).toEqual([]);
    });
  });
}

// ---- 【中12 の割り振りの分・追加】控えの「条件に合う艦はいません」とパネルの「特効なし：」のコントラスト ----
// 親の追加の決定（2026-10-19）：薄い文字の色（--assign-faint-text。ダーク 3.28・ライト 4.33）をやめ、4.5:1 以上にする。
// 測り方は上の sampleColumnTexts と同じ（祖先の背景を重ね、祖先の opacity も掛けた見え方。WCAG 2 の相対輝度）

/** 要素 1 つの文字と背景のコントラスト比（実際の見え方）。ブラウザで評価する */
function measureTextContrast(element: Element): { ratio: number; fontSize: number } {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("canvas が使えない");
  type Rgba = { r: number; g: number; b: number; a: number };
  const parse = (value: string): Rgba => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000";
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const over = (top: Rgba, bottom: Rgba, alpha: number): Rgba => ({
    r: top.r * alpha + bottom.r * (1 - alpha),
    g: top.g * alpha + bottom.g * (1 - alpha),
    b: top.b * alpha + bottom.b * (1 - alpha),
    a: 1,
  });
  const luminance = (color: Rgba): number => {
    const channel = (value: number): number => {
      const v = value / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  };
  const chain: Element[] = [];
  for (let node: Element | null = element; node !== null; node = node.parentElement) chain.unshift(node);
  let background: Rgba = { r: 255, g: 255, b: 255, a: 1 };
  const groups: { opacity: number; backdrop: Rgba }[] = [];
  for (const node of chain) {
    const style = getComputedStyle(node);
    const opacity = Number(style.opacity);
    if (opacity < 1) groups.unshift({ opacity, backdrop: background });
    const color = parse(style.backgroundColor);
    if (color.a > 0) background = over(color, background, color.a);
  }
  const textColor = parse(getComputedStyle(element).color);
  let foreground = over(textColor, background, textColor.a);
  let backgroundSeen = background;
  for (const group of groups) {
    foreground = over(foreground, group.backdrop, group.opacity);
    backgroundSeen = over(backgroundSeen, group.backdrop, group.opacity);
  }
  const [high, low] = [luminance(foreground), luminance(backgroundSeen)].sort((x, y) => y - x);
  return {
    ratio: Math.round((((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)) * 100) / 100,
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
  };
}

for (const theme of ["dark", "light"] as const) {
  test.describe(`【中12・追加】${theme === "dark" ? "ダーク" : "ライト"}で、控えとパネルの薄い文字が読める`, () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    /** テスト用データで開き、画面モードを決める */
    async function openWithTheme(page: Page): Promise<void> {
      await seedPlan(page, { ships: summer2026Ships, assignments: summer2026Assignments });
      await openAssignScreen(page);
      if (theme === "light") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
    }

    test("控えの「条件に合う艦はいません」の文字と背景のコントラスト比が 4.5 以上", async ({ page }) => {
      // 準備
      await openWithTheme(page);

      // 実行：どの艦にも当たらない文字で検索する
      await trayOf(page).getByRole("searchbox", { name: "図鑑ID・名称で検索" }).fill("該当なしの艦名");
      const empty = trayOf(page).getByText("条件に合う艦はいません", { exact: true });
      await expect(empty).toBeVisible();

      // 検証
      const sample = await empty.evaluate(measureTextContrast);
      test.info().annotations.push({ type: "計測", description: `${sample.ratio}:1（${sample.fontSize}px）` });
      expect(sample.ratio, `${sample.ratio}:1`).toBeGreaterThanOrEqual(4.5);
    });

    test("選んだ艦のパネルの「特効なし：」の文字と背景のコントラスト比が 4.5 以上", async ({ page }) => {
      // 準備
      await openWithTheme(page);

      // 実行：利根改二（第三十一戦隊・多号作戦部隊・第六艦隊で特効なし）を選ぶ
      await cardIn(trayOf(page), "tone").click();
      const none = panelOf(page).getByText(/^特効なし：/);
      await expect(none).toBeVisible();

      // 検証
      const sample = await none.evaluate(measureTextContrast);
      test.info().annotations.push({ type: "計測", description: `${sample.ratio}:1（${sample.fontSize}px）` });
      expect(sample.ratio, `${sample.ratio}:1`).toBeGreaterThanOrEqual(4.5);
    });
  });
}
