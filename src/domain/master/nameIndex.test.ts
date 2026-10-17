// 艦名から改装段階を問わない艦名を引く索引のテスト（plan-v1 後続の対応一覧「PR-02 レビュー 4」）
import { describe, expect, it } from "vitest";
import { summer2026MasterEntries } from "@/test/fixtures";
import { createShipMaster } from "./master";
import { baseNameOfShipName } from "./nameIndex";

describe("baseNameOfShipName（艦名 → 改装段階を問わない艦名）", () => {
  const master = createShipMaster(summer2026MasterEntries);

  it.each<[string, string]>([
    ["時雨改二", "時雨"],
    ["時雨改三", "時雨"],
    ["雪風改", "雪風"],
    ["初霜改二", "初霜"],
  ])("改造後の艦名「%s」から「%s」を引ける", (shipName, expected) => {
    expect(baseNameOfShipName(master, shipName)).toBe(expected);
  });

  it("改装段階を問わない艦名そのもの（未改造の艦名）を渡すと、その艦名を返す", () => {
    expect(baseNameOfShipName(master, "時雨")).toBe("時雨");
  });

  it("前後の空白（全角の空白も含む）は無視する", () => {
    expect(baseNameOfShipName(master, "  時雨改二 ")).toBe("時雨");
    expect(baseNameOfShipName(master, "　時雨改三　")).toBe("時雨");
  });

  it.each<[string, string]>([
    ["マスタにない艦名", "存在しない艦"],
    ["空の文字列", ""],
    ["空白だけ", "   "],
    ["艦名の一部だけ", "時"],
  ])("%s は null", (_label, shipName) => {
    expect(baseNameOfShipName(master, shipName)).toBeNull();
  });
});
