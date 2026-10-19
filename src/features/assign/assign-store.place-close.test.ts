// 割り振りのストア：札へ移した艦のカードを閉じる（UI／UX レビューの【高3】）の先に書いたテスト（TDD の Red）
//
// 親が決めた直し方（ユーザーの承認済み）
// - 「ここに置く」「（札名）に置く」（placeSelected）やドラッグ（札の列に落とす dropOnFuda）で札へ移したら、
//   その艦のカードは閉じる（openUids から外す。開いた状態を残さない）
// - 要件 3.3「開いたカードは、別の艦を選んでも閉じない」はそのまま（置いたときだけ、置いた艦だけを閉じる）
//
// 準備に使う割り当ては一覧の割り当て（summer2026Assignments。assign-store.test.ts と同じ）
// - 控え：雪風改（yukikaze2）・伊168改（i168）など。連合艦隊（rengo）：時雨改二（shigure2）など
//
// 仕様が変わる既存のテスト（このファイルでは変えない。実装のときに親が扱いを決める）
// - assign-store.test.ts「置いた後も、開いたカードは開いたままになる（選択だけが外れる。モックの placeTo どおり）」
// - assign-store.test.ts「選択・開閉は「元に戻す」の対象にしない：戻しても今の選択と開いたカードはそのまま」
//   （雪風改を置いた後の開いた艦に yukikaze2 を含めている）
import { describe, expect, it, vi } from "vitest";
import type { AssignmentMap } from "@/domain/plan/types";
import { summer2026Assignments, summer2026Definition } from "@/test/fixtures";
import { type AssignStore, createAssignStore, type SaveAssignments } from "./assign-store";

const EVENT_ID = summer2026Definition.event.id;

/** ストアと偽の保存の関数を用意する */
function setup(assignments: AssignmentMap = summer2026Assignments) {
  const save = vi.fn<SaveAssignments>(() => Promise.resolve());
  const store = createAssignStore({ eventId: EVENT_ID, assignments, save });
  return { store, save };
}

/** 開いている艦（順番は問わない） */
function openSet(store: AssignStore): Set<string> {
  return new Set(store.getState().openUids);
}

describe("札へ移した艦のカードを閉じる（【高3】）", () => {
  it("「ここに置く」で控えの艦を札へ置くと、その艦のカードは閉じ、選択も外れる", () => {
    // 準備：控えの雪風改を選ぶ（開く）
    const { store } = setup();
    store.getState().pressShip("yukikaze2");
    expect(openSet(store)).toEqual(new Set(["yukikaze2"])); // 前提：開いている

    // 実行
    store.getState().placeSelected("rengo");

    // 検証
    expect(store.getState().assignments.yukikaze2).toBe("rengo");
    expect(store.getState().selectedUid).toBeNull();
    expect(openSet(store)).toEqual(new Set());
  });

  it("札に置いた艦を別の札の「ここに置く」で移しても、その艦のカードは閉じる", () => {
    // 準備：連合艦隊の時雨改二を選ぶ
    const { store } = setup();
    store.getState().pressShip("shigure2");

    // 実行
    store.getState().placeSelected("ulithi");

    // 検証
    expect(store.getState().assignments.shigure2).toBe("ulithi");
    expect(openSet(store)).toEqual(new Set());
  });

  it("置いた艦だけを閉じ、その前に開いていたほかの艦は開いたまま", () => {
    // 準備：伊168改を開き、続けて雪風改を選ぶ（伊168改は開いたまま。要件 3.3）
    const { store } = setup();
    store.getState().pressShip("i168");
    store.getState().pressShip("yukikaze2");
    expect(openSet(store)).toEqual(new Set(["i168", "yukikaze2"])); // 前提

    // 実行
    store.getState().placeSelected("rengo");

    // 検証
    expect(openSet(store)).toEqual(new Set(["i168"]));
  });

  it("開いた艦をドラッグして札の列に落とすと、その艦のカードは閉じる（ほかの開いた艦は開いたまま）", () => {
    // 準備：伊168改と雪風改を開き、雪風改のドラッグを始める（選択は外れるが、開いたまま）
    const { store } = setup();
    store.getState().pressShip("i168");
    store.getState().pressShip("yukikaze2");
    store.getState().startDrag("yukikaze2");
    expect(openSet(store)).toEqual(new Set(["i168", "yukikaze2"])); // 前提：ドラッグを始めても開いたまま

    // 実行
    store.getState().dropOnFuda("yukikaze2", "rengo");

    // 検証
    expect(store.getState().assignments.yukikaze2).toBe("rengo");
    expect(openSet(store)).toEqual(new Set(["i168"]));
  });

  it("「×」で選択だけをやめて開いたままの艦を、ドラッグで札の列に落としても閉じる", () => {
    // 準備：雪風改を選び、「×」（clearSelection）で選択だけをやめる
    const { store } = setup();
    store.getState().pressShip("yukikaze2");
    store.getState().clearSelection();
    expect(openSet(store)).toEqual(new Set(["yukikaze2"])); // 前提：開いたまま

    // 実行
    store.getState().startDrag("yukikaze2");
    store.getState().dropOnFuda("yukikaze2", "ulithi");

    // 検証
    expect(openSet(store)).toEqual(new Set());
  });
});

describe("置かないときは閉じない（既存の決まりの守り。今も通る）", () => {
  it("別の艦を選んでも、前に開いた艦は閉じない（要件 3.3）", () => {
    const { store } = setup();

    store.getState().pressShip("i168");
    store.getState().pressShip("yukikaze2");

    expect(openSet(store)).toEqual(new Set(["i168", "yukikaze2"]));
  });

  it("開いていない艦をドラッグで札の列に落としても、開いたほかの艦は閉じない", () => {
    // 準備：伊168改だけを開く
    const { store } = setup();
    store.getState().pressShip("i168");
    store.getState().clearSelection();

    // 実行：開いていない雪風改をドラッグで置く
    store.getState().startDrag("yukikaze2");
    store.getState().dropOnFuda("yukikaze2", "rengo");

    // 検証
    expect(store.getState().assignments.yukikaze2).toBe("rengo");
    expect(openSet(store)).toEqual(new Set(["i168"]));
  });
});
