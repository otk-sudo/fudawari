// start2.json から艦船マスタの行を作る変換（roadmap T1-5、U1）のテスト
// 実物の start2.json は使わず、手作りの断片（src/test/fixtures/start2Fragment.ts）で確かめる
import { describe, expect, it } from "vitest";
import {
  abyssalRow,
  friendlyRow,
  start2Fragment,
  start2FragmentClassNames,
  start2FragmentClassNationalities,
  type MstShipRow,
} from "@/test/fixtures/start2Fragment";
import {
  buildShipMasterEntries,
  findInvalidFriendlyRows,
  type InvalidFriendlyRowField,
  readStart2,
  type Start2Like,
} from "./fromStart2";
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
    const entries = buildShipMasterEntries(start2Fragment, start2FragmentClassNames, start2FragmentClassNationalities);

    // 検証
    expect(entryOf(entries, 145)).toEqual({
      id: 145,
      name: "時雨改二",
      yomi: "しぐれ",
      baseName: "時雨",
      shipTypeId: 2,
      shipClassId: 23,
      shipClassName: "白露型",
      nationality: "japan", // v1.1：艦型の国籍の対応表から
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
      "nationality",
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

  describe("国籍（v1.1。艦型の番号 → 国籍の対応表から入れる）", () => {
    it("対応表にある艦型の艦は、改造の段階によらず対応表の国籍になる（時雨系 23 → 日本、鈴谷系 9 → ドイツ）", () => {
      // 実行
      const entries = buildShipMasterEntries(start2Fragment, start2FragmentClassNames, start2FragmentClassNationalities);

      // 検証
      expect(entries.map((e) => [e.id, e.nationality])).toEqual([
        [43, "japan"],
        [124, "germany"],
        [129, "germany"],
        [145, "japan"],
        [243, "japan"],
        [503, "germany"],
        [508, "germany"],
        [961, "japan"],
      ]);
    });

    it("対応表にない艦型の艦は unknown（艦型 23 だけの対応表なら、鈴谷系は unknown）", () => {
      const entries = buildShipMasterEntries(start2Fragment, start2FragmentClassNames, new Map([[23, "usa"]]));

      expect(entryOf(entries, 961).nationality).toBe("usa");
      expect(entryOf(entries, 124).nationality).toBe("unknown");
      expect(entryOf(entries, 508).nationality).toBe("unknown");
    });

    it("国籍の対応表を省略すると（既定は空の対応表）、すべての艦が unknown", () => {
      const entries = buildShipMasterEntries(start2Fragment, start2FragmentClassNames);

      expect(new Set(entries.map((e) => e.nationality))).toEqual(new Set(["unknown"]));
    });

    it("国籍の対応表は、艦型の名前の対応表とは別に引く（名前を補った艦型でも、国籍の対応表にあればその国籍）", () => {
      // 艦型 900 は名前の対応表になく「甲型」と補うが、国籍の対応表には「イタリア」がある
      const rows = [soloRow(20, "甲", 900, 100), soloRow(30, "乙", 900, 200)];

      const entries = buildShipMasterEntries(start2Of(rows), new Map(), new Map([[900, "italy"]]));

      expect(entries.map((e) => [e.shipClassName, e.nationality])).toEqual([
        ["甲型", "italy"],
        ["甲型", "italy"],
      ]);
    });
  });
});

// ---- readStart2（JSON として読んだ start2.json から、マスタの生成に使う部分を取り出す） ----

/** readStart2 で読む（null なら失敗） */
function readOrFail(data: unknown): Start2Like {
  const start2 = readStart2(data);
  if (start2 === null) {
    throw new Error("readStart2 が null を返した");
  }
  return start2;
}

/** 時雨改三（961）の行（値は start2Fragment と同じ） */
function shigureKai3(): Record<string, unknown> {
  return { ...friendlyRow({ id: 961, sortno: 343, name: "時雨改三", yomi: "しぐれ", stype: 2, ctype: 23, luck: [20, 69], after: "0" }) };
}

/** 行から 1 つの項目を除いた写し */
function without(row: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...row };
  delete copy[key];
  return copy;
}

