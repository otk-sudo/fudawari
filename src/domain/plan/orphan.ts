// 定義から消えた札の割り当てを控えに戻す（U17）。純粋な関数
import type { ShipUid } from "@/domain/ship/types";
import type { AssignmentMap } from "./types";

/** returnOrphanedAssignments の結果 */
export interface ReturnOrphanedAssignmentsResult {
  /** 今の定義にある札の割り当てだけを残した割り当て（新しいオブジェクト） */
  assignments: AssignmentMap;
  /** 控えに戻した（割り当てを外した）個体の数 */
  returnedCount: number;
}

/**
 * 今の定義の札 ID の一覧にない札に置かれた個体を控えに戻す（割り当てから外す）。
 * 渡した割り当ては書き換えない。値が undefined のキー（控え）は数えず、結果にも入れない
 */
export function returnOrphanedAssignments(
  assignments: AssignmentMap,
  fudaIds: readonly string[],
): ReturnOrphanedAssignmentsResult {
  const known = new Set(fudaIds);
  const kept: Record<ShipUid, string> = {};
  let returnedCount = 0;
  for (const [uid, fudaId] of Object.entries(assignments)) {
    // 控え（undefined）は割り当てではないので飛ばす
    if (typeof fudaId !== "string") continue;
    if (known.has(fudaId)) {
      kept[uid] = fudaId;
    } else {
      returnedCount += 1;
    }
  }
  return { assignments: kept, returnedCount };
}
