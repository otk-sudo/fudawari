/* eslint-disable @typescript-eslint/no-unused-vars -- 実装前の空の入れ物。実装するときにこの行を消す */
// 海域の編集（要件 3.7「攻略の流れ」の「＋ E4 を追加」「この海域を外す」、roadmap T3-6）
import type { DefinitionDoc, EditResult } from "./types";

/**
 * 次の番号の海域を最後に追加する（海域が 3 つなら E4、4 つなら E5）。
 * 名前は "E" ＋（海域の数 ＋ 1）。ID は名前と同じにする（既にその ID があれば、重複しない ID にする）。
 * 2 人が同時に E4 を追加したとき、3 方向マージで同じ海域として扱えるよう、ID を名前から決める。
 */
export function addArea(doc: DefinitionDoc): EditResult {
  throw new Error("未実装");
}

/**
 * 海域を外す。外せるのは、海域が 2 つ以上あるときの、最後の、段階のない海域だけ。
 * - エラー：条件に合わない → area_not_removable、海域がない → not_found
 */
export function removeArea(doc: DefinitionDoc, areaId: string): EditResult {
  throw new Error("未実装");
}

/** 海域を外せるか（「この海域を外す」を出すか）。海域がなければ false */
export function canRemoveArea(doc: DefinitionDoc, areaId: string): boolean {
  throw new Error("未実装");
}
