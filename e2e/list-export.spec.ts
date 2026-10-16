import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { summer2026Assignments, summer2026MasterEntries, summer2026Ships } from "../src/test/fixtures";

// 一覧と画像で保存（roadmap T2-9・T2-10、PR-07）を、ビルドした静的書き出しで確かめる
//
// 前提
// - public/data/latest-definition.json はテスト用の 2026夏イベの定義（札：s31・tago・rengo・ulithi・sixth）。
// - 艦船マスタ（/data/ship-master.json）はビルド時にゲームのデータから作るため、艦 ID が変わってもよいよう、
//   テスト用の仮マスタ（src/test/fixtures）の応答に差し替える。
// - 取り込みの画面はまだないため、取り込んだ艦と割り当ては、一覧の画面がブラウザ内の保存（IndexedDB「fudawari」）を
//   作った後で、その表（ships・importRecords・assignments）に直接入れる（形は src/lib/storage/storage.ts の版 1）。

const EVENT_ID = "2026-summer";
const EVENT_NAME = "2026夏イベ";
const SHIP_MASTER = "/data/ship-master.json";
/** 2026夏イベの開催中の時刻（ほかの画面テストと同じ） */
const WHILE_RUNNING = new Date("2026-10-16T12:00:00+09:00");
/** 取り込んでいないときの案内 */
const NOT_IMPORTED = /艦娘を取り込んでいません/;

/** 画面名（h1）を含むヘッダー帯 */
function headerOf(page: Page, heading: string): Locator {
  return page
    .locator("header")
    .filter({ has: page.getByRole("heading", { level: 1, name: heading, exact: true }) });
}

/** 画像で保存のウィンドウ */
function exportDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "画像で保存" });
}

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

/**
 * 取り込んだ艦（テスト用の 31 隻）と、最新イベントの割り当て（一覧の割り当て）をブラウザ内の保存に入れて、一覧を開き直す。
 * 先に一覧を開いて、アプリにブラウザ内の保存（表）を作らせてから入れる
 */
async function seedPlanAndOpenList(page: Page): Promise<void> {
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

  await page.reload();
  await expect(page.getByRole("region", { name: "連合艦隊" })).toContainText(/8\s*隻\s*・\s*特効\s*8\s*隻/);
}

/** PNG のファイルの幅と高さ（IHDR の値）。PNG でなければ null */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte)) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test.describe("一覧と画像で保存", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(WHILE_RUNNING);
    await routeShipMaster(page);
  });

  test("取り込み・割り当てのある一覧を開き、画像で保存のウィンドウで札を選んで保存すると、1600×900 の PNG がダウンロードされる", async ({
    page,
  }) => {
    // 準備：取得したリクエストを記録する
    const requestedUrls: string[] = [];
    page.on("request", (request) => requestedUrls.push(request.url()));
    await seedPlanAndOpenList(page);

    // 実行：画像で保存のウィンドウを開き、「札を選ぶ」で第六艦隊を外す
    await headerOf(page, "札割り一覧").getByRole("button", { name: "画像で保存", exact: true }).click();
    const dialog = exportDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("radio", { name: "札を選ぶ" }).check();
    await dialog.getByRole("checkbox", { name: "第六艦隊" }).uncheck();
    await expect(dialog).toContainText(/4\s*札\s*→\s*1\s*枚/);

    // 実行：PNG で保存する
    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "PNGで保存", exact: true }).click();
    const download = await downloadPromise;

    // 検証：ファイル名と、中身が 1600×900 の PNG であること
    expect(download.suggestedFilename()).toBe(`${EVENT_NAME}_札割り.png`);
    const path = await download.path();
    expect(pngSize(await readFile(path))).toEqual({ width: 1600, height: 900 });

    // 検証：一般の画面なので Supabase には通信しない
    expect(requestedUrls.filter((url) => new URL(url).hostname.includes("supabase"))).toEqual([]);
  });

  test("Clipboard API に対応したブラウザ（Chromium）では、画像で保存のウィンドウに「画像をコピー」を出す", async ({ page }) => {
    // 準備
    await seedPlanAndOpenList(page);

    // 実行
    await headerOf(page, "札割り一覧").getByRole("button", { name: "画像で保存", exact: true }).click();

    // 検証
    const dialog = exportDialog(page);
    await expect(dialog.getByRole("button", { name: "画像をコピー", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "PNGで保存", exact: true })).toBeVisible();
  });

  test("Clipboard API に対応していないブラウザ（ClipboardItem がない）では、「画像をコピー」を出さない（保存はできる）", async ({
    page,
  }) => {
    // 準備：ページのスクリプトより先に ClipboardItem を消す
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, "ClipboardItem");
    });
    await seedPlanAndOpenList(page);

    // 実行
    await headerOf(page, "札割り一覧").getByRole("button", { name: "画像で保存", exact: true }).click();

    // 検証
    const dialog = exportDialog(page);
    await expect(dialog.getByRole("button", { name: "PNGで保存", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "画像をコピー", exact: true })).toHaveCount(0);
  });
});
