// 艦型の名前の対応表（艦型の番号 api_ctype → 名前。例 23 → 「白露型」）
//
// api_start2 には艦型の名前がないため、自前で持つ（U1）。
// 対応表にない艦型は、buildShipMasterEntries（fromStart2.ts）が
// 「その艦型で図鑑番号が最も小さい艦の、改装段階を問わない艦名＋型」で補う。補った名前が正しい艦型は載せなくてよい。
//
// 中身は実装担当が作る（テストは中身に依存しない）

/** 艦型の番号 → 艦型の名前 */
export const SHIP_CLASS_NAMES: ReadonlyMap<number, string> = new Map<number, string>();
