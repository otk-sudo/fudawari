// 段階の編集（roadmap T3-6）のテスト
// 入力には凍結済みのテスト用データ（2026夏イベ）を使う。関数が元の文書を書き換えると例外になるので、
// 「新しい文書を返す（イミュータブル）」ことも同時に確かめられる。
import { describe, expect, it } from "vitest";
import { cloneSummer2026Definition, summer2026Definition } from "@/test/fixtures";
import { addStage, canDeleteStage, deleteStage, moveStage, updateStage } from "./stages";
import {
  areaIdsOf,
  editDoc,
  expectEditError,
  expectOk,
  hasGroup,
  stageIdsOf,
  stageOf,
} from "./test-helpers";

const def = summer2026Definition;

/** 段階が 1 つだけの文書（E1-1 だけを残す） */
const singleStageDoc = editDoc(def, (d) => {
  d.stages = d.stages.filter((s) => s.id === "E1-1");
});

/** E4（段階なし）を足した文書 */
const withEmptyE4 = editDoc(def, (d) => {
  d.areas.push({ id: "E4", name: "E4" });
});

describe("addStage（札から段階を作る）", () => {
  it("札を段階の上に落とすと、その段階の前に新しい段階として割り込む（上書きしない）", () => {
    const doc = expectOk(
      addStage(def, { newStageId: "new-1", fudaId: "sixth", position: { kind: "before", stageId: "E2-3" } }),
    );

    expect(stageIdsOf(doc, "E2")).toEqual(["E2-G", "E2-1", "E2-2", "new-1", "E2-3"]);
    expect(doc.stages).toHaveLength(def.stages.length + 1);
    // 落とした先の段階は上書きされずに残る
    expect(stageOf(doc, "E2-3")).toEqual(stageOf(def, "E2-3"));
  });

  it("新しい段階は 名前「新しい段階」・大事さ「普通」・特効なしで、落とした札と、落とした先の海域を持つ", () => {
    const doc = expectOk(
      addStage(def, { newStageId: "new-1", fudaId: "sixth", position: { kind: "before", stageId: "E2-3" } }),
    );

    expect(stageOf(doc, "new-1")).toEqual({
      id: "new-1",
      areaId: "E2",
      name: "新しい段階",
      fudaId: "sixth",
      importance: "normal",
      boosts: [],
    });
  });

  it("海域の先頭の段階に落とすと、その海域の先頭に入る", () => {
    const doc = expectOk(
      addStage(def, { newStageId: "new-1", fudaId: "s31", position: { kind: "before", stageId: "E3-G" } }),
    );

    expect(stageIdsOf(doc, "E3")).toEqual(["new-1", "E3-G", "E3-1", "E3-2", "E3-3", "E3-4"]);
  });

  it("「＋」・空の海域に落とす・「＋」のメニューで選ぶと、その海域の最後に追加する", () => {
    const doc = expectOk(
      addStage(def, { newStageId: "new-1", fudaId: "rengo", position: { kind: "end", areaId: "E2" } }),
    );

    expect(stageIdsOf(doc, "E2")).toEqual(["E2-G", "E2-1", "E2-2", "E2-3", "new-1"]);
    expect(stageOf(doc, "new-1")).toMatchObject({ areaId: "E2", name: "新しい段階", importance: "normal" });
    // ほかの海域は変わらない
    expect(stageIdsOf(doc, "E1")).toEqual(stageIdsOf(def, "E1"));
    expect(stageIdsOf(doc, "E3")).toEqual(stageIdsOf(def, "E3"));
  });

  it("段階のない海域にも追加できる", () => {
    const doc = expectOk(
      addStage(withEmptyE4, { newStageId: "new-1", fudaId: "ulithi", position: { kind: "end", areaId: "E4" } }),
    );

    expect(stageIdsOf(doc, "E4")).toEqual(["new-1"]);
    expect(stageOf(doc, "new-1").areaId).toBe("E4");
  });

  it("元の文書は書き換えず、新しい文書を返す", () => {
    const result = addStage(def, {
      newStageId: "new-1",
      fudaId: "sixth",
      position: { kind: "before", stageId: "E2-3" },
    });

    const doc = expectOk(result);
    expect(doc).not.toBe(def);
    expect(def).toEqual(cloneSummer2026Definition());
  });

  it("ない札・段階・海域を指定すると not_found", () => {
    expectEditError(
      addStage(def, { newStageId: "new-1", fudaId: "no-such-fuda", position: { kind: "end", areaId: "E1" } }),
      "not_found",
    );
    expectEditError(
      addStage(def, { newStageId: "new-1", fudaId: "s31", position: { kind: "before", stageId: "no-such-stage" } }),
      "not_found",
    );
    expectEditError(
      addStage(def, { newStageId: "new-1", fudaId: "s31", position: { kind: "end", areaId: "E9" } }),
      "not_found",
    );
  });

  it("新しい段階の ID が既にある段階と同じなら duplicate_id", () => {
    expectEditError(
      addStage(def, { newStageId: "E2-3", fudaId: "s31", position: { kind: "end", areaId: "E1" } }),
      "duplicate_id",
    );
  });
});

