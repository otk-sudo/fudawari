// 段階の編集（要件 3.7「攻略の流れ」「段階の詳細」、roadmap T3-6）
//
// 並び順：同じ海域の段階どうしの、stages 配列の中での前後が、その海域の中の並び順（PublicDefinition の約束）。
// 海域をまたいだ配列の中の位置は意味を持たない（実装は海域の順にまとめ直してもよい）。
// この実装は配列をまとめ直さず、差し込む位置だけを決める。海域の最後に置くときは、その海域の最後の段階の直後
// （段階のない海域なら、後ろの海域の最初の段階の直前）に置くので、海域の順にまとまった配列はまとまったまま保たれる。
import type { Area, Stage } from "@/domain/definition/types";
import { fail, ok } from "./result";
import type { AddStageInput, DefinitionDoc, EditResult, StagePatch, StagePosition } from "./types";

/** 新しい段階の名前（要件 3.7） */
const NEW_STAGE_NAME = "新しい段階";

/**
 * 海域の最後に段階を置くときの、stages 配列の中の位置。
 * その海域の最後の段階の直後。段階がなければ、後ろの海域（areas の順）の最初の段階の直前。それもなければ配列の最後
 */
function endIndexOfArea(stages: readonly Stage[], areas: readonly Area[], areaId: string): number {
  for (let i = stages.length - 1; i >= 0; i -= 1) {
    if (stages[i]?.areaId === areaId) return i + 1;
  }
  const areaOrder = areas.findIndex((a) => a.id === areaId);
  const laterAreaIds = new Set(areas.slice(areaOrder + 1).map((a) => a.id));
  const firstLater = stages.findIndex((s) => laterAreaIds.has(s.areaId));
  return firstLater < 0 ? stages.length : firstLater;
}

/** 置く場所を、海域と stages 配列の中の位置にする（場所の段階・海域がなければ undefined） */
function resolvePosition(
  stages: readonly Stage[],
  areas: readonly Area[],
  position: StagePosition,
): { areaId: string; index: number } | undefined {
  if (position.kind === "before") {
    const index = stages.findIndex((s) => s.id === position.stageId);
    const target = stages[index];
    return target === undefined ? undefined : { areaId: target.areaId, index };
  }
  if (!areas.some((a) => a.id === position.areaId)) return undefined;
  return { areaId: position.areaId, index: endIndexOfArea(stages, areas, position.areaId) };
}

/** 置く場所がないときの理由 */
function positionNotFound(position: StagePosition): EditResult {
  return position.kind === "before"
    ? fail("not_found", "置く場所の段階が見つかりません")
    : fail("not_found", "置く場所の海域が見つかりません");
}

/** 配列の index の位置に 1 つ差し込んだ新しい配列 */
function insertAt<T>(items: readonly T[], index: number, item: T): T[] {
  return [...items.slice(0, index), item, ...items.slice(index)];
}

/**
 * 札から新しい段階を作って置く。
 * - position が before：その段階の海域で、その段階の直前に割り込む（その段階は上書きしない）
 * - position が end：その海域の最後に追加する（段階のない海域にも追加できる）
 * - 新しい段階は 名前「新しい段階」・大事さ「普通」（"normal"）・特効なし（boosts: []）
 * - エラー：札・段階・海域がない → not_found、newStageId が既にある段階の ID → duplicate_id
 */
export function addStage(doc: DefinitionDoc, input: AddStageInput): EditResult {
  if (!doc.fudas.some((f) => f.id === input.fudaId)) {
    return fail("not_found", "段階に使う札が見つかりません");
  }
  const place = resolvePosition(doc.stages, doc.areas, input.position);
  if (place === undefined) return positionNotFound(input.position);
  if (doc.stages.some((s) => s.id === input.newStageId)) {
    return fail("duplicate_id", "同じ ID の段階が既にあります");
  }

  const stage: Stage = {
    id: input.newStageId,
    areaId: place.areaId,
    name: NEW_STAGE_NAME,
    fudaId: input.fudaId,
    importance: "normal",
    boosts: [],
  };
  return ok({ ...doc, stages: insertAt(doc.stages, place.index, stage) });
}

/**
 * 段階を並べ替える（別の海域へ移すこともできる）。
 * - position が before：その段階の直前へ移す。海域はその段階の海域になる
 * - position が end：その海域の最後へ移す
 * - 自分自身の前に落としたときなど、位置が変わらないときは同じ内容の文書を返す（成功）
 * - 移した段階の名前・札・大事さ・特効は変えない（海域だけ変わる）
 * - エラー：段階・海域がない → not_found
 */
export function moveStage(doc: DefinitionDoc, stageId: string, position: StagePosition): EditResult {
  const stage = doc.stages.find((s) => s.id === stageId);
  if (stage === undefined) return fail("not_found", "動かす段階が見つかりません");
  // 自分自身の前に落とした：位置は変わらない
  if (position.kind === "before" && position.stageId === stageId) return ok(doc);

  // 動かす段階を除いた並びで、置く場所を決める（場所の段階・海域がなければ not_found）
  const rest = doc.stages.filter((s) => s.id !== stageId);
  const place = resolvePosition(rest, doc.areas, position);
  if (place === undefined) return positionNotFound(position);
  const moved = place.areaId === stage.areaId ? stage : { ...stage, areaId: place.areaId };
  const stages = insertAt(rest, place.index, moved);

  // すぐ後ろの段階の前に落としたときなど、並びも海域も変わらなければ元の文書のまま
  const unchanged = moved === stage && stages.every((s, i) => s === doc.stages[i]);
  return ok(unchanged ? doc : { ...doc, stages });
}

/**
 * 段階を削除する（設定した札・大事さ・特効もまとめて消える）。海域は残す。
 * - エラー：イベント全体で最後の 1 つ → last_stage、段階がない → not_found
 */
export function deleteStage(doc: DefinitionDoc, stageId: string): EditResult {
  if (!doc.stages.some((s) => s.id === stageId)) return fail("not_found", "削除する段階が見つかりません");
  if (doc.stages.length <= 1) {
    return fail("last_stage", "イベント全体で最後の 1 つの段階は削除できません");
  }
  return ok({ ...doc, stages: doc.stages.filter((s) => s.id !== stageId) });
}

/** 段階を削除できるか（「この段階を削除」を押せるか）。段階がない、またはイベント全体で最後の 1 つなら false */
export function canDeleteStage(doc: DefinitionDoc, stageId: string): boolean {
  return doc.stages.length > 1 && doc.stages.some((s) => s.id === stageId);
}

/**
 * 段階の名前・札・大事さを変える（指定した項目だけ）。名前は空でも受け付ける（保存時の検証で弾く）。
 * - エラー：段階・札がない → not_found
 */
export function updateStage(doc: DefinitionDoc, stageId: string, patch: StagePatch): EditResult {
  const stage = doc.stages.find((s) => s.id === stageId);
  if (stage === undefined) return fail("not_found", "変更する段階が見つかりません");
  if (patch.fudaId !== undefined && !doc.fudas.some((f) => f.id === patch.fudaId)) {
    return fail("not_found", "段階に使う札が見つかりません");
  }

  const updated: Stage = {
    ...stage,
    name: patch.name ?? stage.name,
    fudaId: patch.fudaId ?? stage.fudaId,
    importance: patch.importance ?? stage.importance,
  };
  return ok({ ...doc, stages: doc.stages.map((s) => (s.id === stageId ? updated : s)) });
}
