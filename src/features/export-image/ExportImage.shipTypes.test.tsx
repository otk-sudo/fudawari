// 画像で保存の画像（ExportImage）で、艦種で絞った国籍の特効グループ（v1.1「国籍の特効を艦種で絞る」の仕様 7 章）が効くことのテスト
//
// 画像は特効の計算（src/domain/boost）の結果を使うだけ（倍率は載せず「特効」か「－」）なので、
// 「アメリカ・駆逐 ×1.2」のグループで米駆逐艦に「特効」が付き、米戦艦は「－」になることを確かめる。
// 部品の探し方は src/test/list-screen.ts の冒頭にまとめてある。
//
// テスト用データ（src/test/fixtures/shipType.ts・nationality.ts）
// - 定義：2026夏イベの E2 ゲージ3（連合艦隊・難所）に「米駆逐」×1.20（艦名なし・国籍 アメリカ・艦種 駆逐）を足したもの
// - 連合艦隊：一覧の割り当ての 8 隻に Johnston改（米駆逐・Lv127）・Iowa改（米戦艦・Lv161）を足して 10 隻（列には全員入る）
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createShipMaster } from "@/domain/master";
import { ExportImage } from "@/features/export-image/ExportImage";
import {
  nationalityMasterEntries,
  nationalityShips,
  shipTypeMasterEntries,
  shipTypeShips,
  summer2026Assignments,
  summer2026DefinitionWithUsaDestroyerBoost,
  summer2026MasterEntries,
  summer2026Ships,
} from "@/test/fixtures";
import { getFudaRegion, getShipItem, shipCountPattern } from "@/test/list-screen";

function renderImage(): HTMLElement {
  const { container } = render(
    <ExportImage
      definition={summer2026DefinitionWithUsaDestroyerBoost}
      master={createShipMaster([...summer2026MasterEntries, ...nationalityMasterEntries, ...shipTypeMasterEntries])}
      ships={[...summer2026Ships, ...nationalityShips, ...shipTypeShips]}
      assignments={{ ...summer2026Assignments, johnston: "rengo", iowa: "rengo" }}
      fudaIds={["s31", "tago", "rengo", "ulithi", "sixth"]}
      page={1}
      pageCount={1}
    />,
  );
  return container;
}

describe("出力する画像：艦種で絞った国籍の特効グループ（v1.1。アメリカ・駆逐 ×1.20）", () => {
  it("米駆逐艦には「特効」、国籍は当てはまるが艦種が違う米戦艦には「－」を付ける", () => {
    // 準備・実行
    const image = renderImage();

    // 検証
    const rengo = getFudaRegion(image, "連合艦隊");
    expect(rengo).toHaveTextContent(shipCountPattern(10));
    expect(getShipItem(rengo, "Johnston改")).toHaveTextContent("特効");
    const iowa = getShipItem(rengo, "Iowa改");
    expect(iowa).not.toHaveTextContent("特効");
    expect(iowa).toHaveTextContent(/[－–-]/);
  });
});
