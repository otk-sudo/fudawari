import { expect, type Locator, type Page, test } from "@playwright/test";
import type { Area, Fuda, PublicDefinition, Stage } from "@/domain/definition/types";
import type { AssignmentMap } from "@/domain/plan/types";
import { routeLatestData, seedPlan } from "../src/test/assign-e2e";
import { summer2026Definition, summer2026Ships } from "../src/test/fixtures";

// 一覧（/list）の攻略の流れの詰め方（UI／UX レビュー 中5）と、段階名・「まだ割り当てがありません」の読みやすさ（中12 の一覧の分）の
// 先に書いたテスト（TDD の Red）
//
// 親の決定（ユーザーの承認済み）
// - 中5：攻略の流れの段階のセルを詰める。段階名・札名・「特効 n隻」を 1 行に横並びにし、長ければ省略記号で切る。
//   1366×768・5 海域で、札ごとの行の 4 段目まで見える（目安：札ごとの行の 1 段目の上端が画面の高さの半分より上）。
//   画像で保存（src/features/export-image。部品も CSS も一覧と別）の見た目は変えない
// - 中12：一覧の段階のセルの段階名（今は 11px・不透明度 0.85 で 3.5:1 前後）と「まだ割り当てがありません」（3.28:1）を、
//   ダーク・ライトとも 4.5:1 以上にする。11px の文字は 12px 以上（calc(12px * var(--font-scale)) の決まり）にする
//
// 場面：本番の定義と同じ形の 5 海域・13 札・20 段階の定義（段階名は「E1-1 第一ゲージ」のように海域名で始まる。札の色も本番の値）。
// 取り込んだ艦はテスト用の 31 隻で、1 札目（第三十一戦隊）に 2 隻だけ割り当てる（ほかの札は「まだ割り当てがありません」）。
// 文字の大きさは標準（--font-scale: 1）
//
// 部品の探し方（実装の担当向け）
// - 攻略の流れ：region「攻略の流れ」。海域ごとの list（名前は海域名）、段階ごとの listitem（今の形のまま。src/test/list-screen.ts）
// - 段階のセルの中で、段階名・札名・「特効 n隻」は、それぞれその文字だけを持つ要素に入れる（文字がちょうど一致する要素で探す）
// - 札ごとの行：region（名前は札名そのもの）。「まだ割り当てがありません」はその文字だけを持つ要素
//
// コントラスト比は、文字の色（要素と祖先の不透明度を掛けたもの）を、いちばん近い不透明な下地まで重ねた背景の色に合成して、
// WCAG 2 の式で求める（背景の画像・グラデーションは見ない）

// ---- テスト用のデータ ----

/** 画面の大きさ（UI／UX レビューの 1366×768） */
const VIEWPORT = { width: 1366, height: 768 } as const;
/** 2026夏イベの開催中の時刻（ほかの画面テストと同じ） */
const WHILE_RUNNING = new Date("2026-10-16T12:00:00+09:00");
/** 文字の最低のコントラスト比（WCAG 2 の AA、通常の文字） */
const MIN_CONTRAST = 4.5;
/** 文字の最低の大きさ（px。標準の文字の大きさのとき） */
const MIN_FONT_SIZE = 12;
/** 艦がいない札の行の文 */
const EMPTY_ROW_TEXT = "まだ割り当てがありません";

/** 本番の定義と同じ形の札（名前・色は本番の値。札番号はこの画面では使わない） */
const FUDAS: readonly Fuda[] = [
  { id: "f1", name: "第三十一戦隊", color: "#4C8DF6", gameNumber: 1 },
  { id: "f2", name: "増強第三十一戦隊", color: "#5FB0E8", gameNumber: 2 },
  { id: "f3", name: "多号作戦部隊", color: "#3FB37F", gameNumber: 3 },
  { id: "f4", name: "連合艦隊", color: "#E5484D", gameNumber: 4 },
  { id: "f5", name: "ウルシー攻撃部隊", color: "#C9A227", gameNumber: 5 },
  { id: "f6", name: "第六艦隊", color: "#B5651D", gameNumber: 6 },
  { id: "f7", name: "仏第3艦隊", color: "#A97EF0", gameNumber: 7 },
  { id: "f8", name: "仏地中海艦隊", color: "#D16BA5", gameNumber: 8 },
  { id: "f9", name: "2éme Escadre Légère", color: "#2BB3B1", gameNumber: 9 },
  { id: "f10", name: "イギリス救援艦隊", color: "#E07A5F", gameNumber: 10 },
  { id: "f11", name: "Force de Raid", color: "#6C5CE7", gameNumber: 11 },
  { id: "f12", name: "Force H", color: "#3FB37F", gameNumber: 12 },
  { id: "f13", name: "欧州連合艦隊", color: "#E5484D", gameNumber: 13 },
];

