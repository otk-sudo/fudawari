import { expect, type Locator, type Page, test } from "@playwright/test";
import type { PublicDefinition } from "../src/domain/definition/types";
import { ASSIGN_PATH, cardIn, columnOf, panelOf, seedPlan } from "../src/test/assign-e2e";
import {
  nationalityMasterEntries,
  nationalityShips,
  shipTypeMasterEntries,
  shipTypeShips,
  summer2026Assignments,
  summer2026DefinitionWithUsaDestroyerBoost,
  summer2026MasterEntries,
  summer2026Ships,
} from "../src/test/fixtures";

// 艦種で絞った国籍の特効グループ（v1.1「国籍の特効を艦種で絞る」の仕様 7 章）を、ビルドした静的書き出しで確かめる
//
// 前提（e2e/nationality-boost.spec.ts と同じ作り）
// - 公開定義（/data/latest-definition.json）は、2026夏イベの E2 ゲージ3（連合艦隊・難所）に
//   「米駆逐」×1.20（艦名なし・国籍 アメリカ・艦種 駆逐〔shipTypes [2]〕）を足したテスト用の定義
//   （src/test/fixtures/shipType.ts）の応答に差し替える。
//   一般の画面は読み込んだ定義を検証してから使うので、艦種を持つグループが検証を通ることも確かめられる
// - 艦船マスタ（/data/ship-master.json）は、テスト用の仮マスタに国籍の艦（Iowa改〔米戦艦〕など）と
//   Johnston改（米駆逐。艦型 91・艦種 2）を足した応答に差し替える
// - 取り込んだ艦と割り当ては、画面がブラウザ内の保存を作った後で直接入れる（src/test/assign-e2e.ts の seedPlan）。
//   Johnston改（個体 ID "johnston"）と Iowa改（個体 ID "iowa"）を連合艦隊に置く。
//   連合艦隊は 10 隻（一覧の割り当ての 8 隻 ＋ 2 隻）で、特効があるのは 9 隻（Iowa改は艦種が違うので特効なし）

const LATEST_DEFINITION_PATH = "/data/latest-definition.json";
const SHIP_MASTER_PATH = "/data/ship-master.json";
/** 2026夏イベの開催中の時刻（ほかの画面テストと同じ） */
const WHILE_RUNNING = new Date("2026-10-16T12:00:00+09:00");

/** 公開定義と艦船マスタの取得を、艦種の特効のテスト用データの応答に差し替える（問い合わせ文字列の有無は問わない） */
async function routeShipTypeData(
  page: Page,
  definition: PublicDefinition = summer2026DefinitionWithUsaDestroyerBoost,
): Promise<void> {
  await page.route(
    (url) => url.pathname === LATEST_DEFINITION_PATH,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(definition),
      }),
  );
  await page.route(
    (url) => url.pathname === SHIP_MASTER_PATH,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schemaVersion: 1,
          ships: [...summer2026MasterEntries, ...nationalityMasterEntries, ...shipTypeMasterEntries],
        }),
      }),
  );
}

