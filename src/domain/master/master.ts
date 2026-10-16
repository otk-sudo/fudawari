/* eslint-disable @typescript-eslint/no-unused-vars -- 実装前の空の入れ物。実装するときにこの行を消す */
// 艦船マスタの参照
import type { ShipLookup, ShipMaster, ShipMasterEntry } from "./types";

/** マスタの行の配列から、艦 ID で引く索引を作る */
export function createShipMaster(entries: readonly ShipMasterEntry[]): ShipMaster {
  throw new Error("未実装");
}

/**
 * 艦 ID から艦の情報を引く。
 * マスタにない艦 ID は { known: false, id, name: "名前が分からない艦" } を返す（例外は投げない）
 */
export function lookupShip(master: ShipMaster, shipId: number): ShipLookup {
  throw new Error("未実装");
}

/** 艦 ID から改装段階を問わない艦名を引く（特効の照合に使う）。マスタにない艦 ID は null */
export function baseNameOf(master: ShipMaster, shipId: number): string | null {
  throw new Error("未実装");
}