const AREAS: readonly Area[] = ["E1", "E2", "E3", "E4", "E5"].map((name) => ({ id: name, name }));

/** [海域 ID, 段階名, 札 ID, 大事さ]（本番の定義と同じ並び） */
const STAGE_ROWS: readonly [string, string, string, Stage["importance"]][] = [
  ["E1", "E1-1 第一ゲージ", "f1", "normal"],
  ["E1", "E1-2 第二ゲージ", "f2", "normal"],
  ["E1", "E1-3 第三ゲージ", "f2", "important"],
  ["E2", "E2-1 第一ゲージ（輸送）", "f3", "normal"],
  ["E2", "E2-2 第二ゲージ", "f4", "hard"],
  ["E2", "E2-3 第三ゲージ", "f4", "hard"],
  ["E3", "E3-1 第一ゲージ", "f5", "hard"],
  ["E3", "E3-2 第二ゲージ", "f2", "normal"],
  ["E3", "E3-3 第三ゲージ（潜水）", "f6", "important"],
  ["E3", "E3-4 第四ゲージ", "f5", "hard"],
  ["E4", "E4-1 第一ゲージ", "f7", "normal"],
  ["E4", "E4-2 第二ゲージ（輸送）", "f7", "normal"],
  ["E4", "E4-3 第三ゲージ", "f8", "important"],
  ["E4", "E4-4 第四ゲージ", "f8", "important"],
  ["E4", "E4-5 第五ゲージ", "f8", "hard"],
  ["E5", "E5-1 第一ゲージ", "f9", "normal"],
  ["E5", "E5-2 第二ゲージ（戦車輸送）", "f10", "normal"],
  ["E5", "E5-3 第三ゲージ（対地）", "f11", "normal"],
  ["E5", "E5 ギミック解除", "f12", "normal"],
  ["E5", "E5-4 最終ゲージ", "f13", "hard"],
];

const STAGES: readonly Stage[] = STAGE_ROWS.map(([areaId, name, fudaId, importance], index) => ({
  id: `s${index + 1}`,
  areaId,
  name,
  fudaId,
  importance,
  boosts: [],
}));

/** 5 海域の定義（イベントはテスト用の 2026夏イベ。ブラウザ内の保存の割り当ての行と ID をそろえる） */
const FIVE_AREA_DEFINITION: PublicDefinition = {
  schemaVersion: 1,
  event: summer2026Definition.event,
  areas: AREAS,
  fudas: FUDAS,
  stages: STAGES,
};

/** 1 札目（第三十一戦隊）に 2 隻だけ割り当てる */
const ASSIGNMENTS: AssignmentMap = { hatsushimo: "f1", fuyuzuki: "f1" };

// ---- 補助 ----

/** 公開定義の取得を 5 海域の定義に差し替える（艦船マスタは routeLatestData のテスト用データ） */
async function routeFiveAreaDefinition(page: Page): Promise<void> {
  await routeLatestData(page);
  // 後に登録した page.route が先に当たる
  await page.route(
    (url) => url.pathname === "/data/latest-definition.json",
    (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIVE_AREA_DEFINITION) }),
  );
}

/** ブラウザ内の保存の設定（settings の表）に画面モードを書く（行の形は src/lib/storage/storage.ts の版 1） */
async function saveThemeMode(page: Page, themeMode: "dark" | "light"): Promise<void> {
  await page.evaluate(async (mode) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fudawari");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("settings", "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.objectStore("settings").put({ id: "settings", values: { themeMode: mode } });
      });
    } finally {
      db.close();
    }
  }, themeMode);
}

/** 1366×768 で、艦と割り当て（と画面モード）を入れてから一覧を開く。ページの一番上にいることを確かめる */
async function openList(page: Page, themeMode: "dark" | "light" = "dark"): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await seedPlan(page, { ships: summer2026Ships, assignments: ASSIGNMENTS });
  await saveThemeMode(page, themeMode);
  await page.goto("/list");
  await expect(fudaRow(page, FUDAS[0].name)).toContainText(/2\s*隻/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", themeMode);
  expect(await page.evaluate(() => window.scrollY), "前提：ページの一番上にいる").toBe(0);
}