test.describe("艦種で絞った国籍の特効グループ（v1.1）", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(WHILE_RUNNING);
    await routeShipTypeData(page);
  });

  test("連合艦隊に置いた米駆逐艦（Johnston改）にだけ ×1.20 が出て、米戦艦（Iowa改）には出ない（割り振り・一覧）", async ({
    page,
  }) => {
    // 準備：取り込んだ艦（31 隻 ＋ 国籍の艦 4 隻 ＋ Johnston改）と、Johnston改・Iowa改を連合艦隊に置いた割り当てを入れる
    await seedPlan(page, {
      ships: [...summer2026Ships, ...nationalityShips, ...shipTypeShips],
      assignments: { ...summer2026Assignments, johnston: "rengo", iowa: "rengo" },
    });

    // 実行：割り振りを開き、連合艦隊の Johnston改 を選ぶ
    await page.goto(ASSIGN_PATH);
    const rengo = columnOf(page, "連合艦隊");
    await expect(rengo).toContainText(/10\s*隻/);
    await cardIn(rengo, "johnston").click();

    // 検証：割り振りの「この艦の特効」に、連合艦隊 +60 と E2 ゲージ3 ×1.20
    const panel = panelOf(page);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Johnston改");
    await expect(panel).toContainText(/連合艦隊\s*\+60/);
    await expect(panel).toContainText(/E2 ゲージ3[^×]*×1\.20/);

    // 実行：連合艦隊の Iowa改 を選ぶ
    await cardIn(rengo, "iowa").click();

    // 検証：Iowa改 には倍率が出ない
    await expect(panel).toContainText("Iowa改");
    await expect(panel).not.toContainText(/×\s*\d/);

    // 実行：一覧を開く
    await page.goto("/list");

    // 検証：連合艦隊の行は 10 隻のうち特効 9 隻、Johnston改 のバッジは ×1.20、Iowa改 には倍率のバッジがない
    const rengoRow = page.getByRole("region", { name: "連合艦隊", exact: true });
    await expect(rengoRow).toContainText(/10\s*隻\s*・\s*特効\s*9\s*隻/);
    const johnston = rengoRow.getByRole("listitem").filter({ hasText: "Johnston改" });
    await expect(johnston).toHaveCount(1);
    await expect(johnston).toContainText("×1.20");
    const iowa = rengoRow.getByRole("listitem").filter({ hasText: "Iowa改" });
    await expect(iowa).toHaveCount(1);
    await expect(iowa).not.toContainText(/×\s*\d/);
  });

  test("割り振りの開いた艦カードと選んだ艦のパネルの E2 ゲージ3 の行に「米駆逐（アメリカ・駆逐）」と ×1.20 が出て、一覧に倍率と特効の隻数が出る", async ({
    page,
  }) => {
    // 準備：Johnston改 だけを連合艦隊に置く（連合艦隊は 9 隻。全員に特効がある）
    await seedPlan(page, {
      ships: [...summer2026Ships, ...nationalityShips, ...shipTypeShips],
      assignments: { ...summer2026Assignments, johnston: "rengo" },
    });

    // 実行：割り振りを開き、連合艦隊の Johnston改 を選ぶ（選ぶとカードも開く）
    await page.goto(ASSIGN_PATH);
    const rengo = columnOf(page, "連合艦隊");
    const card = cardIn(rengo, "johnston");
    await card.click();

    // 検証：開いたカードと選んだ艦のパネルの行は「E2 ゲージ3 米駆逐（アメリカ・駆逐） ×1.20」（段階名・内訳・倍率の順）
    const usDestroyerLine = /E2 ゲージ3\s*米駆逐（アメリカ・駆逐）\s*×1\.20/;
    await expect(card).toHaveAttribute("aria-expanded", "true");
    await expect(card).toContainText(usDestroyerLine);
    const panel = panelOf(page);
    await expect(panel).toContainText("Johnston改");
    await expect(panel).toContainText(usDestroyerLine);

    // 実行：一覧を開く
    await page.goto("/list");

    // 検証：連合艦隊の行は 9 隻すべてが特効あり、Johnston改 のバッジは ×1.20
    const rengoRow = page.getByRole("region", { name: "連合艦隊", exact: true });
    await expect(rengoRow).toContainText(/9\s*隻\s*・\s*特効\s*9\s*隻/);
    const johnston = rengoRow.getByRole("listitem").filter({ hasText: "Johnston改" });
    await expect(johnston).toHaveCount(1);
    await expect(johnston).toContainText("×1.20");
  });
});

