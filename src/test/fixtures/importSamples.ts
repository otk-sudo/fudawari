// 取り込みのテスト用サンプル（制空権シミュ形式。仕様から手で作った。実在のユーザーのデータではない）
//
// - 形式の仕様：docs/research/import-and-master.md、要件 3.4（U8）
// - 艦の ID と運の初期値は仮マスタ（shipMaster.ts の summer2026MasterEntries）に合わせた。
//   艦 ID 99999 は仮マスタにない艦（名前が分からない艦）。
// - 近代化改修（api_kyouka／st）の並びは 火力・雷装・対空・装甲・運・耐久・対潜。運は 4 番目（0 始まり）。
//
// 使い方
// - svShip()／compactShip() で 1 隻分を作り、toSvdataText()／toCompactText() で貼り付ける文字列にする
// - 既定の値の上に渡した項目を重ねる。艦の ID・個体 ID は既定に入れていない（渡さなければ「欠けている」要素になる）

/** 近代化改修の配列（運だけを指定し、ほかは 0） */
export function kyouka(luck: number): number[] {
  return [0, 0, 0, 0, luck, 0, 0];
}

/** svdata 形式の 1 隻（api_data.api_ship の要素）。解析に使わない項目も、実際の応答に近づけるため入れる */
export function svShip(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    api_lv: 1,
    api_exp: [0, 100, 0],
    api_nowhp: 16,
    api_maxhp: 16,
    api_slot: [-1, -1, -1, -1, -1],
    api_onslot: [0, 0, 0, 0, 0],
    api_slot_ex: 0,
    api_kyouka: kyouka(0),
    api_cond: 49,
    api_slotnum: 2,
    api_sally_area: 0,
    api_locked: 0,
    ...fields,
  };
}

/** 短縮形式の 1 隻。古い形式（個体 ID なし）にするときは ship_id を渡さず、id に艦の ID を入れる */
export function compactShip(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    lv: 1,
    exp: [0, 100, 0],
    st: kyouka(0),
    ex: 0,
    area: 0,
    sp: [],
    ...fields,
  };
}

/** svdata 形式の貼り付ける文字列（`svdata=` ＋ API 応答の JSON） */
export function toSvdataText(ships: readonly unknown[]): string {
  return `svdata=${JSON.stringify({ api_result: 1, api_result_msg: "成功", api_data: { api_ship: ships } })}`;
}

/** 短縮形式の貼り付ける文字列（JSON 配列） */
export function toCompactText(ships: readonly unknown[]): string {
  return JSON.stringify(ships);
}

/**
 * 標準のサンプル（5 隻＋艦の ID が 0 の要素 1 つ）。svdata 形式・新しい短縮形式で同じ艦を表す
 *
 * | 個体 ID | 艦（艦 ID）          | Lv  | 運の改修 | 運の表示値     | 札 | ロック |
 * |---------|----------------------|-----|----------|----------------|----|--------|
 * | 101     | 時雨改三（961）      | 175 | 39       | 20＋39＝59     | 0  | あり   |
 * | 102     | 時雨改二（145）      | 99  | 7        | 15＋7＝22      | 3  | あり   |
 * | 103     | 雪風改二（656）      | 168 | 20       | 52＋20＝72     | 0  | なし   |
 * | 104     | マスタにない（99999）| 50  | 5        | 0＋5＝5        | 2  | あり   |
 * | 105     | 初霜改二（419）      | 98  | 0        | 20＋0＝20      | 0  | なし   |
 * | 106     | （艦の ID が 0）     | 10  | 0        | 飛ばす         | 0  | あり   |
 */
export const standardSamples = [
  { uid: 101, shipId: 961, lv: 175, luckUp: 39, area: 0, locked: 1 },
  { uid: 102, shipId: 145, lv: 99, luckUp: 7, area: 3, locked: 1 },
  { uid: 103, shipId: 656, lv: 168, luckUp: 20, area: 0, locked: 0 },
  { uid: 104, shipId: 99999, lv: 50, luckUp: 5, area: 2, locked: 1 },
  { uid: 105, shipId: 419, lv: 98, luckUp: 0, area: 0, locked: 0 },
  { uid: 106, shipId: 0, lv: 10, luckUp: 0, area: 0, locked: 1 },
] as const;

/** 標準のサンプルを svdata 形式の文字列にしたもの */
export const standardSvdataText = toSvdataText(
  standardSamples.map((s) =>
    svShip({
      api_id: s.uid,
      api_ship_id: s.shipId,
      api_lv: s.lv,
      api_kyouka: kyouka(s.luckUp),
      api_sally_area: s.area,
      api_locked: s.locked,
    }),
  ),
);

/** 標準のサンプルを新しい短縮形式の文字列にしたもの（ロックの情報はない） */
export const standardCompactText = toCompactText(
  standardSamples.map((s) =>
    compactShip({ id: s.uid, ship_id: s.shipId, lv: s.lv, st: kyouka(s.luckUp), area: s.area }),
  ),
);
