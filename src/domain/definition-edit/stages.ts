/* eslint-disable @typescript-eslint/no-unused-vars -- 実装前の空の入れ物。実装するときにこの行を消す */
// 段階の編集（要件 3.7「攻略の流れ」「段階の詳細」、roadmap T3-6）
//
// 並び順：同じ海域の段階どうしの、stages 配列の中での前後が、その海域の中の並び順（PublicDefinition の約束）。
// 海域をまたいだ配列の中の位置は意味を持たない（実装は海域の順にまとめ直してもよい）。
import type { AddStageInput, DefinitionDoc, EditResult, StagePatch, StagePosition } from "./types";

/**
 * 札から新しい段階を作って置く。
 * - position が before：その段階の海域で、その段階の直前に割り込む（その段階は上書きしない）
 * - position が end：その海域の最後に追加する（段階のない海域にも追加できる）
 * - 新しい段階は 名前「新しい段階」・大事さ「普通」（"normal"）・特効なし（boosts: []）
 * - エラー：札・段階・海域がない → not_found、newStageId が既にある段階の ID → duplicate_id
 */
export function addStage(doc: DefinitionDoc, input: AddStageInput): EditResult {
  throw new Error("未実装");
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
  throw new Error("未実装");
}

/**
 * 段階を削除する（設定した札・大事さ・特効もまとめて消える）。海域は残す。
 * - エラー：イベント全体で最後の 1 つ → last_stage、段階がない → not_found
 */
export function deleteStage(doc: DefinitionDoc, stageId: string): EditResult {
  throw new Error("未実装");
}

/** 段階を削除できるか（「この段階を削除」を押せるか）。段階がない、またはイベント全体で最後の 1 つなら false */
export function canDeleteStage(doc: DefinitionDoc, stageId: string): boolean {
  throw new Error("未実装");
}

/**
 * 段階の名前・札・大事さを変える（指定した項目だけ）。名前は空でも受け付ける（保存時の検証で弾く）。
 * - エラー：段階・札がない → not_found
 */
export function updateStage(doc: DefinitionDoc, stageId: string, patch: StagePatch): EditResult {
  throw new Error("未実装");
}
