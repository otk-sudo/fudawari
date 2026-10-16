// 並び順と値の比較の補助（3 方向マージと保存の記録の文で使う内部の補助）
import type { DefinitionDoc } from "@/domain/definition-edit/types";

/** 2 つの配列の要素が同じ順で同じか（要素は === で比べる） */
export function sameArray<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** 重複を除く（先に出た順） */
export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** JSON で表せる値（文書の中身）が同じか。オブジェクトは項目の並びを問わない */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const aEntries = Object.entries(a);
  const bEntries = new Map<string, unknown>(Object.entries(b));
  return (
    aEntries.length === bEntries.size &&
    aEntries.every(([key, value]) => bEntries.has(key) && deepEqual(value, bEntries.get(key)))
  );
}

/**
 * after の並びに、after にない before の要素を before での位置に差し込んだ並び
 * （before での直前の要素の直後。先頭なら最初）。削除したものを、変更の一覧で元の位置に並べるのに使う
 */
export function unionOrder(before: readonly string[], after: readonly string[]): string[] {
  const result = [...after];
  const placed = new Set(after);
  let previous: string | undefined;
  for (const id of before) {
    if (!placed.has(id)) {
      const at = previous === undefined ? 0 : result.indexOf(previous) + 1;
      result.splice(at, 0, id);
      placed.add(id);
    }
    previous = id;
  }
  return result;
}

/** 文書の、海域ごとの段階の ID（海域の中の並び順） */
export function stageIdsInArea(doc: DefinitionDoc, areaId: string): string[] {
  return doc.stages.filter((s) => s.areaId === areaId).map((s) => s.id);
}

/**
 * 変更（自動で合わせた所・衝突・保存の記録）を並べる順。
 * 海域は after の順（after にない海域は before の位置）、その中の段階は after の順（after にない段階は before の位置）。
 * 段階は after での海域に並べ、after にない段階は before での海域に並べる
 */
export function stageReportOrder(
  before: DefinitionDoc,
  after: DefinitionDoc,
): { areaId: string; stageIds: string[] }[] {
  const afterStageIds = new Set(after.stages.map((s) => s.id));
  const areaIds = unionOrder(
    before.areas.map((a) => a.id),
    after.areas.map((a) => a.id),
  );
  return areaIds.map((areaId) => {
    const afterIds = stageIdsInArea(after, areaId);
    const inAfterArea = new Set(afterIds);
    // before でこの海域にあった段階のうち、別の海域へ移したものは、移した先の海域に並べる
    const stageIds = unionOrder(stageIdsInArea(before, areaId), afterIds).filter(
      (id) => inAfterArea.has(id) || !afterStageIds.has(id),
    );
    return { areaId, stageIds };
  });
}
