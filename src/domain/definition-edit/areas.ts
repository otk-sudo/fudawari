// 海域の編集（要件 3.7「攻略の流れ」の「＋ E4 を追加」「この海域を外す」、roadmap T3-6）
import type { Area } from "@/domain/definition/types";
import { fail, ok } from "./result";
import type { DefinitionDoc, EditResult } from "./types";

/**
 * 次の番号の海域を最後に追加する（海域が 3 つなら E4、4 つなら E5）。
 * 名前は "E" ＋（海域の数 ＋ 1）。ID は名前と同じにする（既にその ID があれば、重複しない ID にする）。
 * 2 人が同時に E4 を追加したとき、3 方向マージで同じ海域として扱えるよう、ID を名前から決める。
 */
export function addArea(doc: DefinitionDoc): EditResult {
  const name = `E${doc.areas.length + 1}`;
  const usedIds = new Set(doc.areas.map((a) => a.id));
  // ID が既にあるとき（途中の海域を外した後など）は「E4-2」「E4-3」… の空いているものにする
  let id = name;
  for (let n = 2; usedIds.has(id); n += 1) {
    id = `${name}-${n}`;
  }
  const area: Area = { id, name };
  return ok({ ...doc, areas: [...doc.areas, area] });
}

/**
 * 海域を外す。外せるのは、海域が 2 つ以上あるときの、最後の、段階のない海域だけ。
 * - エラー：条件に合わない → area_not_removable、海域がない → not_found
 */
export function removeArea(doc: DefinitionDoc, areaId: string): EditResult {
  if (!doc.areas.some((a) => a.id === areaId)) return fail("not_found", "外す海域が見つかりません");
  if (!canRemoveArea(doc, areaId)) {
    return fail("area_not_removable", "外せるのは、海域が 2 つ以上あるときの、最後の段階のない海域だけです");
  }
  return ok({ ...doc, areas: doc.areas.filter((a) => a.id !== areaId) });
}

/** 海域を外せるか（「この海域を外す」を出すか）。海域がなければ false */
export function canRemoveArea(doc: DefinitionDoc, areaId: string): boolean {
  const last = doc.areas[doc.areas.length - 1];
  return (
    doc.areas.length >= 2 && last !== undefined && last.id === areaId && !doc.stages.some((s) => s.areaId === areaId)
  );
}