// ---- 内訳のある段階の行の見た目（PR #39 のレビュー指摘 B1） ----
//
// 段階の行の HTML の並びは「段階名・内訳・倍率」（見た目は内訳を下の段に回す）。内訳があっても段階名（「E2 ゲージ3」）が細く縮んで
// 1 文字ずつ折り返さず、1 行に収まることを、ビルドした画面の大きさで測る（Desktop Chrome の既定の幅）。
// 内訳の文は長ければ折り返してよい（段階名だけを測る）。

/** E2 ゲージ3 に「米艦」×1.10（国籍 アメリカ・イギリス）も足して、Johnston改 の内訳を長くした定義 */
const longNoteDefinition: PublicDefinition = {
  ...summer2026DefinitionWithUsaDestroyerBoost,
  stages: summer2026DefinitionWithUsaDestroyerBoost.stages.map((stage) =>
    stage.id === "E2-3"
      ? {
          ...stage,
          boosts: [
            ...stage.boosts,
            { id: "E2-3-US-UK", name: "米艦", multiplier: 1.1, shipNames: [], nationalities: ["usa", "uk"] },
          ],
        }
      : stage,
  ),
};

/** 段階名の要素の大きさ：文字の行の数、文字列の幅、要素の幅と高さ、1 行の高さ */
interface LabelMetrics {
  lines: number;
  textWidth: number;
  width: number;
  height: number;
  lineHeight: number;
}

/** 段階名の要素を測る（文字の範囲の矩形から、行の数と文字列の幅を求める） */
async function measureLabel(label: Locator): Promise<LabelMetrics> {
  return label.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    const box = element.getBoundingClientRect();
    return {
      lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
      textWidth: rects.reduce((sum, rect) => sum + rect.width, 0),
      width: box.width,
      height: box.height,
      lineHeight: Math.max(0, ...rects.map((rect) => rect.height)),
    };
  });
}

/** 段階名の要素が 1 行に収まっている（行が 1 つ・高さが 1 行分・幅が文字列の幅より縮んでいない）。艦カードとパネルの両方を測るため soft で確かめる */
async function expectLabelOnOneLine(label: Locator, where: string): Promise<void> {
  const m = await measureLabel(label);
  const detail = `${where}（${JSON.stringify(m)}）`;
  expect.soft(m.lines, `${detail}：段階名が 1 行`).toBe(1);
  expect.soft(m.height, `${detail}：段階名の高さが 1 行分`).toBeLessThanOrEqual(m.lineHeight * 1.5);
  expect.soft(m.width, `${detail}：段階名の幅が文字列の幅より縮んでいない`).toBeGreaterThanOrEqual(m.textWidth - 1);
}

test.describe("内訳のある段階の行で、段階名が 1 行に収まる（v1.1、PR #39 のレビュー指摘 B1）", () => {
  for (const [kind, definition, note] of [
    ["「米駆逐」1 グループ", summer2026DefinitionWithUsaDestroyerBoost, "米駆逐（アメリカ・駆逐）"],
    ["長い内訳（米艦 ×1.10 と掛け合わせ）", longNoteDefinition, "米駆逐 ×1.20（アメリカ・駆逐）、米艦 ×1.10（アメリカ・イギリス）"],
  ] as const) {
    test(`${kind}：連合艦隊の開いた艦カードと選んだ艦のパネルで、「E2 ゲージ3」が折り返さない`, async ({ page }) => {
      // 準備：Johnston改 を連合艦隊に置く
      await page.clock.setFixedTime(WHILE_RUNNING);
      await routeShipTypeData(page, definition);
      await seedPlan(page, {
        ships: [...summer2026Ships, ...nationalityShips, ...shipTypeShips],
        assignments: { ...summer2026Assignments, johnston: "rengo" },
      });

      // 実行：割り振りを開き、連合艦隊の Johnston改 を選ぶ（カードも開く）
      await page.goto(ASSIGN_PATH);
      const card = cardIn(columnOf(page, "連合艦隊"), "johnston");
      await card.click();
      await expect(card).toHaveAttribute("aria-expanded", "true");
      const panel = panelOf(page);
      await expect(panel).toContainText("Johnston改");

      // 検証：内訳が出ている（内訳の文に「×」が入る例もあるので、文そのもので確かめる）
      await expect(card).toContainText(note);
      await expect(panel).toContainText(note);

      // 検証：段階名の要素が 1 行に収まる
      await expectLabelOnOneLine(card.getByText("E2 ゲージ3", { exact: true }), "艦カード");
      await expectLabelOnOneLine(panel.getByText("E2 ゲージ3", { exact: true }), "選んだ艦のパネル");
    });
  }
});

