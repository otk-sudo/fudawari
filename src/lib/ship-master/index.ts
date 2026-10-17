// 艦船マスタの読み込みの入口（画面・部品はここから読み込む）
//
// ビルド時の生成（generateShipMaster.ts）は Node のスクリプトから直接読み込むため、ここには並べない。
export { loadShipMaster, SHIP_MASTER_PATH } from "./load";
export type { ShipMasterInvalidReason, ShipMasterLoadError, ShipMasterLoadResult } from "./load";
export { resetShipMasterCache, useShipMaster } from "./useShipMaster";
export type { ShipMasterState } from "./useShipMaster";
