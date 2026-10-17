import { expect, type Locator, type Page, test } from "@playwright/test";
import { summer2026Assignments, summer2026MasterEntries, summer2026Ships } from "../src/test/fixtures";

// 設定の「文字の大きさ」と画面モード（roadmap T2-12、要件 3.6、PR-08 のレビュー P7・B1）を、ビルドした静的書き出しで確かめる
//
// - 設定のウィンドウで「大」とライトを選んで再読み込みしても、<html data-font-size="large"> と data-theme="light" が保たれる
// - 割り振り（/assign）・一覧（/list）の艦名の文字の大きさ（計算値）が、標準のときより大きくなる
//   （theme.css の --font-scale を、一覧・割り振りの CSS が calc(Npx * var(--font-scale)) で使う）
//
// 前提（e2e/list-export.spec.ts にならう）
// - public/data/latest-definition.json はテスト用の 2026夏イベの定義。艦船マスタはテスト用の仮マスタの応答に差し替える
// - 取り込んだ艦と割り当ては、一覧の画面がブラウザ内の保存（IndexedDB「fudawari」）を作った後で、その表に直接入れる
// - 初霜改二（個体 ID hatsushimo）は第三十一戦隊に割り当ててある（summer2026Assignments）。札の列・一覧の札の行に出る
// テストごとにブラウザのコンテキストが分かれるため、ブラウザ内の保存（IndexedDB・localStorage）は毎回空から始まる

const EVENT_ID = "2026-summer";
const SHIP_MASTER = "/data/ship-master.json";
/** 2026夏イベの開催中の時刻（ほかの画面テストと同じ） */
const WHILE_RUNNING = new Date("2026-10-16T12:00:00+09:00");
/** 取り込んでいないときの案内 */
const NOT_IMPORTED = /艦娘を取り込んでいません/;
/** 大きさを測る艦 */
const SHIP_UID = "hatsushimo";
const SHIP_NAME = "初霜改二";
const FUDA_NAME = "第三十一戦隊";

