// 改造の連鎖（api_aftershipid）から、改装段階を問わない艦名と改造状態を求める
//
// 考え方（docs/research/import-and-master.md）
// - 改造先は 1 艦に 1 つだけなので、艦を点、改造を矢印とすると「どの点からも出る矢印は高々 1 本」の形になる。
//   そのため連鎖は、起点（未改造）から一本道で進み、最後は「改造先なし」か「輪（コンバート改装）」で終わる。
//   輪から外へ出る矢印はないので、輪はかならず連鎖の最後にある。
// - 計算は艦の数に比例する手間で終わる（全組み合わせは調べない）。
//
// 実装で決めたこと（実データでは起きない想定の、壊れた入力への備え）
// - 改造先が "0"・空・数でない・自分自身・入力にない艦 ID のときは「改造先なし」として扱う。
// - 2 つ以上の起点から同じ艦へ合流するときは、艦 ID の小さい起点の艦名を使う（入力の順に左右されない）。
// - 起点のない輪（輪の艦どうしだけで改造先を指し合う）は、輪の中で艦 ID の最も小さい艦の艦名を使い、すべて最終改造にする。
// - 同じ艦 ID の行が複数あるときは、先の行を使う。
import type { ApiMstShipLike, RemodelInfo, RemodelStage } from "./types";

type RemodelRow = Pick<ApiMstShipLike, "api_id" | "api_name" | "api_aftershipid">;

/** 改造先の艦 ID。改造先なしとして扱う値（"0"、空、数でない、自分自身、入力にない）は null */
function nextIdOf(row: RemodelRow, known: ReadonlyMap<number, RemodelRow>): number | null {
  const text = row.api_aftershipid;
  if (text === undefined || !/^\d+$/.test(text)) return null;
  const id = Number(text);
  if (id === 0 || id === row.api_id || !known.has(id)) return null;
  return id;
}

/** 輪（コンバート改装）に入っている艦 ID を求める */
function findCycleMembers(nextOf: ReadonlyMap<number, number | null>): Set<number> {
  const members = new Set<number>();
  /** 調べ終わった艦 */
  const done = new Set<number>();
  for (const start of nextOf.keys()) {
    if (done.has(start)) continue;
    // start から改造先をたどり、今回の道筋で同じ艦に戻ってきたら、そこから先が輪
    const path: number[] = [];
    const onPath = new Set<number>();
    let current: number | null = start;
    while (current !== null && !done.has(current) && !onPath.has(current)) {
      path.push(current);
      onPath.add(current);
      current = nextOf.get(current) ?? null;
    }
    if (current !== null && onPath.has(current)) {
      for (let i = path.indexOf(current); i < path.length; i += 1) {
        members.add(path[i]);
      }
    }
    for (const id of path) done.add(id);
  }
  return members;
}

/**
 * 改造の連鎖から、艦 ID ごとの改装段階を問わない艦名と改造状態を求める（docs/research/import-and-master.md）。
 * - 未改造：どの艦の改造先にもなっていない艦（改造先もない単独の艦も未改造）
 * - 最終改造：改造先が "0"（または api_aftershipid がない）艦と、連鎖の最後にある輪（コンバート改装）に入っている艦
 * - 中間改造：それ以外
 * - 改装段階を問わない艦名：連鎖の起点（未改造）の艦名
 * 入力のすべての艦 ID を結果に含める
 */
export function deriveRemodelInfo(ships: readonly RemodelRow[]): Map<number, RemodelInfo> {
  // 艦 ID → 行（同じ ID が複数あれば先の行）
  const rows = new Map<number, RemodelRow>();
  for (const row of ships) {
    if (!rows.has(row.api_id)) rows.set(row.api_id, row);
  }

  // 改造先と、改造元があるか（どれかの艦の改造先になっているか）
  const nextOf = new Map<number, number | null>();
  const hasPrevious = new Set<number>();
  for (const row of rows.values()) {
    const next = nextIdOf(row, rows);
    nextOf.set(row.api_id, next);
    if (next !== null) hasPrevious.add(next);
  }

  const cycleMembers = findCycleMembers(nextOf);

  // 改装段階を問わない艦名：起点（艦 ID の小さい順）から改造先をたどり、まだ決まっていない艦に起点の艦名を付ける
  const baseNames = new Map<number, string>();
  const roots = [...rows.keys()].filter((id) => !hasPrevious.has(id)).sort((a, b) => a - b);
  for (const rootId of roots) {
    const rootName = rows.get(rootId)?.api_name ?? "";
    let current: number | null = rootId;
    while (current !== null && !baseNames.has(current)) {
      baseNames.set(current, rootName);
      current = nextOf.get(current) ?? null;
    }
  }
  // 起点のない輪：輪の中で艦 ID の最も小さい艦の艦名
  for (const id of [...cycleMembers].sort((a, b) => a - b)) {
    if (baseNames.has(id)) continue;
    const name = rows.get(id)?.api_name ?? "";
    let current: number | null = id;
    while (current !== null && !baseNames.has(current)) {
      baseNames.set(current, name);
      current = nextOf.get(current) ?? null;
    }
  }

  const result = new Map<number, RemodelInfo>();
  for (const [id, row] of rows) {
    let remodelStage: RemodelStage;
    if (!hasPrevious.has(id)) {
      remodelStage = "unremodeled";
    } else if (nextOf.get(id) === null || cycleMembers.has(id)) {
      remodelStage = "final";
    } else {
      remodelStage = "intermediate";
    }
    result.set(id, { baseName: baseNames.get(id) ?? row.api_name, remodelStage });
  }
  return result;
}
