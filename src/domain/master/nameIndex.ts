// 艦名から、改装段階を問わない艦名を引く（plan-v1 後続の対応一覧「PR-02 レビュー 4」の索引）
//
// 定義の特効グループの艦名（改装段階を問わない艦名）の照合や、定義画面で知らない艦名を警告するときに使う。
import type { ShipMaster } from "./types";

/**
 * マスタごとの索引（艦名 → 改装段階を問わない艦名）。同じマスタで何度引いても、索引は 1 回だけ作る。
 * マスタは読み取り専用として扱う前提（作った後に中身を変えない）。マスタが要らなくなれば索引も消える（WeakMap）
 */
const indexCache = new WeakMap<ShipMaster, ReadonlyMap<string, string>>();

/** マスタの索引を作る（艦名を優先し、改装段階を問わない艦名そのものでも引けるようにする。同じ艦名は先の行） */
function buildNameIndex(master: ShipMaster): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const entry of master.byId.values()) {
    if (!index.has(entry.name)) index.set(entry.name, entry.baseName);
  }
  for (const entry of master.byId.values()) {
    if (!index.has(entry.baseName)) index.set(entry.baseName, entry.baseName);
  }
  return index;
}

function nameIndexOf(master: ShipMaster): ReadonlyMap<string, string> {
  let index = indexCache.get(master);
  if (index === undefined) {
    index = buildNameIndex(master);
    indexCache.set(master, index);
  }
  return index;
}

/**
 * 艦名（例「時雨改二」）から改装段階を問わない艦名（例「時雨」）を引く。
 * - 改装段階を問わない艦名そのもの（例「時雨」）を渡したときは、その艦名を返す
 * - 前後の空白（全角の空白も含む）は無視する
 * - マスタにない艦名・空の文字列は null（艦名の一部だけでは引けない）
 */
export function baseNameOfShipName(master: ShipMaster, shipName: string): string | null {
  // String.prototype.trim は全角の空白（U+3000）も取り除く
  const name = shipName.trim();
  if (name === "") return null;
  return nameIndexOf(master).get(name) ?? null;
}
