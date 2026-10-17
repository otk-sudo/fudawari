// テスト用データの追加分（extras.ts）そのものの点検。ドメインの関数は使わない（実装がなくても通る）
import { describe, expect, it } from "vitest";
import {
  extraMasterEntries,
  extraShips,
  summer2026Definition,
  summer2026DefinitionWithExtraFudas,
  summer2026MasterEntries,
  summer2026Ships,
} from "./index";

describe("テスト用データの追加分の点検", () => {
  it("追加の艦：艦 ID が既存の仮マスタと重ならず、足りなかった艦種（重巡・海防・装空・潜空・練巡・艦種 8 の戦艦）がそろう", () => {
    const existingIds = new Set(summer2026MasterEntries.map((e) => e.id));
    const extraIds = extraMasterEntries.map((e) => e.id);

    expect(new Set(extraIds).size).toBe(extraIds.length);
    expect(extraIds.some((id) => existingIds.has(id))).toBe(false);
    expect(new Set(extraMasterEntries.map((e) => e.shipTypeId))).toEqual(new Set([5, 1, 18, 14, 21, 8, 9]));
  });

  it("追加の個体：個体 ID が既存の所持艦と重ならず、艦 ID はすべて追加の艦にある", () => {
    const existingUids = new Set(summer2026Ships.map((s) => s.uid));
    const extraIds = new Set(extraMasterEntries.map((e) => e.id));
    const uids = extraShips.map((s) => s.uid);

    expect(new Set(uids).size).toBe(uids.length);
    expect(uids.some((uid) => existingUids.has(uid))).toBe(false);
    expect(extraShips.every((s) => extraIds.has(s.shipId))).toBe(true);
  });

  it("伊勢（追加）と日向改二（既存）は同じ艦型で、艦種が違う（艦型が 2 つの艦種にまたがる例）", () => {
    const ise = extraMasterEntries.find((e) => e.name === "伊勢");
    const hyuga = summer2026MasterEntries.find((e) => e.name === "日向改二");

    expect(ise?.shipClassId).toBe(hyuga?.shipClassId);
    expect(ise?.shipClassName).toBe(hyuga?.shipClassName);
    expect(ise?.shipTypeId).not.toBe(hyuga?.shipTypeId);
  });

  it("札を足した定義：既存の海域・札・段階はそのままで、未使用の札と札番号のない札が末尾にある", () => {
    const d = summer2026DefinitionWithExtraFudas;
    const fudaIds = d.fudas.map((f) => f.id);
    const usedFudaIds = new Set(d.stages.map((s) => s.fudaId));
    const gameNumbers = d.fudas.flatMap((f) => (f.gameNumber === null ? [] : [f.gameNumber]));

    expect(d.areas.slice(0, summer2026Definition.areas.length)).toEqual(summer2026Definition.areas);
    expect(d.fudas.slice(0, summer2026Definition.fudas.length)).toEqual(summer2026Definition.fudas);
    expect(d.stages.slice(0, summer2026Definition.stages.length)).toEqual(summer2026Definition.stages);
    expect(new Set(fudaIds).size).toBe(fudaIds.length);
    expect(new Set(gameNumbers).size).toBe(gameNumbers.length);
    expect(usedFudaIds.has("unused")).toBe(false);
    expect(usedFudaIds.has("nonumber")).toBe(true);
    expect(d.fudas.find((f) => f.id === "nonumber")?.gameNumber).toBeNull();
    for (const s of d.stages) {
      expect(d.areas.map((a) => a.id)).toContain(s.areaId);
      expect(fudaIds).toContain(s.fudaId);
    }
  });

  it("追加分は凍結されている", () => {
    expect(Object.isFrozen(extraMasterEntries[0])).toBe(true);
    expect(Object.isFrozen(extraShips[0])).toBe(true);
    expect(Object.isFrozen(summer2026DefinitionWithExtraFudas.fudas)).toBe(true);
  });
});
