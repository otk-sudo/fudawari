// 特効グループの効く条件の要約（定義画面の特効グループの下に出す 1 行。UI／UX の指摘 中9）
//
// 例
// - 艦名と国籍・艦種：「冬月・北上、またはアメリカの駆逐に ×1.21」
// - 艦名だけ：「冬月・北上に ×1.21」
// - 国籍だけ（艦種なし）：「アメリカの艦に ×1.10」
// - 艦名も国籍もない：「効く艦がまだありません（艦名か国籍を入れてください）」
// 艦名・国籍・艦種は「・」でつなぐ。国籍・艦種は保存の正規の順（BOOST_NATIONALITIES・BOOST_SHIP_TYPE_OPTIONS の順）のまま。
// 倍率は小数 2 桁（割り振り・差分の画面の倍率の書き方と同じ）。
import type { BoostGroup } from "@/domain/definition/types";
import { nationalityLabel } from "@/domain/nationality";
import { shipTypeOptionLabelsOf } from "@/domain/ship-type";

/** 艦名も国籍もないグループの要約 */
export const EMPTY_BOOST_SUMMARY = "効く艦がまだありません（艦名か国籍を入れてください）";

/** 艦をつなぐ記号 */
const JOIN = "・";

/** 特効グループの効く条件を 1 行の文にする */
export function summarizeBoostGroup(group: BoostGroup): string {
  const names = group.shipNames.join(JOIN);
  const nationalities = (group.nationalities ?? []).map(nationalityLabel).join(JOIN);
  const shipTypes = shipTypeOptionLabelsOf(group.shipTypes ?? []).join(JOIN);
  // 国籍の条件（艦種がなければ、その国籍のすべての艦）
  const byNationality = nationalities === "" ? "" : `${nationalities}の${shipTypes === "" ? "艦" : shipTypes}`;
  const target = names !== "" && byNationality !== "" ? `${names}、または${byNationality}` : names || byNationality;
  if (target === "") return EMPTY_BOOST_SUMMARY;
  return `${target}に ×${group.multiplier.toFixed(2)}`;
}
