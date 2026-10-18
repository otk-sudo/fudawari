import { expect, type Page, test } from "@playwright/test";
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
async function routeShipTypeData(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === LATEST_DEFINITION_PATH,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(summer2026DefinitionWithUsaDestroyerBoost),
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
