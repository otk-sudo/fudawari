// 艦船マスタ（型・参照・改造の連鎖・艦名の索引・start2.json からの生成）の入口
export type {
  ApiMstShipLike,
  RemodelInfo,
  RemodelStage,
  ShipLookup,
  ShipMaster,
  ShipMasterEntry,
} from "./types";
export type { InvalidFriendlyRow, InvalidFriendlyRowField, Start2Like } from "./fromStart2";
export { baseNameOf, boostTargetOf, createShipMaster, lookupShip } from "./master";
export { baseNameOfShipName } from "./nameIndex";
export { buildShipMasterEntries, findInvalidFriendlyRows, readStart2 } from "./fromStart2";
export { deriveRemodelInfo } from "./remodel";
