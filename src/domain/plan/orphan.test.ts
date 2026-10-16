// 定義から消えた札の割り当てを控えに戻す（U17）のテスト
import { describe, expect, it } from "vitest";
import { returnOrphanedAssignments } from "./orphan";
import type { AssignmentMap } from "./types";

describe("returnOrphanedAssignments（定義から消えた札の割り当てを控えに戻す）", () => {
  const assignments: AssignmentMap = Object.freeze({
    hatsushimo: "s31",
    fuyuzuki: "s31",
    okinami: "tago",
    shigure: "ulithi",
    yamato: "ulithi",
  });

  it("今の定義にない札に置かれた個体を外し、外した数を返す", () => {
    // 実行：札 ulithi が定義から消えた
    const result = returnOrphanedAssignments(assignments, ["s31", "tago", "rengo"]);

    // 検証
    expect(result.assignments).toEqual({ hatsushimo: "s31", fuyuzuki: "s31", okinami: "tago" });
    expect(result.returnedCount).toBe(2);
  });

  it("すべての札が今の定義にあれば、割り当てはそのままで 0 件", () => {
    const result = returnOrphanedAssignments(assignments, ["s31", "tago", "ulithi"]);

    expect(result.assignments).toEqual(assignments);
    expect(result.returnedCount).toBe(0);
  });

  it("今の定義に札が 1 つもなければ、すべて控えに戻す", () => {
    const result = returnOrphanedAssignments(assignments, []);

    expect(result.assignments).toEqual({});
    expect(result.returnedCount).toBe(5);
  });

  it("割り当てが空なら、空のままで 0 件", () => {
    const result = returnOrphanedAssignments({}, ["s31"]);

    expect(result).toEqual({ assignments: {}, returnedCount: 0 });
  });

  it("渡した割り当てを書き換えない（凍結した割り当てでも例外を投げない）", () => {
    returnOrphanedAssignments(assignments, ["s31"]);

    expect(assignments).toEqual({
      hatsushimo: "s31",
      fuyuzuki: "s31",
      okinami: "tago",
      shigure: "ulithi",
      yamato: "ulithi",
    });
  });
});
