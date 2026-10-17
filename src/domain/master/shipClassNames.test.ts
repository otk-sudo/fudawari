// 艦型の国籍の対応表（SHIP_CLASS_NATIONALITIES。v1.1「特効グループに国籍の条件を足す」の仕様 2 章）のテスト
//
// 対応は、親が実物の start2.json（2026-10-17 取得、艦型の番号 1〜141）の艦名から確かめたもの。
// 番号を間違えると艦型ごと誤った国籍になり、国籍の特効が効かない・効きすぎるため、仕様の対応をそのまま確かめる。
import { describe, expect, it } from "vitest";
import type { BoostNationality } from "@/domain/nationality";
import { SHIP_CLASS_NATIONALITIES } from "./shipClassNames";

/** 仕様の海外艦の艦型（国籍 → 艦型の番号） */
const OVERSEAS: Readonly<Record<Exclude<BoostNationality, "japan">, readonly number[]>> = {
  usa: [65, 69, 83, 84, 87, 91, 93, 95, 99, 102, 105, 106, 107, 110, 114, 116, 118, 121, 122, 125],
  uk: [67, 78, 82, 88, 108, 112, 134, 135],
  germany: [47, 48, 55, 57, 63, 86],
  italy: [58, 61, 64, 68, 80, 92, 113, 124],
  france: [70, 79, 128, 129, 138, 139, 141],
  soviet: [73, 81, 131],
  netherlands: [98],
  australia: [96],
  sweden: [89, 140],
  norway: [133],
  thailand: [137],
};

/** 仕様の海外艦の艦型の番号すべて */
const OVERSEAS_IDS = new Set(Object.values(OVERSEAS).flat());

/** 実在しない艦型の番号（1〜141 のうち） */
const MISSING_ID = 42;

/** 仕様の日本の艦型（1〜141 のうち、海外艦と 42 を除くすべて） */
const JAPAN_IDS = Array.from({ length: 141 }, (_, i) => i + 1).filter(
  (id) => id !== MISSING_ID && !OVERSEAS_IDS.has(id),
);

describe("SHIP_CLASS_NATIONALITIES（艦型の番号 → 国籍）", () => {
  it.each(Object.entries(OVERSEAS).flatMap(([nationality, ids]) => ids.map((id) => [id, nationality] as const)))(
    "艦型 %i は %s",
    (classId, nationality) => {
      expect(SHIP_CLASS_NATIONALITIES.get(classId)).toBe(nationality);
    },
  );

  it.each<[number, BoostNationality, string]>([
    [65, "usa", "Iowa級"],
    [67, "uk", "Queen Elizabeth級"],
    [47, "germany", "Bismarck級"],
    [86, "germany", "呂500（U-511 の改装）"],
    [80, "italy", "伊504・Luigi Torelli・UIT-25"],
    [124, "italy", "C.Cappellini・UIT-24・伊503"],
    [133, "norway", "ノルウェーの艦"],
    [137, "thailand", "タイの艦"],
    [5, "japan", "暁型（Верный を含む）"],
    [111, "japan", "宗谷"],
  ])("要所：艦型 %i は %s（%s）", (classId, nationality) => {
    expect(SHIP_CLASS_NATIONALITIES.get(classId)).toBe(nationality);
  });

  it("海外艦の艦型を除く 1〜141 の番号（42 を除く）は、すべて日本", () => {
    const notJapan = JAPAN_IDS.filter((id) => SHIP_CLASS_NATIONALITIES.get(id) !== "japan");

    expect(notJapan).toEqual([]);
  });

  it.each([MISSING_ID, 0, 142, -1])("実在しない・範囲外の艦型 %i は対応表にない", (classId) => {
    expect(SHIP_CLASS_NATIONALITIES.has(classId)).toBe(false);
  });

  it("対応表の艦型は 1〜141 のうち 42 を除く 140 種類だけで、unknown は入れない", () => {
    const values = [...SHIP_CLASS_NATIONALITIES.values()] as string[];

    expect(SHIP_CLASS_NATIONALITIES.size).toBe(140);
    expect(values).not.toContain("unknown");
  });
});
