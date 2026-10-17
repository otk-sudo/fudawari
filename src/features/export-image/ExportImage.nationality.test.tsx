// 画像で保存の画像（ExportImage）で、国籍の条件の特効グループ（v1.1「特効グループに国籍の条件を足す」の仕様 8 章）が効くことのテスト
//
// 画像は特効の計算（src/domain/boost）の結果を使うだけ（倍率は載せず「特効」か「－」）なので、
// 国籍のグループで効く艦に「特効」が付き、当てはまらない艦は「－」になることを確かめる。
// 部品の探し方は src/test/list-screen.ts の冒頭にまとめてある。
//
// テスト用データ（src/test/fixtures/nationality.ts）
// - 定義：2026夏イベの E2 ゲージ3（連合艦隊・難所）に「米艦」×1.20（艦名なし・国籍 アメリカ）を足したもの
// - 連合艦隊：一覧の割り当ての 8 隻に Iowa改（米・Lv161）・Warspite改（英・Lv141）を足して 10 隻（列には全員入る）
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createShipMaster } from "@/domain/master";
import { ExportImage } from "@/features/export-image/ExportImage";
import {
  nationalityMasterEntries,
  nationalityShips,
  summer2026Assignments,
  summer2026DefinitionWithUsaBoost,
  summer2026MasterEntries,
  summer2026Ships,
} from "@/test/fixtures";
import { getFudaRegion, getShipItem, shipCountPattern } from "@/test/list-screen";

function renderImage(): HTMLElement {
  const { container } = render(
    <ExportImage
      definition={summer2026DefinitionWithUsaBoost}
      master={createShipMaster([...summer2026MasterEntries, ...nationalityMasterEntries])}
      ships={[...summer2026Ships, ...nationalityShips]}
      assignments={{ ...summer2026Assignments, iowa: "rengo", warspite: "rengo" }}
      fudaIds={["s31", "tago", "rengo", "ulithi", "sixth"]}
      page={1}
      pageCount={1}
    />,
  );
  return container;
}

describe("出力する画像：国籍の条件の特効グループ（v1.1）", () => {
  it("国籍のグループで効く米艦には「特効」、当てはまらない英艦には「－」を付ける", () => {
    // 準備・実行
    const image = renderImage();

    // 検証
    const rengo = getFudaRegion(image, "連合艦隊");
    expect(rengo).toHaveTextContent(shipCountPattern(10));
    expect(getShipItem(rengo, "Iowa改")).toHaveTextContent("特効");
    const warspite = getShipItem(rengo, "Warspite改");
    expect(warspite).not.toHaveTextContent("特効");
    expect(warspite).toHaveTextContent(/[－–-]/);
  });
});