/** 札ごとの行（名前が札名そのものの region） */
function fudaRow(page: Page, fudaName: string): Locator {
  return page.getByRole("region", { name: fudaName, exact: true });
}

/** 攻略の流れ（region「攻略の流れ」） */
function timelineOf(page: Page): Locator {
  return page.getByRole("region", { name: "攻略の流れ" });
}

/** 攻略の流れの段階のセル（海域の list の listitem。定義の順） */
function stepOf(page: Page, areaName: string, indexInArea: number): Locator {
  return timelineOf(page).getByRole("list", { name: areaName, exact: true }).getByRole("listitem").nth(indexInArea);
}

/** 段階ごとの、海域の中の位置・段階名・札名 */
const STEP_CASES = STAGES.map((stage) => {
  const indexInArea = STAGES.filter((other) => other.areaId === stage.areaId).indexOf(stage);
  const fuda = FUDAS.find((candidate) => candidate.id === stage.fudaId);
  if (fuda === undefined) throw new Error(`札 ${stage.fudaId} がありません`);
  return { areaName: stage.areaId, indexInArea, stageName: stage.name, fudaName: fuda.name };
});

/** 要素の画面上の箱（見えていなければ失敗にする） */
async function boxOf(locator: Locator, label: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`${label} の箱が取れない（見えていない）`);
  return box;
}

/** 文字の要素の大きさ（px）と、背景とのコントラスト比 */
interface TextMeasure {
  fontSize: number;
  ratio: number;
  /** 失敗したときの手がかり（文字の色・背景の色） */
  detail: string;
}

/** 文字の要素の大きさと、背景とのコントラスト比を測る */
async function measureText(locator: Locator): Promise<TextMeasure> {
  return locator.evaluate((element): TextMeasure => {
    type Rgba = [number, number, number, number];
    function parseColor(value: string): Rgba {
      const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
      if (rgb !== null) {
        const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? Number.parseFloat(rgb[4]) / 100 : Number(rgb[4]);
        return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
      }
      const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(value);
      if (srgb !== null) {
        return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, srgb[4] === undefined ? 1 : Number(srgb[4])];
      }
      throw new Error(`色の形を読めない：${value}`);
    }
    function over(top: Rgba, bottom: Rgba): Rgba {
      const a = top[3];
      return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
    }
    function luminance([r, g, b]: Rgba): number {
      const [lr, lg, lb] = [r, g, b].map((channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    }

    // 背景：要素から祖先へ、不透明な下地が見つかるまでの下地を集め、外側から重ねる（見つからなければ白）
    const layers: Rgba[] = [];
    let opacity = 1;
    let node: Element | null = element;
    let opaqueFound = false;
    while (node !== null) {
      const style = getComputedStyle(node);
      const background = parseColor(style.backgroundColor);
      if (background[3] > 0) layers.push(background);
      if (background[3] >= 1) {
        opaqueFound = true;
        break;
      }
      opacity *= Number(style.opacity);
      node = node.parentElement;
    }
    let backdrop: Rgba = opaqueFound ? [0, 0, 0, 1] : [255, 255, 255, 1];
    for (const layer of layers.reverse()) backdrop = over(layer, backdrop);

    const style = getComputedStyle(element);
    const color = parseColor(style.color);
    const text = over([color[0], color[1], color[2], color[3] * opacity], backdrop);
    const [light, dark] = [luminance(text), luminance(backdrop)].sort((x, y) => y - x);
    const ratio = (light + 0.05) / (dark + 0.05);
    const toCss = (c: Rgba) => `rgb(${c.slice(0, 3).map((v) => Math.round(v)).join(", ")})`;
    return {
      fontSize: Number.parseFloat(style.fontSize),
      ratio,
      detail: `文字 ${style.color}（不透明度 ${opacity.toFixed(2)}）→ ${toCss(text)}、背景 ${toCss(backdrop)}`,
    };
  });
}

// ---- テスト ----

test.describe("一覧の攻略の流れを詰める（UI／UX レビュー 中5）", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(WHILE_RUNNING);
    await routeFiveAreaDefinition(page);
  });

  test("1366×768・5 海域で、札ごとの行の 1 段目の上端が画面の高さの半分より上にあり、4 段目の上端が画面の中にある（スクロールしない）", async ({
    page,
  }) => {
    // 準備・実行
    await openList(page);

    // 検証
    const first = await boxOf(fudaRow(page, FUDAS[0].name), `札ごとの行の 1 段目（${FUDAS[0].name}）`);
    expect(
      first.y,
      `札ごとの行の 1 段目の上端（${Math.round(first.y)}px）が画面の高さの半分（${VIEWPORT.height / 2}px）より上`,
    ).toBeLessThan(VIEWPORT.height / 2);
    const fourth = await boxOf(fudaRow(page, FUDAS[3].name), `札ごとの行の 4 段目（${FUDAS[3].name}）`);
    expect(fourth.y, `札ごとの行の 4 段目の上端（${Math.round(fourth.y)}px）が画面の中`).toBeLessThan(VIEWPORT.height);
  });

  test("1366×768・5 海域で、各段階のセルの段階名・札名・「特効 n隻」が 1 行に横並びで、どれも 1 行に収まり、セルの外にはみ出さない", async ({
    page,
  }) => {
    // 準備・実行
    await openList(page);

    // 検証
    for (const { areaName, indexInArea, stageName, fudaName } of STEP_CASES) {
      const step = stepOf(page, areaName, indexInArea);
      const label = `${areaName} の ${indexInArea + 1} 番目の段階（${stageName}）`;
      const stepBox = await boxOf(step, label);
      const parts = [
        { name: "段階名", locator: step.getByText(stageName, { exact: true }) },
        { name: "札名", locator: step.getByText(fudaName, { exact: true }) },
        { name: "特効 n隻", locator: step.getByText(/^特効\s*\d+\s*隻$/) },
      ];
      const boxes = [];
      for (const part of parts) {
        const box = await boxOf(part.locator, `${label}の${part.name}`);
        const fontSize = await part.locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
        expect.soft(box.height, `${label}の${part.name}が 1 行に収まる（高さ ${box.height}px、文字 ${fontSize}px）`).toBeLessThan(
          fontSize * 2,
        );
        expect.soft(box.x, `${label}の${part.name}がセルの左にはみ出さない`).toBeGreaterThanOrEqual(stepBox.x - 0.5);
        expect.soft(box.x + box.width, `${label}の${part.name}がセルの右にはみ出さない（長ければ省略記号で切る）`).toBeLessThanOrEqual(
          stepBox.x + stepBox.width + 0.5,
        );
        boxes.push({ name: part.name, center: box.y + box.height / 2, height: box.height });
      }
      const [stage, ...others] = boxes;
      for (const other of others) {
        expect.soft(
          Math.abs(other.center - stage.center),
          `${label}の${other.name}が段階名と同じ行にある（縦の中心の差）`,
        ).toBeLessThan(Math.min(other.height, stage.height) / 2);
      }
    }
  });
});

