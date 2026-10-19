// 特効グループの効く条件の要約（UI／UX の指摘 中9）のテスト
import { describe, expect, it } from "vitest";
import type { BoostGroup } from "@/domain/definition/types";
import { EMPTY_BOOST_SUMMARY, summarizeBoostGroup } from "./boost-summary";
import * as definitionEdit from "./index";

/** 艦種の番号（api_stype） */
const DESTROYER = 2;
const LIGHT_CRUISER = 3;

/** 特効グループを作る（指定しない項目は 冬月・北上 ×1.21） */
function group(patch: Partial<BoostGroup> = {}): BoostGroup {
  return { id: "g", name: "第三十一戦隊B", multiplier: 1.21, shipNames: ["冬月", "北上"], ...patch };
}

describe("summarizeBoostGroup（特効グループの効く条件の要約）", () => {
  it("艦名だけなら、艦名を「・」でつないで「冬月・北上に ×1.21」", () => {
    expect(summarizeBoostGroup(group())).toBe("冬月・北上に ×1.21");
  });

  it("艦名と国籍・艦種があれば「冬月・北上、またはアメリカの駆逐に ×1.21」", () => {
    expect(summarizeBoostGroup(group({ nationalities: ["usa"], shipTypes: [DESTROYER] }))).toBe(
      "冬月・北上、またはアメリカの駆逐に ×1.21",
    );
  });

  it("国籍だけ（艦種なし）なら「アメリカの艦に ×1.10」（倍率は小数 2 桁）", () => {
    expect(summarizeBoostGroup(group({ shipNames: [], nationalities: ["usa"], multiplier: 1.1 }))).toBe(
      "アメリカの艦に ×1.10",
    );
  });

  it("国籍・艦種が複数なら、それぞれ「・」でつなぐ（保存の順のまま）", () => {
    expect(
      summarizeBoostGroup(
        group({ shipNames: [], nationalities: ["usa", "uk"], shipTypes: [LIGHT_CRUISER, DESTROYER], multiplier: 1.3 }),
      ),
    ).toBe("アメリカ・イギリスの軽巡・駆逐に ×1.30");
  });

  it("艦名も国籍もなければ、効く艦がまだないことを書く", () => {
    expect(summarizeBoostGroup(group({ name: "", shipNames: [], multiplier: 1 }))).toBe(EMPTY_BOOST_SUMMARY);
  });

  it("入口（@/domain/definition-edit）から使える", () => {
    expect(definitionEdit.summarizeBoostGroup).toBe(summarizeBoostGroup);
  });
});
