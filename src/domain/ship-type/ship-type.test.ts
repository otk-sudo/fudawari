// 特効の国籍を絞る艦種の選択肢・判定・正規化・表示名（v1.1「国籍の特効を艦種で絞る」の仕様 1 章）のテスト
// 公開の入口（src/domain/ship-type/index.ts）から読み込んで、公開されていることも確かめる。
import { describe, expect, it } from "vitest";
import type { ShipLookup } from "@/domain/master/types";
import {
  BOOST_SHIP_TYPE_IDS,
  BOOST_SHIP_TYPE_OPTIONS,
  type BoostShipTypeOption,
  isBoostShipTypeId,
  normalizeShipTypeIds,
  shipTypeOptionLabelsOf,
} from "@/domain/ship-type";
import { shipTypeLabel } from "@/features/assign/ship-view";
import { summer2026MasterEntries } from "@/test/fixtures";

/** 仕様の選択肢（表示名と艦種の番号）。割り振り画面の並び順「艦型」の艦種の順 */
const OPTIONS: readonly (readonly [string, readonly number[]])[] = [
  ["戦艦", [8, 9]],
  ["航戦", [10]],
  ["正空", [11]],
  ["装空", [18]],
  ["軽空", [7]],
  ["重巡", [5]],
  ["航巡", [6]],
  ["軽巡", [3]],
  ["雷巡", [4]],
  ["練巡", [21]],
  ["駆逐", [2]],
  ["海防", [1]],
  ["潜水", [13]],
  ["潜空", [14]],
  ["水母", [16]],
  ["潜母", [20]],
  ["揚陸", [17]],
  ["補給", [15, 22]],
  ["工作", [19]],
];

/** 選べる艦種の番号（選択肢の ids を順に並べたもの） */
const IDS_IN_ORDER = [8, 9, 10, 11, 18, 7, 5, 6, 3, 4, 21, 2, 1, 13, 14, 16, 20, 17, 15, 22, 19];

/** 割り振り画面の艦カードの艦種の略称（ship-view.ts の shipTypeLabel）を、艦種の番号から引く */
function cardLabelOf(shipTypeId: number): string {
  const info: ShipLookup = { known: true, ...summer2026MasterEntries[0], shipTypeId };
  return shipTypeLabel(info);
}

describe("BOOST_SHIP_TYPE_OPTIONS（艦種の選択肢。画面・保存の正規の順）", () => {
  it("19 個の選択肢を、戦艦・航戦・正空・装空・軽空・重巡・航巡・軽巡・雷巡・練巡・駆逐・海防・潜水・潜空・水母・潜母・揚陸・補給・工作の順に持つ", () => {
    expect(BOOST_SHIP_TYPE_OPTIONS).toEqual<BoostShipTypeOption[]>(OPTIONS.map(([label, ids]) => ({ label, ids })));
    expect(BOOST_SHIP_TYPE_OPTIONS).toHaveLength(19);
  });

  it("戦艦は艦種 8・9 の両方、補給は 15・22 の両方をまとめた 1 つの選択肢", () => {
    expect(BOOST_SHIP_TYPE_OPTIONS.find((o) => o.label === "戦艦")?.ids).toEqual([8, 9]);
    expect(BOOST_SHIP_TYPE_OPTIONS.find((o) => o.label === "補給")?.ids).toEqual([15, 22]);
  });

  it("12（超弩級戦艦。使われていない）はどの選択肢にも入らない", () => {
    expect(BOOST_SHIP_TYPE_OPTIONS.flatMap((o) => o.ids)).not.toContain(12);
  });

  it("表示名は割り振り画面の艦カードの艦種の略称（ship-view の表）と同じ", () => {
    for (const option of BOOST_SHIP_TYPE_OPTIONS) {
      for (const id of option.ids) {
        expect(cardLabelOf(id), `艦種 ${id}`).toBe(option.label);
      }
    }
  });

  it("凍結されている（配列・各選択肢・各選択肢の ids）", () => {
    expect(BOOST_SHIP_TYPE_OPTIONS).toHaveLength(19);
    expect(Object.isFrozen(BOOST_SHIP_TYPE_OPTIONS)).toBe(true);
    for (const option of BOOST_SHIP_TYPE_OPTIONS) {
      expect(Object.isFrozen(option), option.label).toBe(true);
      expect(Object.isFrozen(option.ids), option.label).toBe(true);
    }
  });
});

