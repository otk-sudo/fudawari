// 艦船マスタの参照
import type { BoostTarget } from "@/domain/boost/types";
import type { ShipLookup, ShipMaster, ShipMasterEntry } from "./types";

/** マスタにない艦の表示名 */
const UNKNOWN_SHIP_NAME = "名前が分からない艦";

/** マスタの行の配列から、艦 ID で引く索引を作る（同じ艦 ID の行が複数あるときは先の行を使う） */
export function createShipMaster(entries: readonly ShipMasterEntry[]): ShipMaster {
  const byId = new Map<number, ShipMasterEntry>();
  for (const entry of entries) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return { byId };
}

/**
 * 艦 ID から艦の情報を引く。
 * マスタにない艦 ID は { known: false, id, name: "名前が分からない艦" } を返す（例外は投げない）
 */
export function lookupShip(master: ShipMaster, shipId: number): ShipLookup {
  const entry = master.byId.get(shipId);
  if (entry === undefined) {
    return { known: false, id: shipId, name: UNKNOWN_SHIP_NAME };
  }
  return { known: true, ...entry };
}

/** 艦 ID から改装段階を問わない艦名を引く（特効の照合に使う）。マスタにない艦 ID は null */
export function baseNameOf(master: ShipMaster, shipId: number): string | null {
  return master.byId.get(shipId)?.baseName ?? null;
}

/**
 * 艦 ID から特効の照合の対象（改装段階を問わない艦名と国籍）を引く。マスタにない艦 ID は null（どこにも効かない）。
 * マスタの行をそのまま返す（ShipMasterEntry は BoostTarget の項目を持つ。毎回の描画で新しいオブジェクトを作らない）
 */
export function boostTargetOf(master: ShipMaster, shipId: number): BoostTarget | null {
  return master.byId.get(shipId) ?? null;
}