/** 艦船マスタの取得を、テスト用の仮マスタの応答に差し替える */
async function routeShipMaster(page: Page): Promise<void> {
  await page.route(`**${SHIP_MASTER}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ schemaVersion: 1, ships: summer2026MasterEntries }),
    }),
  );
}

/** 取り込んだ艦（テスト用の 31 隻）と最新イベントの割り当てを、ブラウザ内の保存に入れる（先に一覧を開いて表を作らせる） */
async function seedPlan(page: Page): Promise<void> {
  await page.goto("/list");
  await expect(page.getByText(NOT_IMPORTED)).toBeVisible();
  await page.evaluate(
    async ({ ships, assignments, eventId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("fudawari");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["ships", "importRecords", "assignments"], "readwrite");
        for (const ship of ships) tx.objectStore("ships").put(ship);
        tx.objectStore("importRecords").put({
          id: "last",
          importedAt: "2026-10-16T21:00:00.000+09:00",
          filter: { lockedOnly: false, minLevel: 1 },
          shipCount: ships.length,
          hasUid: true,
        });
        tx.objectStore("assignments").put({ eventId, assignments });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { ships: summer2026Ships, assignments: summer2026Assignments, eventId: EVENT_ID },
  );
}

/** ブラウザ内の保存（IndexedDB「fudawari」の settings の表）に、文字の大きさ・画面モードが保存されたか */
async function savedDisplaySettings(page: Page): Promise<{ fontSize: unknown; themeMode: unknown } | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fudawari");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const request = db.transaction("settings", "readonly").objectStore("settings").getAll();
        request.onsuccess = () => resolve(request.result as unknown[]);
        request.onerror = () => reject(request.error);
      });
      // 行の形は src/lib/storage/storage.ts の版 1（{ id: "settings", values: 保存した項目 }）
      const values = (rows[0] as { values?: { fontSize?: unknown; themeMode?: unknown } } | undefined)?.values;
      return values === undefined ? null : { fontSize: values.fontSize, themeMode: values.themeMode };
    } finally {
      db.close();
    }
  });
}

/** 割り振りの画面の、札の列にいる初霜改二の艦名 */
function assignShipName(page: Page): Locator {
  return page
    .getByRole("region", { name: FUDA_NAME, exact: true })
    .locator(`[data-ship-uid="${SHIP_UID}"]`)
    .getByText(SHIP_NAME, { exact: true });
}

/** 一覧の画面の、札の行にいる初霜改二の艦名 */
function listShipName(page: Page): Locator {
  return page.getByRole("region", { name: FUDA_NAME }).getByText(SHIP_NAME, { exact: true });
}

/** 要素の文字の大きさの計算値（px） */
async function computedFontSize(locator: Locator): Promise<number> {
  return locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
}

/** 割り振りの画面を開き、初霜改二の艦名の文字の大きさを測る */
async function measureOnAssign(page: Page): Promise<number> {
  await page.goto("/assign");
  const name = assignShipName(page);
  await expect(name).toBeVisible();
  return computedFontSize(name);
}

/** 一覧の画面を開き、初霜改二の艦名の文字の大きさを測る */
async function measureOnList(page: Page): Promise<number> {
  await page.goto("/list");
  const name = listShipName(page);
  await expect(name).toBeVisible();
  return computedFontSize(name);
}

/**
 * 設定のウィンドウの radiogroup で選択肢を選ぶ。見た目の選択肢（radio の名前になっている文字）を押し、選ばれたことを確かめる
 * （radio の入力そのものは見えなくして、文字の部分をボタンの形に見せているため）
 */
async function chooseOption(dialog: Locator, group: string, option: string): Promise<void> {
  const radiogroup = dialog.getByRole("radiogroup", { name: group });
  await radiogroup.getByText(option, { exact: true }).click();
  await expect(radiogroup.getByRole("radio", { name: option, exact: true })).toBeChecked();
}

test.describe("設定の文字の大きさ", () => {
  // 一覧と割り振りを 2 回ずつ開くため、既定の 30 秒より長くする
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(WHILE_RUNNING);
    await routeShipMaster(page);
  });

  test("設定で「大」とライトを選んで再読み込みしても data-font-size=large・data-theme=light が保たれ、割り振り・一覧の艦名の文字が標準より大きい", async ({
    page,
  }) => {
    // 準備：艦と割り当てを入れ、標準の文字の大きさを測る
    await seedPlan(page);
    const standardOnList = await measureOnList(page);
    const standardOnAssign = await measureOnAssign(page);

    // 実行：割り振りの画面で設定のウィンドウを開き、ライトと「大」を選んで閉じる
    await page.getByRole("navigation", { name: "メインメニュー" }).getByRole("button", { name: "設定", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "設定" });
    await expect(dialog).toBeVisible();
    await chooseOption(dialog, "画面モード", "ライト");
    await chooseOption(dialog, "文字の大きさ", "大");
    await expect.poll(() => savedDisplaySettings(page)).toEqual({ fontSize: "large", themeMode: "light" });
    await dialog.getByRole("button", { name: "閉じる" }).first().click();
    await expect(dialog).toBeHidden();

    // 実行：再読み込みする
    await page.reload();

    // 検証：文字の大きさと画面モードが保たれている
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-font-size", "large");
    await expect(html).toHaveAttribute("data-theme", "light");

    // 検証：割り振りの艦名の文字が、標準のときより大きい
    const name = assignShipName(page);
    await expect(name).toBeVisible();
    const largeOnAssign = await computedFontSize(name);
    expect(largeOnAssign, `割り振りの艦名：標準 ${standardOnAssign}px → 大 ${largeOnAssign}px`).toBeGreaterThan(
      standardOnAssign,
    );

    // 検証：一覧の艦名の文字も、標準のときより大きい
    const largeOnList = await measureOnList(page);
    expect(largeOnList, `一覧の艦名：標準 ${standardOnList}px → 大 ${largeOnList}px`).toBeGreaterThan(standardOnList);
    await expect(html).toHaveAttribute("data-font-size", "large");
    await expect(html).toHaveAttribute("data-theme", "light");
  });
});