describe("BOOST_SHIP_TYPE_IDS（選べる艦種の番号）", () => {
  it("選択肢の ids を選択肢の順に並べたもの（21 個。12 は入らない）", () => {
    expect(BOOST_SHIP_TYPE_IDS).toEqual(IDS_IN_ORDER);
    expect(BOOST_SHIP_TYPE_IDS).toEqual(BOOST_SHIP_TYPE_OPTIONS.flatMap((o) => o.ids));
  });
});

describe("isBoostShipTypeId（中身の分からない値が、選べる艦種の番号か）", () => {
  it.each(IDS_IN_ORDER.map((id) => [id]))("%s は選べる", (id) => {
    expect(isBoostShipTypeId(id)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["12（超弩級戦艦。選べない）", 12],
    ["0", 0],
    ["99", 99],
    ["負の数", -2],
    ["小数", 2.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["数の文字列", "2"],
    ["表示名", "駆逐"],
    ["null", null],
    ["undefined", undefined],
    ["配列", [2]],
    ["オブジェクト", { id: 2 }],
  ])("%s は選べない", (_label, value) => {
    expect(isBoostShipTypeId(value)).toBe(false);
  });
});

describe("normalizeShipTypeIds（選べない番号と重複を除き、正規の順に並べる）", () => {
  it("正規の順（BOOST_SHIP_TYPE_IDS の順）に並べ直す（数の順ではない：軽巡 3 が駆逐 2 より先、戦艦 8・9 が先頭）", () => {
    expect(normalizeShipTypeIds([2, 3, 9, 8])).toEqual([8, 9, 3, 2]);
  });

  it("重複を除く", () => {
    expect(normalizeShipTypeIds([2, 2, 3, 2])).toEqual([3, 2]);
  });

  it("選べない番号（12・0・99・小数）を除く", () => {
    expect(normalizeShipTypeIds([12, 2, 0, 99, 2.5])).toEqual([2]);
  });

  it("空なら空、選べない番号だけでも空", () => {
    expect(normalizeShipTypeIds([])).toEqual([]);
    expect(normalizeShipTypeIds([12, 99])).toEqual([]);
  });

  it("入力の配列は変えない（新しい配列を返す）", () => {
    const input = Object.freeze([2, 3]);

    const result = normalizeShipTypeIds(input);

    expect(result).toEqual([3, 2]);
    expect(input).toEqual([2, 3]);
    expect(result).not.toBe(input);
  });
});

describe("shipTypeOptionLabelsOf（ids のどれかを含む選択肢の表示名。選択肢の順・重複なし）", () => {
  it.each<[string, number[], string[]]>([
    ["駆逐", [2], ["駆逐"]],
    ["入力の順ではなく選択肢の順（駆逐・軽巡 → 軽巡・駆逐）", [2, 3], ["軽巡", "駆逐"]],
    ["戦艦の片方の番号だけでも「戦艦」", [9], ["戦艦"]],
    ["戦艦の 2 つの番号は「戦艦」1 つ", [8, 9], ["戦艦"]],
    ["補給（22 だけ）", [22], ["補給"]],
    ["同じ番号の重複は 1 つ", [2, 2], ["駆逐"]],
    ["選べない番号は表示名にしない", [12, 99, 2], ["駆逐"]],
    ["空", [], []],
  ])("%s", (_label, ids, expected) => {
    expect(shipTypeOptionLabelsOf(ids)).toEqual(expected);
  });
});
