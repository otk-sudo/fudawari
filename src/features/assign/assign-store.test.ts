// 割り振りの状態と操作（roadmap T2-5、要件 3.3、U22）の単体テスト
//
// 準備に使う割り当ては一覧の割り当て（summer2026Assignments）：
// - 第三十一戦隊（s31）：初霜改二（hatsushimo）・冬月改（fuyuzuki）など
// - 連合艦隊（rengo）：時雨改二（shigure2）・雪風改二（yukikaze）など
// - 控え：雪風改（yukikaze2）・瑞鳳改二乙（zuiho）・伊168改（i168）など
// 保存の関数は偽物を渡し、呼ばれた内容を確かめる（IndexedDB には触らない）。
import { describe, expect, it, vi } from "vitest";
import type { AssignmentMap } from "@/domain/plan/types";
import { summer2026Assignments, summer2026Definition } from "@/test/fixtures";
import { createAssignStore, type AssignStore, type SaveAssignments } from "./assign-store";

// ---- テストの補助 ----

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

/** 個体の今の札（控えなら undefined） */
function fudaOf(store: AssignStore, uid: string): string | undefined {
  return store.getState().assignments[uid];
}

describe("艦の選択と特効の開閉", () => {
  it("艦を押すと、その艦が選ばれて特効が開く", () => {
    // 準備
    const { store } = setup();

    // 実行
    store.getState().pressShip("hatsushimo");

    // 検証
    expect(store.getState().selectedUid).toBe("hatsushimo");
    expect(openSet(store)).toEqual(new Set(["hatsushimo"]));
  });

  it("別の艦を選んでも、前に開いた艦は閉じない（選択は新しい艦に移る）", () => {
    const { store } = setup();

    store.getState().pressShip("hatsushimo");
    store.getState().pressShip("yukikaze2");

    expect(store.getState().selectedUid).toBe("yukikaze2");
    expect(openSet(store)).toEqual(new Set(["hatsushimo", "yukikaze2"]));
  });

  it("選んでいる艦をもう一度押すと、選択が外れてその艦だけが閉じる", () => {
    const { store } = setup();
    store.getState().pressShip("hatsushimo");
    store.getState().pressShip("yukikaze2");

    store.getState().pressShip("yukikaze2");

    expect(store.getState().selectedUid).toBeNull();
    expect(openSet(store)).toEqual(new Set(["hatsushimo"]));
  });

  it("1 隻だけ開いているときに同じ艦をもう一度押すと、選択が外れて何も開いていない状態になる", () => {
    const { store } = setup();
    store.getState().pressShip("hatsushimo");
    expect(store.getState().openUids).toEqual(["hatsushimo"]); // 前提：開いている

    store.getState().pressShip("hatsushimo");

    expect(store.getState().selectedUid).toBeNull();
    expect(store.getState().openUids).toEqual([]);
  });

  it("開いているが選んでいない艦を押すと、その艦が選ばれ、開いたままになる（ほかの開いた艦も閉じない）", () => {
    const { store } = setup();
    store.getState().pressShip("hatsushimo");
    store.getState().pressShip("yukikaze2");

    store.getState().pressShip("hatsushimo");

    expect(store.getState().selectedUid).toBe("hatsushimo");
    expect(openSet(store)).toEqual(new Set(["hatsushimo", "yukikaze2"]));
  });

  it("「すべて閉じる」で、開いた艦がすべて閉じ、選択も外れる", () => {
    const { store } = setup();
    store.getState().pressShip("hatsushimo");
    store.getState().pressShip("yukikaze2");
    store.getState().pressShip("i168");
    expect(openSet(store)).toEqual(new Set(["hatsushimo", "yukikaze2", "i168"])); // 前提：3 隻開いている

    store.getState().closeAll();

    expect(store.getState().selectedUid).toBeNull();
    expect(store.getState().openUids).toEqual([]);
  });

  it("パネルの「×」（選択をやめる）では選択だけが外れ、開いたカードは閉じない（モック Assign.dc.html の clearSel どおり）", () => {
    const { store } = setup();
    store.getState().pressShip("hatsushimo");
    store.getState().pressShip("yukikaze2");

    store.getState().clearSelection();

    expect(store.getState().selectedUid).toBeNull();
    expect(openSet(store)).toEqual(new Set(["hatsushimo", "yukikaze2"]));
  });

  it("選択・開閉の操作では、割り当ては変わらず、保存も「元に戻す」の対象にもならない", () => {
    const { store, save } = setup();

    store.getState().pressShip("hatsushimo");
    store.getState().pressShip("yukikaze2");
    expect(store.getState().selectedUid).toBe("yukikaze2"); // 前提：選択はできている
    store.getState().clearSelection();
    store.getState().closeAll();

    expect(store.getState().assignments).toEqual(summer2026Assignments);
    expect(store.getState().canUndo).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("「ここに置く」「（札名）に置く」", () => {
  it("控えの艦を選んで札に置くと、その札へ移り、選択が外れる", () => {
    // 準備：控えの雪風改を選ぶ
    const { store } = setup();
    store.getState().pressShip("yukikaze2");

    // 実行
    store.getState().placeSelected("rengo");

    // 検証
    expect(fudaOf(store, "yukikaze2")).toBe("rengo");
    expect(store.getState().selectedUid).toBeNull();
  });

  it("札に置いた艦を選んで別の札に置くと、その札へ移り、ほかの艦の割り当ては変わらない", () => {
    const { store } = setup();
    store.getState().pressShip("hatsushimo");

    store.getState().placeSelected("rengo");

    expect(store.getState().assignments).toEqual({ ...summer2026Assignments, hatsushimo: "rengo" });
    expect(store.getState().selectedUid).toBeNull();
  });

  it("置いても、置いた艦のほかに開いていたカードは開いたまま（置いた艦のカードだけを閉じる）", () => {
    // 準備：伊168改を開き、続けて雪風改を選ぶ（伊168改は開いたまま）
    const { store } = setup();
    store.getState().pressShip("i168");
    store.getState().pressShip("yukikaze2");

    // 実行
    store.getState().placeSelected("rengo");

    // 検証
    expect(openSet(store)).toEqual(new Set(["i168"]));
  });

  it("艦を選んでいないときは、置く操作をしても何も変わらない", () => {
    const { store, save } = setup();

    store.getState().placeSelected("rengo");

    expect(store.getState().assignments).toEqual(summer2026Assignments);
    expect(store.getState().canUndo).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("ドラッグ＆ドロップ", () => {
  it("ドラッグを始めると、艦の選択が外れる", () => {
    const { store } = setup();
    store.getState().pressShip("hatsushimo");
    expect(store.getState().selectedUid).toBe("hatsushimo"); // 前提：選んでいる

    store.getState().startDrag("hatsushimo");

    expect(store.getState().selectedUid).toBeNull();
  });

  it("選んでいる艦と別の艦をドラッグし始めても、選択が外れる", () => {
    const { store } = setup();
    store.getState().pressShip("hatsushimo");
    expect(store.getState().selectedUid).toBe("hatsushimo"); // 前提：選んでいる

    store.getState().startDrag("yukikaze2");

    expect(store.getState().selectedUid).toBeNull();
  });

  it("控えの艦を札の列へ落とすと、その札へ移る", () => {
    const { store } = setup();

    store.getState().dropOnFuda("yukikaze2", "s31");

    expect(fudaOf(store, "yukikaze2")).toBe("s31");
  });

  it("札に置いた艦を別の札の列へ落とすと、その札へ移る", () => {
    const { store } = setup();

    store.getState().dropOnFuda("hatsushimo", "tago");

    expect(store.getState().assignments).toEqual({ ...summer2026Assignments, hatsushimo: "tago" });
  });

  it("札に置いた艦を今の札の列へ落としても、割り当ては変わらず、保存も「元に戻す」の対象にもならない", () => {
    const { store, save } = setup();

    store.getState().dropOnFuda("hatsushimo", "s31");

    expect(store.getState().assignments).toEqual(summer2026Assignments);
    expect(store.getState().canUndo).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("札に置いた艦を、別の札の艦に重ねて落とすと、2 隻の札が入れ替わる", () => {
    // 準備：初霜改二は第三十一戦隊、時雨改二は連合艦隊
    const { store } = setup();

    // 実行
    store.getState().dropOnShip("hatsushimo", "shigure2");

    // 検証
    expect(store.getState().assignments).toEqual({
      ...summer2026Assignments,
      hatsushimo: "rengo",
      shigure2: "s31",
    });
  });

  it("札に置いた艦を、控えの艦に重ねて落とすと、自分が控えに戻り、相手がその札に入る", () => {
    // 準備：初霜改二は第三十一戦隊、雪風改は控え
    const { store } = setup();

    // 実行
    store.getState().dropOnShip("hatsushimo", "yukikaze2");

    // 検証
    expect(fudaOf(store, "hatsushimo")).toBeUndefined();
    expect(fudaOf(store, "yukikaze2")).toBe("s31");
    expect(fudaOf(store, "fuyuzuki")).toBe("s31");
  });

  it("控えの艦を、札に置いた艦に重ねて落とすと、自分がその札に入り、相手が控えに戻る", () => {
    const { store } = setup();

    store.getState().dropOnShip("yukikaze2", "shigure2");

    expect(fudaOf(store, "yukikaze2")).toBe("rengo");
    expect(fudaOf(store, "shigure2")).toBeUndefined();
  });

  it("控えの艦どうし・同じ札の艦どうしを重ねても、割り当ては変わらず、保存も「元に戻す」の対象にもならない", () => {
    const { store, save } = setup();

    store.getState().dropOnShip("yukikaze2", "zuiho"); // 控えどうし
    store.getState().dropOnShip("hatsushimo", "fuyuzuki"); // どちらも第三十一戦隊

    expect(store.getState().assignments).toEqual(summer2026Assignments);
    expect(store.getState().canUndo).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("札に置いた艦を控えへ落とすと、割り当てが外れて控えに戻る", () => {
    const { store } = setup();

    store.getState().dropOnTray("hatsushimo");

    expect(fudaOf(store, "hatsushimo")).toBeUndefined();
    expect(fudaOf(store, "fuyuzuki")).toBe("s31");
  });

  it("控えの艦を控えへ落としても、割り当ては変わらず、保存も「元に戻す」の対象にもならない", () => {
    const { store, save } = setup();

    store.getState().dropOnTray("yukikaze2");

    expect(store.getState().assignments).toEqual(summer2026Assignments);
    expect(store.getState().canUndo).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("自分自身に重ねて落としても、割り当ては変わらず、保存も「元に戻す」の対象にもならない", () => {
    const { store, save } = setup();

    store.getState().dropOnShip("hatsushimo", "hatsushimo");
    store.getState().dropOnShip("yukikaze2", "yukikaze2");

    expect(store.getState().assignments).toEqual(summer2026Assignments);
    expect(store.getState().canUndo).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});

// 札へ移したら閉じる（「ここに置く」・札の列へ落とすは assign-store.place-close.test.ts）。ここでは入れ替え・控えへ戻す・動かないとき
describe("ドラッグで落としたときのカードの開閉", () => {
  /** uids を開き、選択だけをやめる（「×」と同じ。開いたまま） */
  function openOnly(store: AssignStore, ...uids: string[]): void {
    for (const uid of uids) store.getState().pressShip(uid);
    store.getState().clearSelection();
  }

  it("入れ替えでドラッグした艦が札へ移ると、その艦のカードは閉じ、押し出された艦の開閉は変わらない", () => {
    // 準備：控えの雪風改と、連合艦隊の時雨改二を開く
    const { store } = setup();
    openOnly(store, "yukikaze2", "shigure2");

    // 実行：雪風改を時雨改二に重ねて落とす（雪風改が連合艦隊へ、時雨改二が控えへ）
    store.getState().startDrag("yukikaze2");
    store.getState().dropOnShip("yukikaze2", "shigure2");

    // 検証
    expect(fudaOf(store, "yukikaze2")).toBe("rengo");
    expect(openSet(store)).toEqual(new Set(["shigure2"]));
  });

  it("札どうしの入れ替えでも、ドラッグした艦のカードだけを閉じる", () => {
    const { store } = setup();
    openOnly(store, "hatsushimo", "shigure2");

    store.getState().startDrag("hatsushimo");
    store.getState().dropOnShip("hatsushimo", "shigure2");

    expect(fudaOf(store, "hatsushimo")).toBe("rengo");
    expect(openSet(store)).toEqual(new Set(["shigure2"]));
  });

  it("控えの艦に重ねてドラッグした艦が控えへ戻ったときは、閉じない", () => {
    const { store } = setup();
    openOnly(store, "hatsushimo");

    store.getState().startDrag("hatsushimo");
    store.getState().dropOnShip("hatsushimo", "yukikaze2");

    expect(fudaOf(store, "hatsushimo")).toBeUndefined();
    expect(openSet(store)).toEqual(new Set(["hatsushimo"]));
  });

  it("控えへ落として割り当てを外しても、閉じない", () => {
    const { store } = setup();
    openOnly(store, "hatsushimo");

    store.getState().startDrag("hatsushimo");
    store.getState().dropOnTray("hatsushimo");

    expect(fudaOf(store, "hatsushimo")).toBeUndefined();
    expect(openSet(store)).toEqual(new Set(["hatsushimo"]));
  });

  it("今の札の列に落とした・同じ札の艦に重ねた（札が変わらない）ときは、閉じない", () => {
    const { store } = setup();
    openOnly(store, "hatsushimo");

    store.getState().startDrag("hatsushimo");
    store.getState().dropOnFuda("hatsushimo", "s31");
    store.getState().dropOnShip("hatsushimo", "fuyuzuki");

    expect(openSet(store)).toEqual(new Set(["hatsushimo"]));
  });
});

describe("元に戻す（U22：割り振り画面の中で 20 手まで）", () => {
  it("初めは戻すものがなく、「元に戻す」は押せない状態で、押しても何も変わらない", () => {
    const { store, save } = setup();

    expect(store.getState().canUndo).toBe(false);
    store.getState().undo();

    expect(store.getState().assignments).toEqual(summer2026Assignments);
    expect(save).not.toHaveBeenCalled();
  });

  it("割り当てを変えると押せるようになり、押すと直前の変更が戻る", () => {
    // 準備
    const { store } = setup();
    store.getState().dropOnFuda("yukikaze2", "rengo");
    expect(store.getState().canUndo).toBe(true);

    // 実行
    store.getState().undo();

    // 検証
    expect(store.getState().assignments).toEqual(summer2026Assignments);
    expect(store.getState().canUndo).toBe(false);
  });

  it("変更を重ねたときは、新しい変更から 1 つずつ戻る", () => {
    const { store } = setup();
    store.getState().dropOnFuda("yukikaze2", "rengo"); // 1 手目
    store.getState().dropOnShip("hatsushimo", "shigure2"); // 2 手目（入れ替え）
    store.getState().dropOnTray("i41"); // 3 手目

    store.getState().undo();
    expect(store.getState().assignments).toEqual({
      ...summer2026Assignments,
      yukikaze2: "rengo",
      hatsushimo: "rengo",
      shigure2: "s31",
    });

    store.getState().undo();
    expect(store.getState().assignments).toEqual({ ...summer2026Assignments, yukikaze2: "rengo" });

    store.getState().undo();
    expect(store.getState().assignments).toEqual(summer2026Assignments);
    expect(store.getState().canUndo).toBe(false);
  });

  it("「ここに置く」で置いた変更も戻せる", () => {
    const { store } = setup();
    store.getState().pressShip("yukikaze2");
    store.getState().placeSelected("rengo");
    expect(fudaOf(store, "yukikaze2")).toBe("rengo"); // 前提：置けている

    store.getState().undo();

    expect(store.getState().assignments).toEqual(summer2026Assignments);
  });

  it("戻せるのは 20 手まで：21 手目を入れると最も古い変更は戻せなくなる", () => {
    // 準備：控えの 21 隻を 1 隻ずつ第三十一戦隊へ置く（21 手）
    const { store } = setup({});
    const uids = Array.from({ length: 21 }, (_, i) => `ship-${i + 1}`);
    for (const uid of uids) store.getState().dropOnFuda(uid, "s31");

    // 実行：20 回戻す
    for (let i = 0; i < 20; i += 1) store.getState().undo();

    // 検証：1 手目（ship-1 を置いた）だけが残り、もう戻せない
    expect(store.getState().assignments).toEqual({ "ship-1": "s31" });
    expect(store.getState().canUndo).toBe(false);
  });

  it("20 手まで戻しきった後に押しても、何も変わらず保存もされない", () => {
    const { store, save } = setup({});
    for (let i = 1; i <= 21; i += 1) store.getState().dropOnFuda(`ship-${i}`, "s31");
    for (let i = 0; i < 20; i += 1) store.getState().undo();
    const before = store.getState().assignments;
    expect(before).toEqual({ "ship-1": "s31" }); // 前提：1 手目だけが残っている
    save.mockClear();

    store.getState().undo();

    expect(store.getState().assignments).toEqual(before);
    expect(save).not.toHaveBeenCalled();
  });

  it("20 手ちょうどなら、すべて戻せて初めの割り当てに戻る", () => {
    const { store } = setup({});
    for (let i = 1; i <= 20; i += 1) store.getState().dropOnFuda(`ship-${i}`, "s31");
    expect(Object.keys(store.getState().assignments)).toHaveLength(20); // 前提：20 隻置けている

    for (let i = 0; i < 20; i += 1) store.getState().undo();

    expect(store.getState().assignments).toEqual({});
    expect(store.getState().canUndo).toBe(false);
  });

  it("選択・開閉は「元に戻す」の対象にしない：戻しても今の選択と開いたカードはそのまま", () => {
    // 準備：雪風改を置いた（雪風改のカードは閉じる）後、別の艦を選んで開く
    const { store } = setup();
    store.getState().pressShip("yukikaze2");
    store.getState().placeSelected("rengo");
    store.getState().pressShip("i168");

    // 実行
    store.getState().undo();

    // 検証：割り当てだけが戻る（置いたときに閉じた雪風改のカードも開き直さない）
    expect(fudaOf(store, "yukikaze2")).toBeUndefined();
    expect(store.getState().selectedUid).toBe("i168");
    expect(openSet(store)).toEqual(new Set(["i168"]));
  });

  it("画面を移る（ストアを作り直す）と履歴は消え、初めは戻せない", () => {
    // 準備：前の画面で割り当てを変えた
    const first = setup();
    first.store.getState().dropOnFuda("yukikaze2", "rengo");
    const saved = first.store.getState().assignments;

    // 実行：割り振り画面を開き直す
    const { store } = setup(saved);

    // 検証
    expect(store.getState().assignments).toEqual({ ...summer2026Assignments, yukikaze2: "rengo" });
    expect(store.getState().canUndo).toBe(false);
  });
});

describe("割り当ての保存", () => {
  it("割り当てが変わるたびに、イベント ID と変わった後の割り当て全体を渡して保存の関数を呼ぶ", () => {
    // 準備
    const { store, save } = setup();

    // 実行
    store.getState().dropOnFuda("yukikaze2", "rengo");

    // 検証
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(EVENT_ID, { ...summer2026Assignments, yukikaze2: "rengo" });
  });

  it("置く・入れ替え・控えへ戻すのそれぞれで保存され、最後の呼び出しは今の割り当てと同じ", () => {
    const { store, save } = setup();

    store.getState().pressShip("zuiho");
    store.getState().placeSelected("rengo");
    store.getState().dropOnShip("hatsushimo", "shigure2");
    store.getState().dropOnTray("i41");

    expect(save).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenLastCalledWith(EVENT_ID, store.getState().assignments);
    expect(store.getState().assignments).toEqual({
      ...summer2026Assignments,
      zuiho: "rengo",
      hatsushimo: "rengo",
      shigure2: "s31",
      i41: undefined,
    });
  });

  it("「元に戻す」で戻した割り当ても保存される", () => {
    const { store, save } = setup();
    store.getState().dropOnFuda("yukikaze2", "rengo");
    save.mockClear();

    store.getState().undo();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(EVENT_ID, summer2026Assignments);
  });

  it("渡した初めの割り当て（凍結済みのテスト用データ）は書き換えない", () => {
    const { store } = setup();

    store.getState().dropOnFuda("yukikaze2", "rengo");
    store.getState().dropOnTray("hatsushimo");
    expect(fudaOf(store, "yukikaze2")).toBe("rengo"); // 前提：ストアの割り当ては変わっている

    expect(summer2026Assignments.yukikaze2).toBeUndefined();
    expect(summer2026Assignments.hatsushimo).toBe("s31");
  });
});

describe("保存の失敗（saveError）", () => {
  /** 結果を後から決める保存の結果 */
  function deferred() {
    let resolve: () => void = () => {};
    let reject: (reason: unknown) => void = () => {};
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /** 保存の結果の知らせ（Promise の then）が届き終わるのを待つ */
  async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("初めは null で、保存に失敗したらその理由（エラーのメッセージ）が入り、割り当ては変えたまま", async () => {
    // 準備
    const save = vi.fn<SaveAssignments>(() => Promise.reject(new Error("QuotaExceededError")));
    const store = createAssignStore({ eventId: EVENT_ID, assignments: summer2026Assignments, save });
    expect(store.getState().saveError).toBeNull();

    // 実行
    store.getState().dropOnFuda("yukikaze2", "rengo");
    await flush();

    // 検証
    expect(store.getState().saveError).toBe("QuotaExceededError");
    expect(fudaOf(store, "yukikaze2")).toBe("rengo");
  });

  it("後から頼んだ保存が先に成功し、前の保存が後から失敗しても、saveError は null のまま（最後に頼んだ保存の結果だけを映す）", async () => {
    // 準備：1 回目の保存は結果を待たせ、2 回目はすぐに成功させる
    const first = deferred();
    const save = vi.fn<SaveAssignments>();
    save.mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined);
    const store = createAssignStore({ eventId: EVENT_ID, assignments: summer2026Assignments, save });
    store.getState().dropOnFuda("yukikaze2", "rengo"); // 1 回目（待たせる）
    store.getState().dropOnFuda("zuiho", "rengo"); // 2 回目（成功）
    await flush();
    expect(store.getState().saveError).toBeNull(); // 前提：2 回目の成功が届いた

    // 実行：古い 1 回目の保存が後から失敗する
    first.reject(new Error("古い保存の失敗"));
    await flush();

    // 検証
    expect(save).toHaveBeenCalledTimes(2);
    expect(store.getState().saveError).toBeNull();
  });

  it("後から頼んだ保存が先に失敗し、前の保存が後から成功しても、saveError は失敗のまま", async () => {
    // 準備：1 回目の保存は結果を待たせ、2 回目はすぐに失敗させる
    const first = deferred();
    const save = vi.fn<SaveAssignments>();
    save.mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error("新しい保存の失敗"));
    const store = createAssignStore({ eventId: EVENT_ID, assignments: summer2026Assignments, save });
    store.getState().dropOnFuda("yukikaze2", "rengo"); // 1 回目（待たせる）
    store.getState().dropOnFuda("zuiho", "rengo"); // 2 回目（失敗）
    await flush();
    expect(store.getState().saveError).toBe("新しい保存の失敗"); // 前提：2 回目の失敗が届いた

    // 実行：古い 1 回目の保存が後から成功する
    first.resolve();
    await flush();

    // 検証
    expect(store.getState().saveError).toBe("新しい保存の失敗");
  });

  it("保存の関数がその場で例外を投げても、操作は止まらず（例外を外に出さず）saveError に理由が入る。割り当ては変わり、元に戻せる", () => {
    // 準備：Promise を返さずにその場で投げる保存の関数
    const save = vi.fn<SaveAssignments>(() => {
      throw new Error("保存先を開けません");
    });
    const store = createAssignStore({ eventId: EVENT_ID, assignments: summer2026Assignments, save });

    // 実行
    expect(() => store.getState().dropOnFuda("yukikaze2", "rengo")).not.toThrow();

    // 検証
    expect(store.getState().saveError).toBe("保存先を開けません");
    expect(fudaOf(store, "yukikaze2")).toBe("rengo");
    expect(store.getState().canUndo).toBe(true);
  });

  it("その場で例外を投げた後、次の保存が成功したら saveError は null に戻る", async () => {
    // 準備：1 回目だけその場で投げる
    const save = vi.fn<SaveAssignments>(() => Promise.resolve());
    save.mockImplementationOnce(() => {
      throw new Error("保存先を開けません");
    });
    const store = createAssignStore({ eventId: EVENT_ID, assignments: summer2026Assignments, save });
    store.getState().dropOnFuda("yukikaze2", "rengo");
    expect(store.getState().saveError).toBe("保存先を開けません"); // 前提

    // 実行
    store.getState().dropOnFuda("zuiho", "rengo");
    await flush();

    // 検証
    expect(store.getState().saveError).toBeNull();
  });
});
