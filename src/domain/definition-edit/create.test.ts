// 新規作成の初期状態（roadmap T3-6）のテスト
import { describe, expect, it } from "vitest";
import type { Stage } from "@/domain/definition/types";
import { cloneSummer2026Definition, summer2026Definition } from "@/test/fixtures";
import { createDefinition } from "./create";

const def = summer2026Definition;

/** 段階の特効以外の項目 */
function withoutBoosts(stage: Stage) {
  return {
    id: stage.id,
    areaId: stage.areaId,
    name: stage.name,
    fudaId: stage.fudaId,
    importance: stage.importance,
  };
}

describe("createDefinition（新規作成の初期状態）", () => {
  it("元にするイベントを使わなければ、E1 だけの空の文書（札も段階もない）", () => {
    const doc = createDefinition({ eventId: "2026-autumn" });

    expect(doc).toEqual({
      schemaVersion: 1,
      event: { id: "2026-autumn", name: "", startAt: "", endAt: null, versionDate: "" },
      areas: [{ id: "E1", name: "E1" }],
      fudas: [],
      stages: [],
    });
  });

  it("base に null を渡しても、使わない場合と同じ", () => {
    expect(createDefinition({ eventId: "2026-autumn", base: null })).toEqual(
      createDefinition({ eventId: "2026-autumn" }),
    );
  });

  it("元にするイベントがあれば、海域・札・段階を同じ ID と並び順のまま写す", () => {
    const doc = createDefinition({ eventId: "2026-autumn", base: def });

    expect(doc.areas).toEqual(def.areas);
    expect(doc.fudas).toEqual(def.fudas);
    expect(doc.stages.map((s) => s.id)).toEqual(def.stages.map((s) => s.id));
    expect(doc.stages.map(withoutBoosts)).toEqual(def.stages.map(withoutBoosts));
  });

  it("元にしても、特効は空にする", () => {
    const doc = createDefinition({ eventId: "2026-autumn", base: def });

    for (const stage of doc.stages) {
      expect(stage.boosts).toEqual([]);
    }
  });

  it("元にしても、イベントの名前・日時・版の日付は写さない", () => {
    const doc = createDefinition({ eventId: "2026-autumn", base: def });

    expect(doc.schemaVersion).toBe(1);
    expect(doc.event).toEqual({ id: "2026-autumn", name: "", startAt: "", endAt: null, versionDate: "" });
  });

  it("元にしたイベントの文書は書き換えない", () => {
    createDefinition({ eventId: "2026-autumn", base: def });

    expect(def).toEqual(cloneSummer2026Definition());
  });
});
