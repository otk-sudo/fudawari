// 差分（計画と実際の札。要件 3.5、roadmap T2-11）の判定と反映。純粋な関数
//
// 未実装（PR-08 第 1 段はテストだけ。中身は第 2 段で実装する）。
// いまは型を満たす空の値を返すだけで、drift.test.ts は期待した値と違うために失敗する（TDD の Red）。
import type { AssignmentMap } from "@/domain/plan/types";
import type { DriftApplyResult, DriftEntry, DriftInput, DriftReport, DriftUndo } from "./types";

/**
 * 取り込んだ個体の実際の札と計画を比べ、4 つの分類・件数のまとめ・対応が必要な一覧・対象外・札ごとの進み具合を返す。
 * 渡した値は書き換えない
 */
export function computeDrift(input: DriftInput): DriftReport {
  // 未実装
  void input;
  return { summary: [], issues: [], entries: [], excluded: [], progress: [] };
}

/**
 * 差分の件を計画に反映する（「計画を実際に合わせる」「計画に追加する」、まとめての反映）。
 * 実際の札が正しいものとして割り当てを書き換える。札が抜けた枠は空いたまま（ほかの艦で埋めない）。
 * 「計画どおり」「まだ出撃していない」の件は反映しない。渡した割り当ては書き換えない
 */
export function applyDriftEntries(
  assignments: AssignmentMap,
  entries: readonly DriftEntry[],
): DriftApplyResult {
  // 未実装
  void assignments;
  void entries;
  return { assignments: {}, applied: [], undo: null };
}

/**
 * 反映を元に戻す（直前の反映 1 回分）。記録にある個体だけを反映前の札（控えならキーなし）に戻し、
 * ほかの個体の割り当ては今の値のままにする。渡した割り当ては書き換えない
 */
export function undoDriftApply(assignments: AssignmentMap, undo: DriftUndo): AssignmentMap {
  // 未実装
  void assignments;
  void undo;
  return {};
}
