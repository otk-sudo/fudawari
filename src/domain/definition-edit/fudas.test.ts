// 札の編集（roadmap T3-6、U10・U16）のテスト
import { describe, expect, it } from "vitest";
import { summer2026Definition } from "@/test/fixtures";
import { addFuda, canDeleteFuda, deleteFuda, FUDA_COLOR_CHOICES, moveFuda, updateFuda } from "./fudas";
import { editDoc, expectEditError, expectOk, fudaIdsOf, fudaOf } from "./test-helpers";

const def = summer2026Definition;

/** モック（PlanEditor.dc.html）とテスト用データの札の色 */
const MOCK_COLORS = ["#8B93A1", "#5FB0E8", "#4C8DF6", "#3FB37F", "#A97EF0"];

/** どの段階でも使っていない札（spare）を足した文書 */
const withSpareFuda = editDoc(def, (d) => {
  d.fudas.push({ id: "spare", name: "予備の札", color: "#3FB37F", gameNumber: 6 });
});

describe("FUDA_COLOR_CHOICES（札の色の選択肢）", () => {
  it("モックの 5 色を含み、すべて #RRGGBB で、重複がない", () => {
    expect(FUDA_COLOR_CHOICES).toEqual(expect.arrayContaining(MOCK_COLORS));
    for (const color of FUDA_COLOR_CHOICES) {
      expect(color).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(new Set(FUDA_COLOR_CHOICES).size).toBe(FUDA_COLOR_CHOICES.length);
  });
});

describe("addFuda（札の追加。名前・色・札番号）", () => {
  it("名前・色・札番号を入れて、一覧の最後に追加する", () => {
    const doc = expectOk(addFuda(def, { newFudaId: "kido", name: "機動部隊", color: "#3FB37F", gameNumber: 6 }));

    expect(doc.fudas).toEqual([...def.fudas, { id: "kido", name: "機動部隊", color: "#3FB37F", gameNumber: 6 }]);
    expect(doc.stages).toEqual(def.stages);
  });

  it("札番号は未入力（null）でもよい（U10：任意）", () => {
    const doc = expectOk(addFuda(def, { newFudaId: "kido", name: "機動部隊", color: "#A97EF0", gameNumber: null }));

    expect(fudaOf(doc, "kido").gameNumber).toBeNull();
  });

  it("名前が空・空白だけなら invalid_value", () => {
    expectEditError(addFuda(def, { newFudaId: "kido", name: "", color: "#3FB37F", gameNumber: null }), "invalid_value");
    expectEditError(
      addFuda(def, { newFudaId: "kido", name: " 　 ", color: "#3FB37F", gameNumber: null }),
      "invalid_value",
    );
  });

  it("用意した色にない色なら invalid_value", () => {
    expectEditError(
      addFuda(def, { newFudaId: "kido", name: "機動部隊", color: "#000001", gameNumber: null }),
      "invalid_value",
    );
    expectEditError(
      addFuda(def, { newFudaId: "kido", name: "機動部隊", color: "blue", gameNumber: null }),
      "invalid_value",
    );
  });

  it("札番号が 1 以上の整数でなければ invalid_value", () => {
    for (const gameNumber of [0, -1, 1.5, Number.NaN]) {
      expectEditError(
        addFuda(def, { newFudaId: "kido", name: "機動部隊", color: "#3FB37F", gameNumber }),
        "invalid_value",
      );
    }
  });

  it("札番号がほかの札と重複したら duplicate_game_number", () => {
    // 連合艦隊が 3
    expectEditError(
      addFuda(def, { newFudaId: "kido", name: "機動部隊", color: "#3FB37F", gameNumber: 3 }),
      "duplicate_game_number",
    );
  });

  it("札の ID が既にある札と同じなら duplicate_id", () => {
    expectEditError(
      addFuda(def, { newFudaId: "rengo", name: "機動部隊", color: "#3FB37F", gameNumber: null }),
      "duplicate_id",
    );
  });
});

describe("updateFuda（札の名前・色・札番号の変更）", () => {
  it("名前と色を変えても、段階の札の参照はそのまま", () => {
    const doc = expectOk(updateFuda(def, "rengo", { name: "連合艦隊（後段）", color: "#A97EF0" }));

    expect(fudaOf(doc, "rengo")).toEqual({ id: "rengo", name: "連合艦隊（後段）", color: "#A97EF0", gameNumber: 3 });
    expect(doc.stages).toEqual(def.stages);
    expect(fudaIdsOf(doc)).toEqual(fudaIdsOf(def));
  });

  it("用意した色にない色には変えられない（invalid_value）", () => {
    expectEditError(updateFuda(def, "rengo", { color: "#000001" }), "invalid_value");
  });

  it("札番号を変えられ、null で未入力に戻せる", () => {
    const changed = expectOk(updateFuda(def, "rengo", { gameNumber: 9 }));
    const cleared = expectOk(updateFuda(def, "rengo", { gameNumber: null }));

    expect(fudaOf(changed, "rengo").gameNumber).toBe(9);
    expect(fudaOf(cleared, "rengo").gameNumber).toBeNull();
  });

  it("自分の今の札番号と同じ番号は重複にしない", () => {
    const doc = expectOk(updateFuda(def, "rengo", { name: "連合", gameNumber: 3 }));

    expect(fudaOf(doc, "rengo")).toMatchObject({ name: "連合", gameNumber: 3 });
  });

  it("ほかの札の札番号と同じなら duplicate_game_number、1 以上の整数でなければ invalid_value", () => {
    // 第三十一戦隊が 1
    expectEditError(updateFuda(def, "rengo", { gameNumber: 1 }), "duplicate_game_number");
    expectEditError(updateFuda(def, "rengo", { gameNumber: 0 }), "invalid_value");
  });

  it("ない札は変えられない（not_found）", () => {
    expectEditError(updateFuda(def, "no-such-fuda", { name: "x" }), "not_found");
  });
});

describe("moveFuda（札の並べ替え。間に割り込み）", () => {
  it("落とした札の前へ移す（上へ動かす）", () => {
    const doc = expectOk(moveFuda(def, "sixth", "tago"));

    expect(fudaIdsOf(doc)).toEqual(["s31", "sixth", "tago", "rengo", "ulithi"]);
  });

  it("落とした札の前へ移す（下へ動かす）", () => {
    const doc = expectOk(moveFuda(def, "s31", "rengo"));

    expect(fudaIdsOf(doc)).toEqual(["tago", "s31", "rengo", "ulithi", "sixth"]);
  });

  it("null なら最後へ移す", () => {
    const doc = expectOk(moveFuda(def, "s31", null));

    expect(fudaIdsOf(doc)).toEqual(["tago", "rengo", "ulithi", "sixth", "s31"]);
  });

  it("自分自身の前やすぐ後ろの札の前に落としても、並びは変わらない", () => {
    expect(fudaIdsOf(expectOk(moveFuda(def, "rengo", "rengo")))).toEqual(fudaIdsOf(def));
    expect(fudaIdsOf(expectOk(moveFuda(def, "rengo", "ulithi")))).toEqual(fudaIdsOf(def));
  });

  it("札の中身と段階は変わらない", () => {
    const doc = expectOk(moveFuda(def, "sixth", "s31"));

    expect(fudaOf(doc, "sixth")).toEqual(fudaOf(def, "sixth"));
    expect(doc.stages).toEqual(def.stages);
  });

  it("ない札を指定すると not_found", () => {
    expectEditError(moveFuda(def, "no-such-fuda", null), "not_found");
    expectEditError(moveFuda(def, "s31", "no-such-fuda"), "not_found");
  });
});

describe("deleteFuda・canDeleteFuda（札の削除。使われていない札だけ）", () => {
  it("どの段階でも使われていない札は削除できる", () => {
    expect(canDeleteFuda(withSpareFuda, "spare")).toBe(true);

    const doc = expectOk(deleteFuda(withSpareFuda, "spare"));

    expect(fudaIdsOf(doc)).toEqual(["s31", "tago", "rengo", "ulithi", "sixth"]);
  });

  it("段階で使われている札は削除できない（fuda_in_use）", () => {
    expect(canDeleteFuda(def, "rengo")).toBe(false);
    expectEditError(deleteFuda(def, "rengo"), "fuda_in_use");
  });

  it("1 つの段階でだけ使われている札も削除できない", () => {
    // 第六艦隊は E3 ゲージ3 だけで使う
    expect(canDeleteFuda(def, "sixth")).toBe(false);
    expectEditError(deleteFuda(def, "sixth"), "fuda_in_use");
  });

  it("ない札は削除できない（not_found）", () => {
    expect(canDeleteFuda(def, "no-such-fuda")).toBe(false);
    expectEditError(deleteFuda(def, "no-such-fuda"), "not_found");
  });
});
