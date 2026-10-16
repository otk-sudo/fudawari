// start2.json（Tibowl/api_start2）から、自前の形式の艦船マスタの行を作る（roadmap T1-5、U1）。純粋な関数
//
// ビルド時の生成（src/lib/ship-master/generateShipMaster.ts）から使う。取得・書き出しはここでは行わない。
import type { ApiMstShipLike, ShipMasterEntry } from "./types";

/** start2.json のうち、マスタの生成に使う部分 */
export interface Start2Like {
  api_mst_ship: readonly ApiMstShipLike[];
}

/** 味方艦の艦 ID の上限（この値未満が味方艦。1500 以上は深海棲艦） */
export const FRIENDLY_SHIP_ID_LIMIT = 1500;

/**
 * start2.json の api_mst_ship から、味方艦（api_id < 1500）だけの ShipMasterEntry の配列を作る。
 * - 項目は ShipMasterEntry のものだけ（ゲームの画像やほかの項目は入れない）
 * - 改装段階を問わない艦名・改造状態は改造の連鎖（deriveRemodelInfo）から求める。コンバート改装の輪の艦はすべて最終改造
 * - 艦型の名前は classNames（艦型の番号 → 名前）を優先する。対応表にない艦型は
 *   「その艦型で図鑑番号が最も小さい艦の、改装段階を問わない艦名＋型」で補う
 * - 結果は艦 ID の昇順（入力の順に左右されない）
 */
export function buildShipMasterEntries(
  start2: Start2Like,
  classNames: ReadonlyMap<number, string>,
): ShipMasterEntry[] {
  void start2;
  void classNames;
  throw new Error("未実装");
}
