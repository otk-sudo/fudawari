/* eslint-disable @typescript-eslint/no-unused-vars -- 実装前の空の入れ物。実装するときにこの行を消す */
// 新規作成の初期状態（要件 3.7「新規作成」、roadmap T3-6）
import type { CreateDefinitionInput, DefinitionDoc } from "./types";

/**
 * 新規作成の初期状態の文書を作る。
 * - イベント：id は input.eventId。名前・開始日時・版の日付は空文字、終了日時は null（元にしたイベントからは写さない）
 * - 元にしない（base が省略か null）：海域は E1（id "E1"・名前 "E1"）だけ、札も段階もない
 * - 元にする：base の海域・札・段階を同じ ID と並び順のまま写す。段階の特効は空（boosts: []）にする
 * - schemaVersion は 1
 */
export function createDefinition(input: CreateDefinitionInput): DefinitionDoc {
  throw new Error("未実装");
}