test.describe("一覧の段階名と「まだ割り当てがありません」の読みやすさ（UI／UX レビュー 中12）", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(WHILE_RUNNING);
    await routeFiveAreaDefinition(page);
  });

  for (const themeMode of ["dark", "light"] as const) {
    test(`${themeMode === "dark" ? "ダーク" : "ライト"}で、攻略の流れの段階名は 12px 以上・背景（札の色）とのコントラスト比 4.5:1 以上`, async ({
      page,
    }) => {
      // 準備・実行
      await openList(page, themeMode);

      // 検証
      for (const { areaName, indexInArea, stageName } of STEP_CASES) {
        const measure = await measureText(stepOf(page, areaName, indexInArea).getByText(stageName, { exact: true }));
        expect.soft(measure.fontSize, `段階名「${stageName}」の文字の大きさ`).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
        expect.soft(
          measure.ratio,
          `段階名「${stageName}」のコントラスト比 ${measure.ratio.toFixed(2)}:1（${measure.detail}）`,
        ).toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
    });

    test(`${themeMode === "dark" ? "ダーク" : "ライト"}で、「${EMPTY_ROW_TEXT}」は 12px 以上・背景とのコントラスト比 4.5:1 以上`, async ({
      page,
    }) => {
      // 準備・実行
      await openList(page, themeMode);

      // 検証：艦がいない札（2 札目）の行の文
      const measure = await measureText(fudaRow(page, FUDAS[1].name).getByText(EMPTY_ROW_TEXT, { exact: true }));
      expect(measure.fontSize, `「${EMPTY_ROW_TEXT}」の文字の大きさ`).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
      expect(
        measure.ratio,
        `「${EMPTY_ROW_TEXT}」のコントラスト比 ${measure.ratio.toFixed(2)}:1（${measure.detail}）`,
      ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    });
  }
});
