// 艦船マスタ（型・参照・改造の連鎖）の入口
export type {
  ApiMstShipLike,
  RemodelInfo,
  RemodelStage,
  ShipLookup,
  ShipMaster,
  ShipMasterEntry,
} from "./types";
export { baseNameOf, createShipMaster, lookupShip } from "./master";
export { deriveRemodelInfo } from "./remodel";
