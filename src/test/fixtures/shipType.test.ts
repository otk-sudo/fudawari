// テスト用データの艦種の追加分（shipType.ts）の点検。ドメインの関数は使わない（実装がなくても通る）
import { describe, expect, it } from "vitest";
import {
  extraMasterEntries,
  extraShips,
  nationalityMasterEntries,
  nationalityShips,
  shipTypeMasterEntries,
  shipTypeShips,
  summer2026Definition,
  summer2026DefinitionWithUsaDestroyerBoost,
  summer2026MasterEntries,
  summer2026Ships,
  USA_DESTROYER_BOOST_GROUP_ID,
} from "./index";

describe("テスト用データの艦種の追加分の点検", () => {
  it("艦種の艦：艦 ID が既存の仮マスタ・追加の艦・国籍の艦と重ならず、米駆逐艦 Johnston改（艦型 91・艦種 2）", () => {
    const existingIds = new Set(
      [...summer2026MasterEntries, ...extraMasterEntries, ...nationalityMasterEntries].map((e) => e.id),
    );

    expect(shipTypeMasterEntries.some((e) => existingIds.has(e.id))).toBe(false);
    expect(shipTypeMasterEntries.map((e) => [e.name, e.baseName, e.nationality, e.shipClassId, e.shipTypeId])).toEqual([
      ["Johnston改", "Johnston", "usa", 91, 2],
    ]);
  });

  it("艦種の個体：個体 ID・Lv が既存の所持艦・追加・国籍の個体と重ならず、艦 ID はすべて艦種の艦にある", () => {
    const existing = [...summer2026Ships, ...extraShips, ...nationalityShips];
    const ids = new Set(shipTypeMasterEntries.map((e) => e.id));

    expect(shipTypeShips.some((s) => existing.some((e) => e.uid === s.uid))).toBe(false);
    expect(shipTypeShips.some((s) => existing.some((e) => e.level === s.level))).toBe(false);
    expect(shipTypeShips.every((s) => ids.has(s.shipId))).toBe(true);
  });

  it("米駆逐の特効を足した定義：E2 ゲージ3 の最後に「米駆逐」×1.20（艦名なし・国籍 アメリカ・艦種 駆逐）があり、ほかは元の定義のまま", () => {
    const d = summer2026DefinitionWithUsaDestroyerBoost;
    const e23 = d.stages.find((s) => s.id === "E2-3");
    const original = summer2026Definition.stages.find((s) => s.id === "E2-3");

    expect(e23?.boosts.at(-1)).toEqual({
      id: USA_DESTROYER_BOOST_GROUP_ID,
      name: "米駆逐",
      multiplier: 1.2,
      shipNames: [],
      nationalities: ["usa"],
      shipTypes: [2],
    });
    expect(e23?.boosts.slice(0, -1)).toEqual(original?.boosts);
    expect(d.stages.filter((s) => s.id !== "E2-3")).toEqual(summer2026Definition.stages.filter((s) => s.id !== "E2-3"));
    expect(d.areas).toEqual(summer2026Definition.areas);
    expect(d.fudas).toEqual(summer2026Definition.fudas);
    expect(Object.isFrozen((e23?.boosts.at(-1) as unknown as Record<string, unknown>).shipTypes)).toBe(true);
  });
});