// ---- 内訳の文が狭い列に押し込まれない（本番での表示の崩れ。2026-10-18 ユーザーの報告） ----
// 段階名が長いと、段階名と倍率の間の内訳の文が数文字の幅に押し込まれ、1 文字ずつ縦に並んでいた。
// 内訳の文は段階名の下の段に、行の幅いっぱいで横書きに出す（行の幅の 7 割以上、高さは 2 行分まで）。

/** 内訳の文の要素の大きさと、その行（段階の行）の幅 */
async function measureNote(note: Locator): Promise<{ width: number; height: number; lineWidth: number; lineHeight: number }> {
  return note.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const line = element.parentElement?.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || Number.parseFloat(getComputedStyle(element).fontSize) * 1.5;
    return { width: rect.width, height: rect.height, lineWidth: line?.width ?? 0, lineHeight };
  });
}

async function expectNoteNotSqueezed(note: Locator, where: string): Promise<void> {
  const m = await measureNote(note);
  const detail = `${where}（${JSON.stringify(m)}）`;
  expect.soft(m.width, `${detail}：内訳の幅が行の幅の 7 割以上`).toBeGreaterThanOrEqual(m.lineWidth * 0.7);
  expect.soft(m.height, `${detail}：内訳の高さが 2 行分まで`).toBeLessThanOrEqual(m.lineHeight * 2 + 2);
}

test("長い内訳でも、開いた艦カードと選んだ艦のパネルで内訳の文が狭い列に押し込まれない", async ({ page }) => {
  // 準備：Johnston改 を連合艦隊に置く（内訳の長い定義）
  await page.clock.setFixedTime(WHILE_RUNNING);
  await routeShipTypeData(page, longNoteDefinition);
  await seedPlan(page, {
    ships: [...summer2026Ships, ...nationalityShips, ...shipTypeShips],
    assignments: { ...summer2026Assignments, johnston: "rengo" },
  });

  // 実行：割り振りを開き、連合艦隊の Johnston改 を選ぶ（カードも開く）
  await page.goto(ASSIGN_PATH);
  const card = cardIn(columnOf(page, "連合艦隊"), "johnston");
  await card.click();
  await expect(card).toHaveAttribute("aria-expanded", "true");
  const panel = panelOf(page);
  await expect(panel).toContainText("Johnston改");

  // 検証：内訳の文の要素が行の幅いっぱいで、高さは 2 行分まで
  const note = "米駆逐 ×1.20（アメリカ・駆逐）、米艦 ×1.10（アメリカ・イギリス）";
  await expectNoteNotSqueezed(card.getByText(note, { exact: true }), "艦カード");
  await expectNoteNotSqueezed(panel.getByText(note, { exact: true }), "選んだ艦のパネル");
});

// ---- 報告と同じ条件（1366×768 の艦カード・長い段階名・文字「大」）で、■・段階名・倍率が同じ段に残る ----
// 内訳を下の段に回すと、段階名が縮まないため長い段階名では ■ だけが 1 段目に取り残され、倍率も下の段へ落ちていた（PR #41 のレビュー M1）。

/** E2 ゲージ3 の段階名を本番の報告と同じくらい長くした定義（表示は「E2 E2-2 第二ゲージ（戦車輸送）」） */
const longLabelDefinition: PublicDefinition = {
  ...longNoteDefinition,
  stages: longNoteDefinition.stages.map((stage) =>
    stage.id === "E2-3" ? { ...stage, name: "E2-2 第二ゲージ（戦車輸送）" } : stage,
  ),
};

