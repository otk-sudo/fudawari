// 定義から消えた札の割り当てを控えに戻す（U17）。純粋な関数
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
 * 渡した割り当ては書き換えない
 */
export function returnOrphanedAssignments(
  assignments: AssignmentMap,
  fudaIds: readonly string[],
): ReturnOrphanedAssignmentsResult {
  void assignments;
  void fudaIds;
  throw new Error("未実装");
}
