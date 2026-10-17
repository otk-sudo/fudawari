// 割り振り画面の画面テスト（Playwright。e2e/assign-dnd.spec.ts・e2e/assign-many-ships.spec.ts）で使う補助（PR-06・T2-8）
//
// - routeLatestData：公開定義と艦船マスタの取得を、テスト用データ（src/test/fixtures。Vitest と同じ）を返す応答に差し替える。
//   艦船マスタはビルドのときに実データから作るので、そのままでは艦名・艦型がテスト用データと合わない
// - seedPlan：ブラウザ内の保存（IndexedDB）に、取り込んだ艦と最新イベントの割り当てを書いておく。
//   取り込みの画面はまだこのブランチにないので、割り振り画面を一度開いてアプリ（Dexie）に DB を作らせてから、
//   アプリと同じ形の行（src/lib/storage/storage.ts のテーブルの行の形）を直接書く。書いた後に開き直すと画面に出る
// - startDrag・dragOver・drop：dnd-kit のドラッグを、マウスの押す・動かす・離すで起こす
// - 部品の探し方：src/test/assign-screen.ts の冒頭の形（region・名前・data-ship-uid・data-drop-highlight など）
//
// Playwright から読むので、Vitest や Testing Library を読み込まない（src/test/assign-screen.ts などは使えない）。
// 別名（@/…）の実行時の import も避ける（テスト用データは型だけの import なので読める）。
import { expect, type Locator, type Page } from "@playwright/test";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import { STORAGE_TABLES } from "../lib/storage/schema";
import { summer2026Definition, summer2026MasterEntries } from "./fixtures";

/** 割り振り画面のパス（src/lib/routes.ts の ROUTES.assign） */
export const ASSIGN_PATH = "/assign";
/** 公開定義の置き場所（src/lib/definition/load.ts の LATEST_DEFINITION_PATH） */
const LATEST_DEFINITION_PATH = "/data/latest-definition.json";
/** 艦船マスタの置き場所（src/lib/ship-master/load.ts の SHIP_MASTER_PATH） */
const SHIP_MASTER_PATH = "/data/ship-master.json";
/** ブラウザ内の保存の DB 名（src/lib/storage/storage.ts の DEFAULT_STORAGE_NAME） */
const STORAGE_NAME = "fudawari";
/** 最終取り込みの行の主キー（src/lib/storage/storage.ts の LAST_IMPORT_ID） */
const LAST_IMPORT_ID = "last";

/** 最新イベントの ID（"2026-summer"） */
export const EVENT_ID = summer2026Definition.event.id;

/**
 * ドラッグを始めるときに、押したまま動かす距離（px）。
 * dnd-kit がクリックとドラッグを見分けるための動き（src/features/assign/useShipDnd.ts の MouseSensor の
 * activationConstraint の distance：5px）より大きくする
 */
const DRAG_START_DISTANCE = 12;

/**
 * 落とした後、次の操作の前に待つ時間（ミリ秒）。
 * dnd-kit の MouseSensor は、離したときに起きるクリック（ドラッグした艦のカードが選ばれてしまう）を捨てるため、
 * 落としてから 50ms の間はページのクリックを止める。その間に「元に戻す」などを押しても効かないので、それより長く待つ
 */
const AFTER_DROP_WAIT_MS = 60;

// ---- 取得の差し替えと保存 ----

/** 公開定義と艦船マスタの取得を、テスト用データを返す応答に差し替える（問い合わせ文字列の有無は問わない） */
export async function routeLatestData(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === LATEST_DEFINITION_PATH,
    (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(summer2026Definition) }),
  );
  await page.route(
    (url) => url.pathname === SHIP_MASTER_PATH,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ schemaVersion: 1, ships: summer2026MasterEntries }),
      }),
  );
}

/** seedPlan に渡すもの */
export interface SeedPlanInput {
  /** 取り込んだ艦の個体 */
  ships: readonly OwnedShip[];
  /** 最新イベント（2026夏イベ）の割り当て */
  assignments: AssignmentMap;
}

/**
 * ブラウザ内の保存に、取り込んだ艦と最新イベントの割り当てを書いておく。
 * 書いた後は割り振り画面（取り込んでいない案内）を開いたままなので、続けて page.goto(ASSIGN_PATH) か page.reload() で開き直す
 */
