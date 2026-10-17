// テスト用の start2.json の断片（手作り。実物の start2.json はリポジトリに入れない）
//
// - 形は Tibowl/api_start2 の start2.json に合わせた（トップに api_mst_* が直接並ぶ。api_data の包みはない。
//   docs/research/import-and-master.md）。
// - 時雨系（43 → 243 → 145 → 961、艦型の番号 23、艦種 2、読み「しぐれ」、961 の改造先は "0"）は実物と同じ。
//   図鑑番号・運の値はテスト用の値で、実物とは一致しない場合がある。
// - 鈴谷系は「連鎖の最後にコンバート改装の輪（改二 ⇄ 航改二）がある」形の例。ID・艦型の番号・図鑑番号はテスト用の値。
// - api_id が 1500 以上の行は深海棲艦（味方艦ではない）。実物と同じく api_aftershipid・api_luck などがない。
// - マスタに使わない項目（耐久・装甲・燃料など）も入れてある。抜き出しで捨てられることを確かめるため。
import type { ApiMstShipLike } from "@/domain/master/types";
import type { BoostNationality } from "@/domain/nationality";

/** start2.json の api_mst_ship の 1 行（マスタに使わない項目も持てる） */
export type MstShipRow = ApiMstShipLike & { [key: string]: unknown };

/** 味方艦の 1 行を作る（マスタに使わない項目は適当な値で埋める） */
export function friendlyRow(fields: {
  id: number;
  sortno: number;
  name: string;
  yomi: string;
  stype: number;
  ctype: number;
  luck: [number, number];
  after: string;
}): MstShipRow {
  return {
    api_id: fields.id,
    api_sortno: fields.sortno,
    api_sort_id: fields.sortno * 10 + 1,
    api_name: fields.name,
    api_yomi: fields.yomi,
    api_stype: fields.stype,
    api_ctype: fields.ctype,
    api_afterlv: fields.after === "0" ? 0 : 50,
    api_aftershipid: fields.after,
    api_taik: [16, 31],
    api_souk: [6, 19],
    api_houg: [10, 29],
    api_raig: [24, 69],
    api_tyku: [9, 39],
    api_luck: fields.luck,
    api_soku: 10,
    api_leng: 1,
    api_slot_num: 2,
    api_maxeq: [0, 0, 0, 0, 0],
    api_buildtime: 24,
    api_broken: [1, 1, 4, 0],
    api_powup: [1, 1, 0, 0],
    api_backs: 4,
    api_afterfuel: 100,
    api_afterbull: 100,
    api_fuel_max: 15,
    api_bull_max: 20,
    api_voicef: 0,
  };
}

/** 深海棲艦の 1 行を作る（実物と同じく、改造先・運・図鑑番号がない） */
export function abyssalRow(id: number, name: string): MstShipRow {
  return {
    api_id: id,
    api_sort_id: 0,
    api_name: name,
    api_yomi: "-",
    api_stype: 2,
    api_ctype: 1,
    api_soku: 10,
    api_slot_num: 3,
  };
}

const rows: MstShipRow[] = [
  // 時雨系（ID・艦型の番号・改造先は実物と同じ）
  friendlyRow({ id: 43, sortno: 43, name: "時雨", yomi: "しぐれ", stype: 2, ctype: 23, luck: [10, 49], after: "243" }),
  friendlyRow({ id: 243, sortno: 143, name: "時雨改", yomi: "しぐれ", stype: 2, ctype: 23, luck: [10, 49], after: "145" }),
  friendlyRow({ id: 145, sortno: 243, name: "時雨改二", yomi: "しぐれ", stype: 2, ctype: 23, luck: [15, 59], after: "961" }),
  friendlyRow({ id: 961, sortno: 343, name: "時雨改三", yomi: "しぐれ", stype: 2, ctype: 23, luck: [20, 69], after: "0" }),
  // 鈴谷系（連鎖の最後に輪：鈴谷改二 503 ⇄ 鈴谷航改二 508。値はテスト用）
  friendlyRow({ id: 124, sortno: 124, name: "鈴谷", yomi: "すずや", stype: 5, ctype: 9, luck: [5, 39], after: "129" }),
  friendlyRow({ id: 129, sortno: 129, name: "鈴谷改", yomi: "すずや", stype: 6, ctype: 9, luck: [6, 49], after: "503" }),
  friendlyRow({ id: 503, sortno: 503, name: "鈴谷改二", yomi: "すずや", stype: 5, ctype: 9, luck: [10, 59], after: "508" }),
  friendlyRow({ id: 508, sortno: 508, name: "鈴谷航改二", yomi: "すずや", stype: 6, ctype: 9, luck: [10, 59], after: "503" }),
  // 深海棲艦（味方艦ではないので、マスタに入れない）
  abyssalRow(1501, "駆逐イ級"),
  abyssalRow(1502, "駆逐ロ級"),
];

/** テスト用の start2.json の断片（実物にあるほかの api_mst_* も少しだけ入れる） */
export const start2Fragment = {
  api_mst_ship: rows,
  api_mst_stype: [
    { api_id: 2, api_sortno: 2, api_name: "駆逐艦" },
    { api_id: 5, api_sortno: 5, api_name: "重巡洋艦" },
    { api_id: 6, api_sortno: 6, api_name: "航空巡洋艦" },
  ],
  api_mst_shipupgrade: [],
};

/** start2Fragment に合わせた艦型の名前の対応表（艦型の番号 → 名前） */
export const start2FragmentClassNames: ReadonlyMap<number, string> = new Map([
  [23, "白露型"],
  [9, "最上型"],
]);

/** start2Fragment に合わせた艦型の国籍の対応表（艦型の番号 → 国籍。v1.1）。時雨系（23）は日本、鈴谷系（9）はテスト用にドイツにした */
export const start2FragmentClassNationalities: ReadonlyMap<number, BoostNationality> = new Map<number, BoostNationality>([
  [23, "japan"],
  [9, "germany"],
]);