describe("moveStage（段階の並べ替え）", () => {
  it("同じ海域の中で、落とした段階の前へ移す", () => {
    const doc = expectOk(moveStage(def, "E2-3", { kind: "before", stageId: "E2-1" }));

    expect(stageIdsOf(doc, "E2")).toEqual(["E2-G", "E2-3", "E2-1", "E2-2"]);
  });

  it("後ろの段階の前へ移す（下へ動かす）", () => {
    const doc = expectOk(moveStage(def, "E2-G", { kind: "before", stageId: "E2-3" }));

    expect(stageIdsOf(doc, "E2")).toEqual(["E2-1", "E2-2", "E2-G", "E2-3"]);
  });

  it("海域の最後へ移す", () => {
    const doc = expectOk(moveStage(def, "E2-G", { kind: "end", areaId: "E2" }));

    expect(stageIdsOf(doc, "E2")).toEqual(["E2-1", "E2-2", "E2-3", "E2-G"]);
  });

  it("別の海域の段階の前へ移すと、海域が変わり、ほかの中身は変わらない", () => {
    const doc = expectOk(moveStage(def, "E2-1", { kind: "before", stageId: "E3-2" }));

    expect(stageIdsOf(doc, "E2")).toEqual(["E2-G", "E2-2", "E2-3"]);
    expect(stageIdsOf(doc, "E3")).toEqual(["E3-G", "E3-1", "E2-1", "E3-2", "E3-3", "E3-4"]);
    expect(stageOf(doc, "E2-1")).toEqual({ ...stageOf(def, "E2-1"), areaId: "E3" });
  });

  it("別の海域の最後へ移せる（元の海域が空になってもよい）", () => {
    const doc = expectOk(moveStage(def, "E1-1", { kind: "end", areaId: "E3" }));

    expect(stageIdsOf(doc, "E1")).toEqual([]);
    expect(stageIdsOf(doc, "E3")).toEqual(["E3-G", "E3-1", "E3-2", "E3-3", "E3-4", "E1-1"]);
    // 海域は外さない
    expect(areaIdsOf(doc)).toEqual(["E1", "E2", "E3"]);
  });

  it("段階のない海域へ移せる", () => {
    const doc = expectOk(moveStage(withEmptyE4, "E3-4", { kind: "end", areaId: "E4" }));

    expect(stageIdsOf(doc, "E4")).toEqual(["E3-4"]);
    expect(stageIdsOf(doc, "E3")).toEqual(["E3-G", "E3-1", "E3-2", "E3-3"]);
  });

  it("自分自身の前やすぐ後ろの段階の前に落としても、並びは変わらない", () => {
    const onItself = expectOk(moveStage(def, "E2-2", { kind: "before", stageId: "E2-2" }));
    const beforeNext = expectOk(moveStage(def, "E2-1", { kind: "before", stageId: "E2-2" }));

    expect(stageIdsOf(onItself, "E2")).toEqual(["E2-G", "E2-1", "E2-2", "E2-3"]);
    expect(stageIdsOf(beforeNext, "E2")).toEqual(["E2-G", "E2-1", "E2-2", "E2-3"]);
  });

  it("ない段階・海域を指定すると not_found", () => {
    expectEditError(moveStage(def, "no-such-stage", { kind: "end", areaId: "E1" }), "not_found");
    expectEditError(moveStage(def, "E2-1", { kind: "before", stageId: "no-such-stage" }), "not_found");
    expectEditError(moveStage(def, "E2-1", { kind: "end", areaId: "E9" }), "not_found");
  });
});

