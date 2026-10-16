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
  const event = { id: input.eventId, name: "", startAt: "", endAt: null, versionDate: "" };
  const base = input.base ?? null;
  if (base === null) {
    return { schemaVersion: 1, event, areas: [{ id: "E1", name: "E1" }], fudas: [], stages: [] };
  }
  return {
    schemaVersion: 1,
    event,
    areas: base.areas.map((a) => ({ ...a })),
    fudas: base.fudas.map((f) => ({ ...f })),
    stages: base.stages.map((s) => ({
      id: s.id,
      areaId: s.areaId,
      name: s.name,
      fudaId: s.fudaId,
      importance: s.importance,
      boosts: [],
    })),
  };
}
