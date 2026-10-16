/* eslint-disable @typescript-eslint/no-unused-vars -- 実装前の空の入れ物。実装するときにこの行を消す */
// 札の編集（要件 3.7「札の一覧」、U10・U16、roadmap T3-6）
import type { AddFudaInput, DefinitionDoc, EditResult, FudaPatch } from "./types";

/**
 * 札の色の選択肢（U16：用意した色から選ぶ）。"#RRGGBB"（大文字）で重複なし。
 * モックの 5 色（#8B93A1・#5FB0E8・#4C8DF6・#3FB37F・#A97EF0）を含める。
 * 実装前の空の入れ物のため、今は空にしてある。実装で色を入れる
 */
export const FUDA_COLOR_CHOICES: readonly string[] = [];

/**
 * 札を一覧の最後に追加する。
 * - エラー：名前が空（空白だけを含む）・色が選択肢にない・札番号が 1 以上の整数でない → invalid_value、
 *   札番号がほかの札と重複 → duplicate_game_number、newFudaId が既にある札の ID → duplicate_id
 */
export function addFuda(doc: DefinitionDoc, input: AddFudaInput): EditResult {
  throw new Error("未実装");
}

/**
 * 札の名前・色・札番号を変える（指定した項目だけ）。段階の札の参照（fudaId）は変わらない。
 * 札番号は自分自身の今の番号と同じなら重複にしない。null で未入力に戻せる。
 * - エラー：色が選択肢にない・札番号が 1 以上の整数でない → invalid_value、
 *   札番号がほかの札と重複 → duplicate_game_number、札がない → not_found
 */
export function updateFuda(doc: DefinitionDoc, fudaId: string, patch: FudaPatch): EditResult {
  throw new Error("未実装");
}

/**
 * 札を並べ替える（間に割り込み）。beforeFudaId の札の直前へ移す。null なら最後へ移す。
 * 自分自身の前・すぐ後ろの札の前に落としたときは、同じ並びの文書を返す（成功）。
 * - エラー：札がない（fudaId・beforeFudaId）→ not_found
 */
export function moveFuda(doc: DefinitionDoc, fudaId: string, beforeFudaId: string | null): EditResult {
  throw new Error("未実装");
}

/**
 * 札を削除する（U16：使われていない札だけ）。
 * - エラー：段階で使われている → fuda_in_use、札がない → not_found
 */
export function deleteFuda(doc: DefinitionDoc, fudaId: string): EditResult {
  throw new Error("未実装");
}

/** 札を削除できるか（どの段階でも使われていないか）。札がなければ false */
export function canDeleteFuda(doc: DefinitionDoc, fudaId: string): boolean {
  throw new Error("未実装");
}