describe("readStart2（start2.json から、マスタの生成に使う部分を取り出す）", () => {
  it.each<[string, unknown]>([
    ["null", null],
    ["配列", []],
    ["api_mst_ship がない", { api_mst_stype: [] }],
    ["api_mst_ship が配列でない", { api_mst_ship: {} }],
  ])("%s なら null", (_label, data) => {
    expect(readStart2(data)).toBeNull();
  });

  it("使う項目だけを写し、ほかの項目（耐久・燃料など）は捨てる", () => {
    const start2 = readOrFail({ api_mst_ship: [shigureKai3()] });

    expect(start2.api_mst_ship).toEqual([
      {
        api_id: 961,
        api_name: "時雨改三",
        api_yomi: "しぐれ",
        api_stype: 2,
        api_ctype: 23,
        api_sortno: 343,
        api_luck: [20, 69],
        api_aftershipid: "0",
      },
    ]);
  });

  it("艦 ID（正の整数）・艦名（文字列）が読めない行と、オブジェクトでない行は飛ばし、残りの行を読む", () => {
    const data = {
      api_mst_ship: [
        null,
        "時雨",
        [],
        { api_id: 0, api_name: "艦 ID が 0" },
        { api_id: -1, api_name: "艦 ID が負" },
        { api_id: 1.5, api_name: "艦 ID が整数でない" },
        { api_id: "43", api_name: "艦 ID が文字列" },
        { api_name: "艦 ID がない" },
        { api_id: 44, api_name: 44 },
        { api_id: 45 },
        { api_id: 46, api_name: "白露" },
      ],
    };

    const start2 = readOrFail(data);

    expect(start2.api_mst_ship.map((row) => [row.api_id, row.api_name])).toEqual([[46, "白露"]]);
  });

  it("api_aftershipid が数で入っていても、改造先として文字列にそろえて読む", () => {
    const start2 = readOrFail({ api_mst_ship: [{ ...shigureKai3(), api_id: 145, api_aftershipid: 961 }] });

    expect(start2.api_mst_ship[0].api_aftershipid).toBe("961");
  });

  it("api_luck の 0 番目が数でない（[null, 69]）とき、最大値（69）を運の初期値の位置に詰めない", () => {
    const start2 = readOrFail({ api_mst_ship: [{ ...shigureKai3(), api_luck: [null, 69] }] });

    expect(start2.api_mst_ship[0].api_luck?.[0]).not.toBe(69);
    expect(buildShipMasterEntries(start2, start2FragmentClassNames)[0].luckBase).not.toBe(69);
  });
});

// ---- findInvalidFriendlyRows（マスタに必要な項目が数でない味方艦の行） ----

describe("findInvalidFriendlyRows（図鑑番号・艦種・艦型・運の初期値が数でない味方艦の行を見つける）", () => {
  it("正しい断片なら空（深海棲艦の行に図鑑番号・運がなくても対象にしない）", () => {
    expect(findInvalidFriendlyRows(start2Fragment)).toEqual([]);
  });

  it.each<[string, (row: Record<string, unknown>) => Record<string, unknown>, InvalidFriendlyRowField]>([
    ["api_sortno が文字列", (row) => ({ ...row, api_sortno: "343" }), "api_sortno"],
    ["api_sortno がない", (row) => without(row, "api_sortno"), "api_sortno"],
    ["api_stype が null", (row) => ({ ...row, api_stype: null }), "api_stype"],
    ["api_ctype がない", (row) => without(row, "api_ctype"), "api_ctype"],
    ["api_luck の 0 番目が null（[null, 69]）", (row) => ({ ...row, api_luck: [null, 69] }), "api_luck"],
    ["api_luck がない", (row) => without(row, "api_luck"), "api_luck"],
    ["api_luck が空の配列", (row) => ({ ...row, api_luck: [] }), "api_luck"],
    ["api_luck が配列でない", (row) => ({ ...row, api_luck: 20 }), "api_luck"],
  ])("味方艦の %s なら、その艦 ID と項目を返す（readStart2 で読んだ後に確かめる）", (_label, change, field) => {
    const start2 = readOrFail({ api_mst_ship: [change(shigureKai3())] });

    expect(findInvalidFriendlyRows(start2)).toEqual([{ id: 961, fields: [field] }]);
  });

  it("1 つの行で数でない項目が複数あれば、api_sortno・api_stype・api_ctype・api_luck の順にすべて返す", () => {
    const row = { api_id: 961, api_name: "時雨改三", api_sortno: null, api_stype: "駆逐艦", api_luck: [null, 69] };

    const result = findInvalidFriendlyRows(readOrFail({ api_mst_ship: [row] }));

    expect(result).toEqual([{ id: 961, fields: ["api_sortno", "api_stype", "api_ctype", "api_luck"] }]);
  });

  it("項目が数でない味方艦の行が複数あれば、すべての行を返す", () => {
    const rows = start2Fragment.api_mst_ship.map((row) =>
      row.api_id === 43 || row.api_id === 508 ? { ...row, api_ctype: "x" } : row,
    );

    const result = findInvalidFriendlyRows(readOrFail({ api_mst_ship: rows }));

    expect(result.map((r) => r.id).sort((a, b) => a - b)).toEqual([43, 508]);
  });

  it("艦 ID 1499（味方艦）は対象にし、1500 以上（深海棲艦）は項目が欠けていても対象にしない", () => {
    const rows = [
      { api_id: 1499, api_name: "境界の味方艦" },
      { api_id: 1500, api_name: "境界の深海棲艦" },
      abyssalRow(1501, "駆逐イ級"),
    ];

    const result = findInvalidFriendlyRows(readOrFail({ api_mst_ship: rows }));

    expect(result.map((r) => r.id)).toEqual([1499]);
  });

  it("図鑑番号 0 は数なので、数でない項目として扱わない（未実装の艦の行など）", () => {
    const start2 = readOrFail({ api_mst_ship: [{ ...shigureKai3(), api_sortno: 0 }] });

    expect(findInvalidFriendlyRows(start2)).toEqual([]);
  });

  it("readStart2 を通さずに渡した値でも、項目が欠けている味方艦の行を見つける", () => {
    const start2: Start2Like = { api_mst_ship: [{ api_id: 43, api_name: "時雨", api_sortno: 43, api_stype: 2, api_ctype: 23 }] };

    expect(findInvalidFriendlyRows(start2)).toEqual([{ id: 43, fields: ["api_luck"] }]);
  });
});