/** 段階の行の中の ■・段階名・倍率・内訳の位置と、行があふれていないか */
async function measureRow(label: Locator): Promise<{
  sameRow: boolean;
  noteBelow: boolean;
  overflow: number;
  detail: Record<string, number>;
}> {
  return label.evaluate((element) => {
    const line = element.parentElement;
    if (line === null) throw new Error("段階の行がない");
    const children = [...line.children] as HTMLElement[];
    const labelBox = element.getBoundingClientRect();
    const multiplier = children.find((child) => /^×/.test(child.textContent ?? ""));
    const note = children.find((child) => child !== element && child !== multiplier && (child.textContent ?? "") !== "");
    const dot = children.find((child) => child.getAttribute("aria-hidden") === "true");
    const top = (el: Element | undefined) => (el === undefined ? Number.NaN : el.getBoundingClientRect().top);
    const bottom = (el: Element | undefined) => (el === undefined ? Number.NaN : el.getBoundingClientRect().bottom);
    // 同じ段：■ と倍率の縦の中心が段階名の高さの範囲に入る（段階名が 2 行に折り返しても、その段の中にそろう）
    const center = (el: Element) => (el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2;
    const inFirstRow = (el: Element | undefined) => el === undefined || (center(el) >= labelBox.top && center(el) <= labelBox.bottom);
    return {
      sameRow: inFirstRow(dot) && inFirstRow(multiplier),
      noteBelow: note === undefined || top(note) >= labelBox.bottom - 1,
      overflow: line.scrollWidth - line.clientWidth,
      detail: { labelTop: labelBox.top, labelBottom: labelBox.bottom, dotTop: top(dot), multiplierTop: top(multiplier), noteTop: top(note), noteBottom: bottom(note) },
    };
  });
}

for (const fontSize of ["標準", "大"] as const) {
  test(`1366×768・文字${fontSize}・長い段階名で、艦カードと選んだ艦のパネルの段階の行が崩れない`, async ({ page }) => {
    // 準備：1366×768、Johnston改 を連合艦隊に置く（長い段階名・長い内訳の定義）
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.clock.setFixedTime(WHILE_RUNNING);
    await routeShipTypeData(page, longLabelDefinition);
    await seedPlan(page, {
      ships: [...summer2026Ships, ...nationalityShips, ...shipTypeShips],
      assignments: { ...summer2026Assignments, johnston: "rengo" },
    });

    // 実行：割り振りを開き、文字の大きさを変え、連合艦隊の Johnston改 を選ぶ（カードも開く）
    await page.goto(ASSIGN_PATH);
    if (fontSize === "大") {
      await page.evaluate(() => document.documentElement.setAttribute("data-font-size", "large"));
    }
    const card = cardIn(columnOf(page, "連合艦隊"), "johnston");
    await card.click();
    await expect(card).toHaveAttribute("aria-expanded", "true");
    const panel = panelOf(page);
    await expect(panel).toContainText("Johnston改");

    // 検証：■・段階名・倍率が同じ段にあり、内訳は段階名の下の段、行はあふれない
    for (const [where, scope] of [["艦カード", card], ["選んだ艦のパネル", panel]] as const) {
      const row = await measureRow(scope.getByText("E2 E2-2 第二ゲージ（戦車輸送）", { exact: true }));
      const detail = `${where}（${JSON.stringify(row)}）`;
      expect.soft(row.sameRow, `${detail}：■・段階名・倍率が同じ段`).toBe(true);
      expect.soft(row.noteBelow, `${detail}：内訳は段階名の下の段`).toBe(true);
      expect.soft(row.overflow, `${detail}：行があふれない`).toBeLessThanOrEqual(1);
    }
  });
}