export async function seedPlan(page: Page, input: SeedPlanInput): Promise<void> {
  // 割り振り画面を開き、取り込んでいない案内が出るまで待つ（札割りのデータを読んだ＝アプリが DB を作った）
  await page.goto(ASSIGN_PATH);
  await expect(page.getByRole("link", { name: "取り込みの画面へ" })).toBeVisible();

  await page.evaluate(
    async ({ storageName, tables, ships, record, assignmentRow }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(storageName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction([tables.ships, tables.importRecords, tables.assignments], "readwrite");
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
          const shipStore = transaction.objectStore(tables.ships);
          for (const ship of ships) shipStore.put(ship);
          transaction.objectStore(tables.importRecords).put(record);
          transaction.objectStore(tables.assignments).put(assignmentRow);
        });
      } finally {
        db.close();
      }
    },
    {
      storageName: STORAGE_NAME,
      tables: STORAGE_TABLES,
      ships: input.ships.map((ship) => ({ ...ship })),
      record: {
        id: LAST_IMPORT_ID,
        importedAt: "2026-10-16T12:00:00.000Z",
        filter: { lockedOnly: false, minLevel: 1 },
        shipCount: input.ships.length,
        hasUid: true,
      },
      assignmentRow: { eventId: EVENT_ID, assignments: { ...input.assignments } },
    },
  );
}

// ---- 部品の探し方 ----

/** 控え（region「控えの艦」） */
export function trayOf(page: Page): Locator {
  return page.getByRole("region", { name: "控えの艦", exact: true });
}

/** 札の列（名前が札名の region） */
export function columnOf(page: Page, fudaName: string): Locator {
  return page.getByRole("region", { name: fudaName, exact: true });
}

/** 選択中の艦のパネル（region「選択中の艦」） */
export function panelOf(page: Page): Locator {
  return page.getByRole("region", { name: "選択中の艦", exact: true });
}

/** container の中の、個体 ID が uid の艦カード（ShipCard の data-ship-uid） */
export function cardIn(container: Locator, uid: string): Locator {
  return container.locator(`[data-ship-uid="${uid}"]`);
}

/** 艦カードを包む li（ドラッグする要素。重ねたときの「⇄ 入れ替え」もこの中に出す） */
export function cardItemOf(card: Locator): Locator {
  return card.locator("xpath=ancestor::li[1]");
}

/** ヘッダーのボタン「元に戻す」 */
export function undoButtonOf(page: Page): Locator {
  return page.locator("header").getByRole("button", { name: "元に戻す", exact: true });
}

/** 「n隻」（前に数字が続かない n。例：8 は「18隻」に当てはまらない） */
export function shipCountPattern(count: number): RegExp {
  return new RegExp(`(?<!\\d)${count}\\s*隻`);
}

/** 控えの見出しの「表示数 / 控えの総数隻」（例「11 / 12隻」） */
export function trayCountPattern(shown: number, total: number): RegExp {
  return new RegExp(`(?<!\\d)${shown}\\s*/\\s*${total}\\s*隻`);
}

// ---- ドラッグ ----

/** 要素の画面上の位置と大きさ（見えていなければテストを失敗させる） */
async function boxOf(target: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error("ドラッグの元・先の要素が画面に見えていない");
  return box;
}

/** 画面上の点（px） */
export interface Point {
  x: number;
  y: number;
}

/**
 * ドラッグを始める：source（艦カード）の中ほどを押し、押したまま少し動かす。
 * 押した点（ドラッグを始める前の source の中ほど）を返す（自分自身に落とすときに、元の位置へ戻すため。
 * ドラッグ中はドラッグした要素が指について動くことがあるので、ドラッグ中に source の位置を測り直さない）
 */
export async function startDrag(page: Page, source: Locator): Promise<Point> {
  const box = await boxOf(source);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + DRAG_START_DISTANCE, start.y, { steps: 4 });
  return start;
}

/** ドラッグしたまま、target の中ほどへ動かす（ドラッグを始める前に target が見えている位置にあること） */
export async function dragOver(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (box === null) throw new Error("ドラッグの先の要素が画面に見えていない");
  await dragOverPoint(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

/** ドラッグしたまま、画面上の点 point へ動かす */
export async function dragOverPoint(page: Page, point: Point): Promise<void> {
  await page.mouse.move(point.x, point.y, { steps: 12 });
}

/**
 * 落とす（マウスを離す）。離した後、dnd-kit がクリックを止めている間（50ms）が過ぎるまで待ってから戻る
 * （続けて「元に戻す」などを押すテストのため。AFTER_DROP_WAIT_MS）
 */
export async function drop(page: Page): Promise<void> {
  await page.mouse.up();
  await page.waitForTimeout(AFTER_DROP_WAIT_MS);
}

/** source をドラッグして target の中ほどに落とす */
export async function dragAndDrop(page: Page, source: Locator, target: Locator): Promise<void> {
  await startDrag(page, source);
  await dragOver(page, target);
  await drop(page);
}
