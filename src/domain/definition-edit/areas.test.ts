// 海域の編集（roadmap T3-6）のテスト
import { describe, expect, it } from "vitest";
import { summer2026Definition } from "@/test/fixtures";
import { addArea, canRemoveArea, removeArea } from "./areas";
import { areaIdsOf, editDoc, expectEditError, expectOk } from "./test-helpers";

const def = summer2026Definition;

/** E4・E5（どちらも段階なし）を足した文書 */
const withEmptyE4E5 = editDoc(def, (d) => {
  d.areas.push({ id: "E4", name: "E4" }, { id: "E5", name: "E5" });
});

/** 海域が E1 だけで、段階もない文書（新規作成の初期状態と同じ形） */
const onlyE1 = editDoc(def, (d) => {
  d.areas = [{ id: "E1", name: "E1" }];
  d.stages = [];
});

describe("addArea（海域の追加）", () => {
  it("次の番号の海域を最後に追加する（E1〜E3 なら E4）", () => {
    const doc = expectOk(addArea(def));

    expect(doc.areas).toEqual([...def.areas, { id: "E4", name: "E4" }]);
    expect(doc.stages).toEqual(def.stages);
  });

  it("続けて追加すると E5 になる", () => {
    const doc = expectOk(addArea(expectOk(addArea(def))));

    expect(areaIdsOf(doc)).toEqual(["E1", "E2", "E3", "E4", "E5"]);
    expect(doc.areas[4]).toEqual({ id: "E5", name: "E5" });
  });

  it("番号は海域の数ではなく、既にある海域の名前の「E＋数字」の最大＋1（E1・E2・E3・E5 なら E6）", () => {
    const gapped = editDoc(def, (d) => {
      d.areas.push({ id: "E5", name: "E5" });
    });

    const doc = expectOk(addArea(gapped));

    expect(doc.areas).toEqual([...gapped.areas, { id: "E6", name: "E6" }]);
  });

  it("番号は数として比べる（E10 は E9 より大きい）", () => {
    const withE10 = editDoc(def, (d) => {
      d.areas = [
        { id: "E1", name: "E1" },
        { id: "E9", name: "E9" },
        { id: "E10", name: "E10" },
      ];
    });

    expect(expectOk(addArea(withE10)).areas[3]).toEqual({ id: "E11", name: "E11" });
  });

  it("「E＋数字」でない名前の海域は番号に数えない", () => {
    const withExtra = editDoc(def, (d) => {
      d.areas.push({ id: "EX", name: "EX" });
    });

    expect(expectOk(addArea(withExtra)).areas[4]).toEqual({ id: "E4", name: "E4" });
  });

  it("新しい海域の ID は、既にある海域の ID と重ならない（名前と同じ ID が使われていれば別の ID にする）", () => {
    const idTaken = editDoc(def, (d) => {
      d.areas = [
        { id: "E1", name: "E1" },
        { id: "E2", name: "E2" },
        { id: "E4", name: "E3" },
      ];
    });

    const doc = expectOk(addArea(idTaken));
    const added = doc.areas[3];

    expect(added?.name).toBe("E4");
    expect(["E1", "E2", "E4"]).not.toContain(added?.id);
    expect(new Set(areaIdsOf(doc)).size).toBe(4);
  });
});

describe("removeArea・canRemoveArea（海域を外す）", () => {
  it("海域が 2 つ以上あるとき、最後の段階のない海域は外せる", () => {
    const withE4 = editDoc(def, (d) => {
      d.areas.push({ id: "E4", name: "E4" });
    });

    expect(canRemoveArea(withE4, "E4")).toBe(true);
    const doc = expectOk(removeArea(withE4, "E4"));

    expect(areaIdsOf(doc)).toEqual(["E1", "E2", "E3"]);
    expect(doc.stages).toEqual(def.stages);
  });

  it("最後でない海域は、段階がなくても外せない", () => {
    expect(canRemoveArea(withEmptyE4E5, "E4")).toBe(false);
    expectEditError(removeArea(withEmptyE4E5, "E4"), "area_not_removable");
  });

  it("最後の海域でも、段階があれば外せない", () => {
    expect(canRemoveArea(def, "E3")).toBe(false);
    expectEditError(removeArea(def, "E3"), "area_not_removable");
  });

  it("段階を別の海域へ移して空になった最後の海域は外せる", () => {
    const e3Emptied = editDoc(def, (d) => {
      for (const s of d.stages) {
        if (s.areaId === "E3") s.areaId = "E2";
      }
    });

    expect(canRemoveArea(e3Emptied, "E3")).toBe(true);
    expect(areaIdsOf(expectOk(removeArea(e3Emptied, "E3")))).toEqual(["E1", "E2"]);
  });

  it("海域が 1 つだけなら、空でも外せない", () => {
    expect(canRemoveArea(onlyE1, "E1")).toBe(false);
    expectEditError(removeArea(onlyE1, "E1"), "area_not_removable");
  });

  it("ない海域は外せない（not_found）", () => {
    expect(canRemoveArea(def, "E9")).toBe(false);
    expectEditError(removeArea(def, "E9"), "not_found");
  });
});
