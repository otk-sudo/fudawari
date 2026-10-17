// テスト用データの国籍の追加分（nationality.ts）と、仮マスタの国籍そのものの点検。ドメインの関数は使わない（実装がなくても通る）
import { describe, expect, it } from "vitest";
import {
  extraMasterEntries,
  extraShips,
  nationalityMasterEntries,
  nationalityShips,
  summer2026Definition,
  summer2026DefinitionWithUsaBoost,
  summer2026MasterEntries,
  summer2026Ships,
  USA_BOOST_GROUP_ID,
} from "./index";

describe("テスト用データの国籍の点検", () => {
  it("既存の仮マスタ・追加の艦は、すべて国籍が日本（既存のテストの結果を変えない）", () => {
    for (const entry of [...summer2026MasterEntries, ...extraMasterEntries]) {
      expect(entry.nationality, entry.name).toBe("japan");
    }
  });

  it("国籍の艦：艦 ID が既存の仮マスタ・追加の艦と重ならず、米 2・英 1・国籍の分からない艦 1", () => {
    const existingIds = new Set([...summer2026MasterEntries, ...extraMasterEntries].map((e) => e.id));
    const ids = nationalityMasterEntries.map((e) => e.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => existingIds.has(id))).toBe(false);
    expect(nationalityMasterEntries.map((e) => [e.name, e.nationality])).toEqual([
      ["Iowa改", "usa"],
      ["Samuel B.Roberts改", "usa"],
      ["Warspite改", "uk"],
      ["謎の艦", "unknown"],
    ]);
  });

  it("国籍の個体：個体 ID が既存の所持艦と重ならず、艦 ID はすべて国籍の艦にある", () => {
    const existingUids = new Set([...summer2026Ships, ...extraShips].map((s) => s.uid));
    const ids = new Set(nationalityMasterEntries.map((e) => e.id));
    const uids = nationalityShips.map((s) => s.uid);

    expect(new Set(uids).size).toBe(uids.length);
    expect(uids.some((uid) => existingUids.has(uid))).toBe(false);
    expect(nationalityShips.every((s) => ids.has(s.shipId))).toBe(true);
  });

  it("米艦の特効を足した定義：E2 ゲージ3 の最後に「米艦」×1.20（艦名なし・国籍 アメリカ）があり、ほかは元の定義のまま", () => {
    const d = summer2026DefinitionWithUsaBoost;
    const e23 = d.stages.find((s) => s.id === "E2-3");
    const original = summer2026Definition.stages.find((s) => s.id === "E2-3");

    expect(e23?.boosts.at(-1)).toEqual({
      id: USA_BOOST_GROUP_ID,
      name: "米艦",
      multiplier: 1.2,
      shipNames: [],
      nationalities: ["usa"],
    });
    expect(e23?.boosts.slice(0, -1)).toEqual(original?.boosts);
    expect(d.stages.filter((s) => s.id !== "E2-3")).toEqual(summer2026Definition.stages.filter((s) => s.id !== "E2-3"));
    expect(d.areas).toEqual(summer2026Definition.areas);
    expect(d.fudas).toEqual(summer2026Definition.fudas);
    expect(Object.isFrozen(e23?.boosts.at(-1)?.nationalities)).toBe(true);
  });
});
