import { expect, type Page, test } from "@playwright/test";
import { ASSIGN_PATH, cardIn, columnOf, panelOf, seedPlan } from "../src/test/assign-e2e";
import {
  nationalityMasterEntries,
  nationalityShips,
  summer2026Assignments,
  summer2026DefinitionWithUsaBoost,
  summer2026MasterEntries,
  summer2026Ships,
} from "../src/test/fixtures";

// 国籍の条件の特効グループ（v1.1「特効グループに国籍の条件を足す」の仕様 8 章）を、ビルドした静的書き出しで確かめる
//
// 前提（e2e/list-export.spec.ts と同じ作り）
// - 公開定義（/data/latest-definition.json）は、2026夏イベの E2 ゲージ3（連合艦隊・難所）に
//   「米艦」×1.20（艦名なし・国籍 アメリカ）を足したテスト用の定義（src/test/fixtures/nationality.ts）の応答に差し替える。
//   一般の画面は読み込んだ定義を検証してから使うので、国籍を持つグループが検証を通ることも確かめられる
// - 艦船マスタ（/data/ship-master.json）は、テスト用の仮マスタに米艦（Iowa改など）を足した応答に差し替える
// - 取り込んだ艦と割り当ては、画面がブラウザ内の保存を作った後で直接入れる（src/test/assign-e2e.ts の seedPlan）。
//   Iowa改（個体 ID "iowa"）を連合艦隊に置く。連合艦隊は 9 隻（一覧の割り当ての 8 隻 ＋ Iowa改）で、全員に特効がある

const LATEST_DEFINITION_PATH = "/data/latest-definition.json";
const SHIP_MASTER_PATH = "/data/ship-master.json";
/** 2026夏イベの開催中の時刻（ほかの画面テストと同じ） */
const WHILE_RUNNING = new Date("2026-10-16T12:00:00+09:00");

/** 公開定義と艦船マスタの取得を、国籍の特効のテスト用データの応答に差し替える（問い合わせ文字列の有無は問わない） */
async function routeNationalityData(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === LATEST_DEFINITION_PATH,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(summer2026DefinitionWithUsaBoost),
      }),
  );
  await page.route(
    (url) => url.pathname === SHIP_MASTER_PATH,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ schemaVersion: 1, ships: [...summer2026MasterEntries, ...nationalityMasterEntries] }),
      }),
  );
}

test.describe("国籍の条件の特効グループ（v1.1）", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(WHILE_RUNNING);
    await routeNationalityData(page);
  });

  test("取り込んだ米艦（Iowa改）を連合艦隊に置くと、割り振りの「この艦の特効」と一覧のバッジに国籍のグループの倍率 ×1.20 が出る", async ({
    page,
  }) => {
    // 準備：取り込んだ艦（31 隻 ＋ 国籍の艦 4 隻）と、Iowa改を連合艦隊に置いた割り当てを入れる
    await seedPlan(page, {
      ships: [...summer2026Ships, ...nationalityShips],
      assignments: { ...summer2026Assignments, iowa: "rengo" },
    });

    // 実行：割り振りを開き、連合艦隊の Iowa改 を選ぶ
    await page.goto(ASSIGN_PATH);
    const rengo = columnOf(page, "連合艦隊");
    await expect(rengo).toContainText(/9\s*隻/);
    await cardIn(rengo, "iowa").click();

    // 検証：割り振りの「この艦の特効」に、連合艦隊 +60 と E2 ゲージ3 ×1.20
    const panel = panelOf(page);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Iowa改");
    await expect(panel).toContainText(/連合艦隊\s*\+60/);
    await expect(panel).toContainText(/E2 ゲージ3[^×]*×1\.20/);

    // 実行：一覧を開く
    await page.goto("/list");

    // 検証：連合艦隊の行は 9 隻すべてが特効あり、Iowa改 のバッジは ×1.20
    const rengoRow = page.getByRole("region", { name: "連合艦隊", exact: true });
    await expect(rengoRow).toContainText(/9\s*隻\s*・\s*特効\s*9\s*隻/);
    const iowa = rengoRow.getByRole("listitem").filter({ hasText: "Iowa改" });
    await expect(iowa).toHaveCount(1);
    await expect(iowa).toContainText("×1.20");
  });
});
