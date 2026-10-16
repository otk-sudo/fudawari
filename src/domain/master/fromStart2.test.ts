// start2.json から艦船マスタの行を作る変換（roadmap T1-5、U1）のテスト
// 実物の start2.json は使わず、手作りの断片（src/test/fixtures/start2Fragment.ts）で確かめる
import { describe, expect, it } from "vitest";
import {
  abyssalRow,
  friendlyRow,
  start2Fragment,
  start2FragmentClassNames,
  type MstShipRow,
} from "@/test/fixtures/start2Fragment";
import { buildShipMasterEntries } from "./fromStart2";
import type { RemodelStage, ShipMasterEntry } from "./types";

/** 結果から艦 ID で 1 行を取り出す（ないと失敗） */
function entryOf(entries: readonly ShipMasterEntry[], id: number): ShipMasterEntry {
  const found = entries.find((e) => e.id === id);
  if (found === undefined) {
    throw new Error(`艦 ID ${id} の行がない`);
  }
  return found;
}

/** api_mst_ship だけを持つ start2 の断片 */
function start2Of(rows: MstShipRow[]): { api_mst_ship: MstShipRow[] } {
  return { api_mst_ship: rows };
}

/** 艦型の名前を確かめるための、改造先のない単独の艦（図鑑番号・艦型の番号だけを変える） */
function soloRow(id: number, name: string, ctype: number, sortno: number, after = "0"): MstShipRow {
  return friendlyRow({ id, sortno, name, yomi: "", stype: 2, ctype, luck: [10, 49], after });
}

describe("buildShipMasterEntries（start2.json から自前の形式の艦船マスタを作る）", () => {
  it("味方艦の項目を ShipMasterEntry の形に写す（時雨改二）", () => {
    // 実行
    const entries = buildShipMasterEntries(start2Fragment, start2FragmentClassNames);

    // 検証
    expect(entryOf(entries, 145)).toEqual({
      id: 145,
      name: "時雨改二",
      yomi: "しぐれ",
      baseName: "時雨",
      shipTypeId: 2,
      shipClassId: 23,
      shipClassName: "白露型",
      remodelStage: "intermediate",
      sortNo: 243,
      luckBase: 15, // api_luck[0]（初期値）。api_luck[1]（最大値）は使わない
    });
  });

  it("ShipMasterEntry の項目だけを持ち、ほかの項目（耐久・燃料・api_* など）は入れない", () => {
    const entries = buildShipMasterEntries(start2Fragment, start2FragmentClassNames);

    const expectedKeys = [
      "baseName",
      "id",
      "luckBase",
      "name",
      "remodelStage",
      "shipClassId",
      "shipClassName",
      "shipTypeId",
      "sortNo",
      "yomi",
    ];
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(expectedKeys);
    }
  });

  it("味方艦（api_id が 1500 未満）だけを入れ、深海棲艦（1500 以上）は入れない", () => {
    const rows = [soloRow(1499, "境界の味方艦", 900, 1499), abyssalRow(1500, "境界の深海棲艦"), abyssalRow(1501, "駆逐イ級")];

    const entries = buildShipMasterEntries(start2Of(rows), new Map([[900, "境界型"]]));

    expect(entries.map((e) => e.id)).toEqual([1499]);
  });

  it("結果は艦 ID の昇順に並ぶ（入力の順に左右されない）", () => {
    const shuffled = start2Of([...start2Fragment.api_mst_ship].reverse());

    const entries = buildShipMasterEntries(shuffled, start2FragmentClassNames);

    expect(entries.map((e) => e.id)).toEqual([43, 124, 129, 145, 243, 503, 508, 961]);
  });

  it.each<[number, string, RemodelStage]>([
    [43, "時雨", "unremodeled"],
    [243, "時雨改", "intermediate"],
    [145, "時雨改二", "intermediate"],
    [961, "時雨改三", "final"],
  ])("改造の連鎖：艦 ID %i（%s）は %s、改装段階を問わない艦名は「時雨」", (id, name, remodelStage) => {
    const entries = buildShipMasterEntries(start2Fragment, start2FragmentClassNames);

    expect(entryOf(entries, id)).toMatchObject({ name, baseName: "時雨", remodelStage });
  });

  it("コンバート改装の輪（鈴谷改二 ⇄ 鈴谷航改二）の艦はどちらも最終改造、改装段階を問わない艦名は起点の「鈴谷」", () => {
    const entries = buildShipMasterEntries(start2Fragment, start2FragmentClassNames);

    expect([124, 129, 503, 508].map((id) => [id, entryOf(entries, id).baseName, entryOf(entries, id).remodelStage])).toEqual([
      [124, "鈴谷", "unremodeled"],
      [129, "鈴谷", "intermediate"],
      [503, "鈴谷", "final"],
      [508, "鈴谷", "final"],
    ]);
  });

  describe("艦型の名前", () => {
    it("対応表にある艦型は、対応表の名前を使う（補う規則より優先する）", () => {
      // 時雨系だけの断片：補う規則なら「時雨型」になるが、対応表の「白露型」を使う
      const rows = start2Fragment.api_mst_ship.filter((r) => r.api_ctype === 23);

      const entries = buildShipMasterEntries(start2Of(rows), new Map([[23, "白露型"]]));

      expect(entries.map((e) => e.shipClassName)).toEqual(["白露型", "白露型", "白露型", "白露型"]);
    });

    it("対応表にない艦型は「その艦型で図鑑番号が最も小さい艦の艦名＋型」で補う（艦 ID や入力の順ではなく図鑑番号で選ぶ）", () => {
      // 艦型 900：入力の先頭・艦 ID が最小の「乙」より、図鑑番号が最小の「甲」を使う
      const rows = [soloRow(10, "乙", 900, 300), soloRow(30, "丙", 900, 200), soloRow(20, "甲", 900, 100)];

      const entries = buildShipMasterEntries(start2Of(rows), new Map());

      expect(entries.map((e) => [e.id, e.shipClassName])).toEqual([
        [10, "甲型"],
        [20, "甲型"],
        [30, "甲型"],
      ]);
    });

    it("補うときは、図鑑番号が最も小さい艦の「改装段階を問わない艦名」を使う（その艦が改造後の艦でも）", () => {
      // 艦型 901：図鑑番号が最小なのは「丁改」（改造後の艦。起点は「丁」）→「丁改型」ではなく「丁型」
      const rows = [soloRow(40, "丁", 901, 50, "41"), soloRow(41, "丁改", 901, 5)];

      const entries = buildShipMasterEntries(start2Of(rows), new Map());

      expect(entries.map((e) => e.shipClassName)).toEqual(["丁型", "丁型"]);
    });

    it("対応表にある艦型と、補う艦型が混ざっていても、艦型ごとに決める", () => {
      const rows = [...start2Fragment.api_mst_ship];

      // 艦型 23 だけ対応表にある。艦型 9（鈴谷系）は補う →「鈴谷型」
      const entries = buildShipMasterEntries(start2Of(rows), new Map([[23, "白露型"]]));

      expect(entryOf(entries, 961).shipClassName).toBe("白露型");
      expect(entryOf(entries, 508).shipClassName).toBe("鈴谷型");
    });
  });
});
