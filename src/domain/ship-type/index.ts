// 特効グループの国籍の条件を絞る艦種（選択肢・判定・正規化・表示名）の入口
export type { BoostShipTypeOption } from "./ship-type";
export {
  BOOST_SHIP_TYPE_IDS,
  BOOST_SHIP_TYPE_OPTIONS,
  isBoostShipTypeId,
  normalizeShipTypeIds,
  shipTypeOptionLabelsOf,
} from "./ship-type";