describe("deleteStage・canDeleteStage（段階の削除）", () => {
  it("段階を削除すると、その段階の特効もまとめて消え、ほかの段階の並びは保たれる", () => {
    const doc = expectOk(deleteStage(def, "E2-3"));

    expect(doc.stages.map((s) => s.id)).toEqual(def.stages.map((s) => s.id).filter((id) => id !== "E2-3"));
    for (const groupId of ["E2-3-C", "E2-3-B", "E2-3-A"]) {
      expect(hasGroup(doc, groupId)).toBe(false);
    }
  });

  it("海域にその段階しかなくても、イベント全体で 2 つ以上あれば削除でき、海域は残る", () => {
    expect(canDeleteStage(def, "E1-1")).toBe(true);

    const doc = expectOk(deleteStage(def, "E1-1"));

    expect(stageIdsOf(doc, "E1")).toEqual([]);
    expect(areaIdsOf(doc)).toEqual(["E1", "E2", "E3"]);
  });

  it("イベント全体で最後の 1 つの段階は削除できない（last_stage、押せない）", () => {
    expect(canDeleteStage(singleStageDoc, "E1-1")).toBe(false);
    expectEditError(deleteStage(singleStageDoc, "E1-1"), "last_stage");
  });

  it("ない段階は削除できない（not_found、押せない）", () => {
    expect(canDeleteStage(def, "no-such-stage")).toBe(false);
    expectEditError(deleteStage(def, "no-such-stage"), "not_found");
  });
});

describe("updateStage（段階の名前・札・大事さの変更）", () => {
  it("名前を変える（「新しい段階」なども含めて変えられる）", () => {
    const doc = expectOk(updateStage(def, "E2-1", { name: "ゲージ1" }));

    expect(stageOf(doc, "E2-1")).toEqual({ ...stageOf(def, "E2-1"), name: "ゲージ1" });
  });

  it("使う札を変える", () => {
    const doc = expectOk(updateStage(def, "E3-3", { fudaId: "ulithi" }));

    expect(stageOf(doc, "E3-3")).toEqual({ ...stageOf(def, "E3-3"), fudaId: "ulithi" });
  });

  it("大事さを変える", () => {
    const doc = expectOk(updateStage(def, "E2-3", { importance: "important" }));

    expect(stageOf(doc, "E2-3")).toEqual({ ...stageOf(def, "E2-3"), importance: "important" });
  });

  it("複数の項目をまとめて変えられ、ほかの段階は変わらない", () => {
    const doc = expectOk(updateStage(def, "E3-G", { name: "前段ギミック", fudaId: "tago", importance: "hard" }));

    expect(stageOf(doc, "E3-G")).toEqual({
      ...stageOf(def, "E3-G"),
      name: "前段ギミック",
      fudaId: "tago",
      importance: "hard",
    });
    expect(doc.stages.filter((s) => s.id !== "E3-G")).toEqual(def.stages.filter((s) => s.id !== "E3-G"));
  });

  it("ない段階・札を指定すると not_found", () => {
    expectEditError(updateStage(def, "no-such-stage", { name: "x" }), "not_found");
    expectEditError(updateStage(def, "E2-3", { fudaId: "no-such-fuda" }), "not_found");
  });
});
