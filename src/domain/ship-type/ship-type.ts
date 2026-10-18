// 特効グループの国籍の条件を絞る艦種（v1.1「国籍の特効を艦種で絞る」。U11）。純粋な値と関数
//
// - 特効グループは任意の shipTypes（艦種の番号〔api_stype〕の一覧）を持てる。国籍の条件を艦種で絞るためのもので、
//   国籍のない（艦種だけの）グループは作らない（艦種補正は扱わない）。
// - 画面では艦種を「選択肢」（表示名と艦種の番号の組）で選ぶ。戦艦（8・9）と補給（15・22）は 2 つの番号を 1 つにまとめる。
//   12（超弩級戦艦）は使われていないので選べない。
// - 表示名は割り振り画面の艦カードの艦種の略称に、並びは割り振り画面の並び順「艦型」の艦種の順に合わせる。
//   BOOST_SHIP_TYPE_IDS（選択肢の ids を順に並べたもの）の並びが、画面と保存（定義の shipTypes）の正規の順。

/** 艦種の選択肢（表示名と、それに当たる艦種の番号） */
export interface BoostShipTypeOption {
  readonly label: string;
  readonly ids: readonly number[];
}

/** 選択肢を凍結して作る */
function option(label: string, ids: readonly number[]): BoostShipTypeOption {
  return Object.freeze({ label, ids: Object.freeze([...ids]) });
}

/** 艦種の選択肢（凍結済み）。この並びが画面・保存の正規の順 */
export const BOOST_SHIP_TYPE_OPTIONS: readonly BoostShipTypeOption[] = Object.freeze([
  option("戦艦", [8, 9]),
  option("航戦", [10]),
  option("正空", [11]),
  option("装空", [18]),
  option("軽空", [7]),
  option("重巡", [5]),
  option("航巡", [6]),
  option("軽巡", [3]),
  option("雷巡", [4]),
  option("練巡", [21]),
  option("駆逐", [2]),
  option("海防", [1]),
  option("潜水", [13]),
  option("潜空", [14]),
  option("水母", [16]),
  option("潜母", [20]),
  option("揚陸", [17]),
  option("補給", [15, 22]),
  option("工作", [19]),
]);

/** 選べる艦種の番号（選択肢の ids を選択肢の順に並べたもの。凍結済み） */
export const BOOST_SHIP_TYPE_IDS: readonly number[] = Object.freeze(BOOST_SHIP_TYPE_OPTIONS.flatMap((o) => o.ids));

/** 艦種の番号 → 正規の順の位置 */
const ID_RANK: ReadonlyMap<number, number> = new Map(BOOST_SHIP_TYPE_IDS.map((id, rank) => [id, rank]));

/** 艦種の番号 → 選択肢の位置 */
const OPTION_INDEX: ReadonlyMap<number, number> = new Map(
  BOOST_SHIP_TYPE_OPTIONS.flatMap((o, index) => o.ids.map((id) => [id, index] as const)),
);

/** 中身の分からない値が、選べる艦種の番号（整数）か */
export function isBoostShipTypeId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && ID_RANK.has(value);
}

/** 選べない番号と重複を除き、正規の順（BOOST_SHIP_TYPE_IDS の順）に並べる（新しい配列を返す） */
export function normalizeShipTypeIds(ids: readonly number[]): number[] {
  const unique = new Set(ids.filter((id) => isBoostShipTypeId(id)));
  return [...unique].sort((a, b) => (ID_RANK.get(a) ?? 0) - (ID_RANK.get(b) ?? 0));
}

/** ids のどれかを含む選択肢の表示名（選択肢の順・重複なし。選べない番号は無視） */
export function shipTypeOptionLabelsOf(ids: readonly number[]): string[] {
  const indexes = new Set<number>();
  for (const id of ids) {
    const index = OPTION_INDEX.get(id);
    if (index !== undefined) indexes.add(index);
  }
  return [...indexes].sort((a, b) => a - b).map((index) => BOOST_SHIP_TYPE_OPTIONS[index]?.label ?? "");
}
