// 割り当て（AssignmentMap）の型のテスト（PR-02b）
//
// 控え（どの札にも置いていない個体）は、割り当てにキーがない。読むと undefined になるので、型にも undefined が表れること
// （tsconfig で noUncheckedIndexedAccess を有効にしていないため、型の側で「キーがないことがある」を表す）。
//
// 確かめ方
// - 型：`// @ts-expect-error` が、その行が型の誤りであることを確かめる（npm run typecheck）。
//   型が string を返すままだと、この指示が「不要」（TS2578）として typecheck が失敗する。
import { describe, expect, it } from "vitest";
import type { AssignmentMap } from "./types";

describe("AssignmentMap（個体 ID → 札 ID）の型", () => {
  it("控え（キーがない個体）を読むと undefined で、型の上でも string の変数にはそのまま入れられない", () => {
    // 準備：初霜だけを連合艦隊に置き、潮は控え
    const assignments: AssignmentMap = { hatsushimo: "rengo" };

    // 実行（型の確かめを含む）：控えのことがあるので string には入れられず、string | undefined なら入れられる
    // @ts-expect-error キーがない個体の値は undefined のことがある
    const fuda: string = assignments["ushio"];
    const maybeFuda: string | undefined = assignments["ushio"];

    // 検証
    expect(fuda).toBeUndefined();
    expect(maybeFuda).toBeUndefined();
    expect(assignments["hatsushimo"]).toBe("rengo");
  });

  it("割り当ては読み取り専用で、書き換えは型の誤りになる（型だけを確かめる。書き換えの関数は呼ばない）", () => {
    // 準備
    const assignments: AssignmentMap = { hatsushimo: "rengo" };

    // 実行（型の確かめ）：呼ばない関数の中に書き、tsc だけで確かめる
    const assignUshio = (): void => {
      // @ts-expect-error 割り当ては読み取り専用（変えるときは新しいオブジェクトを作る）
      assignments["ushio"] = "rengo";
    };

    // 検証：関数は呼んでいないので、割り当ては変わらない
    expect(assignUshio).toBeTypeOf("function");
    expect(assignments).toEqual({ hatsushimo: "rengo" });
  });
});
