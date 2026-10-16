import { describe, expect, it } from "vitest";
import { deriveRemodelInfo } from "./remodel";
import type { ApiMstShipLike, RemodelInfo } from "./types";

/** api_mst_ship に近い 1 行を作る（改造の連鎖に関係しない項目は適当な値） */
function row(api_id: number, api_name: string, api_aftershipid?: string): ApiMstShipLike {
  return {
    api_id,
    api_name,
    api_yomi: "",
    api_stype: 2,
    api_ctype: 1,
    api_sortno: api_id,
    api_luck: [10, 50],
    ...(api_aftershipid === undefined ? {} : { api_aftershipid }),
  };
}

/** 結果を艦 ID の昇順の [ID, 値] の配列にして比べやすくする */
function entriesOf(result: Map<number, RemodelInfo>): [number, RemodelInfo][] {
  return [...result.entries()].sort(([a], [b]) => a - b);
}

describe("deriveRemodelInfo（改造の連鎖から、改装段階を問わない艦名と改造状態を求める）", () => {
  it("一本の連鎖：起点は未改造、途中は中間改造、改造先が \"0\" の艦は最終改造。艦名は起点の名前", () => {
    // 準備：時雨 43 → 時雨改 243 → 時雨改二 145 → 時雨改三 961（実際の api_start2 と同じ。入力の順は並べ替えてある）
    const ships = [row(961, "時雨改三", "0"), row(43, "時雨", "243"), row(145, "時雨改二", "961"), row(243, "時雨改", "145")];

    // 実行
    const result = deriveRemodelInfo(ships);

    // 検証
    expect(entriesOf(result)).toEqual([
      [43, { baseName: "時雨", remodelStage: "unremodeled" }],
      [145, { baseName: "時雨", remodelStage: "intermediate" }],
      [243, { baseName: "時雨", remodelStage: "intermediate" }],
      [961, { baseName: "時雨", remodelStage: "final" }],
    ]);
  });

  it("コンバート改装の輪：輪に入っている艦はどれも最終改造。改装段階を問わない艦名は起点の名前（大鯨 → 龍鳳）", () => {
    // 準備：大鯨 → 龍鳳 → 龍鳳改 → 龍鳳改二戊 ⇄ 龍鳳改二
    const ships = [
      row(184, "大鯨", "185"),
      row(185, "龍鳳", "318"),
      row(318, "龍鳳改", "883"),
      row(883, "龍鳳改二戊", "888"),
      row(888, "龍鳳改二", "883"),
    ];

    const result = deriveRemodelInfo(ships);

    expect(entriesOf(result)).toEqual([
      [184, { baseName: "大鯨", remodelStage: "unremodeled" }],
      [185, { baseName: "大鯨", remodelStage: "intermediate" }],
      [318, { baseName: "大鯨", remodelStage: "intermediate" }],
      [883, { baseName: "大鯨", remodelStage: "final" }],
      [888, { baseName: "大鯨", remodelStage: "final" }],
    ]);
  });

  it("3 つの艦で回る輪でも、輪に入っている艦はすべて最終改造", () => {
    // 準備：テスト艦 → 改 → 甲 → 乙 → 丙 → 甲（甲・乙・丙が輪）
    const ships = [
      row(9001, "テスト艦", "9002"),
      row(9002, "テスト艦改", "9003"),
      row(9003, "テスト艦甲", "9004"),
      row(9004, "テスト艦乙", "9005"),
      row(9005, "テスト艦丙", "9003"),
    ];

    const result = deriveRemodelInfo(ships);

    expect(entriesOf(result).map(([id, info]) => [id, info.remodelStage])).toEqual([
      [9001, "unremodeled"],
      [9002, "intermediate"],
      [9003, "final"],
      [9004, "final"],
      [9005, "final"],
    ]);
    expect(new Set(entriesOf(result).map(([, info]) => info.baseName))).toEqual(new Set(["テスト艦"]));
  });

  it("改造が 1 回だけの艦：改造後は最終改造（名前に「改二」がなくても連鎖で決める）", () => {
    // 準備：浜波 → 浜波改（改造先なし）
    const ships = [row(9101, "浜波", "9102"), row(9102, "浜波改", "0")];

    const result = deriveRemodelInfo(ships);

    expect(result.get(9101)).toEqual({ baseName: "浜波", remodelStage: "unremodeled" });
    expect(result.get(9102)).toEqual({ baseName: "浜波", remodelStage: "final" });
  });

  it("改造先も改造元もない単独の艦は未改造で、艦名はそのまま", () => {
    const result = deriveRemodelInfo([row(9201, "単独艦", "0")]);

    expect(result.get(9201)).toEqual({ baseName: "単独艦", remodelStage: "unremodeled" });
  });

  it("api_aftershipid がない行（深海棲艦など）は改造先なしとして扱う", () => {
    // 準備：改造先のある艦の改造先に api_aftershipid がない場合と、単独の行
    const ships = [row(9301, "テスト駆逐", "9302"), row(9302, "テスト駆逐改"), row(1501, "駆逐イ級")];

    const result = deriveRemodelInfo(ships);

    expect(result.get(9301)).toEqual({ baseName: "テスト駆逐", remodelStage: "unremodeled" });
    expect(result.get(9302)).toEqual({ baseName: "テスト駆逐", remodelStage: "final" });
    expect(result.get(1501)).toEqual({ baseName: "駆逐イ級", remodelStage: "unremodeled" });
  });

  it("複数の連鎖が混ざっていても、入力のすべての艦 ID を連鎖ごとに正しく求める", () => {
    const ships = [
      row(43, "時雨", "243"),
      row(41, "初霜", "241"),
      row(243, "時雨改", "0"),
      row(241, "初霜改", "419"),
      row(419, "初霜改二", "0"),
    ];

    const result = deriveRemodelInfo(ships);

    expect(result.size).toBe(5);
    expect(result.get(243)).toEqual({ baseName: "時雨", remodelStage: "final" });
    expect(result.get(241)).toEqual({ baseName: "初霜", remodelStage: "intermediate" });
    expect(result.get(419)).toEqual({ baseName: "初霜", remodelStage: "final" });
  });

  it("空の入力では空の結果を返す", () => {
    expect(deriveRemodelInfo([]).size).toBe(0);
  });
});
