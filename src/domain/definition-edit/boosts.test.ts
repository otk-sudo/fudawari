// 特効グループの編集（roadmap T3-6、U16）と「攻略サイトの艦名リストを貼り付け」のテスト
import { describe, expect, it } from "vitest";
import type { BoostNationality } from "@/domain/nationality";
import { summer2026Definition } from "@/test/fixtures";
import {
  addBoostGroup,
  addShipNames,
  deleteBoostGroup,
  parseShipNameList,
  removeShipName,
  setGroupNationalities,
  updateBoostGroup,
} from "./boosts";
import * as definitionEdit from "./index";
import { expectEditError, expectOk, groupOf, hasGroup, stageOf } from "./test-helpers";

const def = summer2026Definition;

describe("addBoostGroup（特効グループの追加）", () => {
  it("特効が未入力の段階に、空の特効グループ（名前なし・倍率 1・艦名なし）を追加する", () => {
    const doc = expectOk(addBoostGroup(def, { stageId: "E3-G", newGroupId: "E3-G-X" }));

    expect(stageOf(doc, "E3-G").boosts).toEqual([{ id: "E3-G-X", name: "", multiplier: 1, shipNames: [] }]);
  });

  it("名前・倍率・艦名を指定して、その段階の特効の最後に追加する", () => {
    const doc = expectOk(
      addBoostGroup(def, {
        stageId: "E3-4",
        newGroupId: "E3-4-D",
        name: "第二十七駆逐隊",
        multiplier: 1.2,
        shipNames: ["白露", "時雨"],
      }),
    );

    expect(stageOf(doc, "E3-4").boosts.map((g) => g.id)).toEqual(["E3-4-B", "E3-4-A", "E3-4-D"]);
    expect(groupOf(doc, "E3-4-D")).toEqual({
      id: "E3-4-D",
      name: "第二十七駆逐隊",
      multiplier: 1.2,
      shipNames: ["白露", "時雨"],
    });
    // ほかの段階は変わらない
    expect(doc.stages.filter((s) => s.id !== "E3-4")).toEqual(def.stages.filter((s) => s.id !== "E3-4"));
  });

  it("艦名は前後の空白を除き、重複を除く", () => {
    const doc = expectOk(
      addBoostGroup(def, { stageId: "E3-G", newGroupId: "E3-G-X", shipNames: [" 時雨 ", "時雨", "　白露"] }),
    );

    expect(groupOf(doc, "E3-G-X").shipNames).toEqual(["時雨", "白露"]);
  });

  it("倍率がちょうど 1 なら追加できる", () => {
    const doc = expectOk(addBoostGroup(def, { stageId: "E3-G", newGroupId: "E3-G-X", multiplier: 1 }));

    expect(groupOf(doc, "E3-G-X").multiplier).toBe(1);
  });

  it("倍率が 1 未満・有限の数でなければ invalid_value", () => {
    for (const multiplier of [0.99, 0, -1.2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectEditError(addBoostGroup(def, { stageId: "E3-G", newGroupId: "E3-G-X", multiplier }), "invalid_value");
    }
  });

  it("空の艦名があれば invalid_value", () => {
    expectEditError(
      addBoostGroup(def, { stageId: "E3-G", newGroupId: "E3-G-X", shipNames: ["時雨", "  "] }),
      "invalid_value",
    );
  });

  it("グループの ID が文書のどこか（別の段階を含む）にあれば duplicate_id", () => {
    expectEditError(addBoostGroup(def, { stageId: "E2-3", newGroupId: "E1-1-B" }), "duplicate_id");
  });

  it("ない段階には追加できない（not_found）", () => {
    expectEditError(addBoostGroup(def, { stageId: "no-such-stage", newGroupId: "X" }), "not_found");
  });
});

describe("updateBoostGroup（倍率と名前をその場で編集）", () => {
  it("倍率を変える", () => {
    const doc = expectOk(updateBoostGroup(def, "E2-3-C", { multiplier: 1.3 }));

    expect(groupOf(doc, "E2-3-C")).toEqual({ ...groupOf(def, "E2-3-C"), multiplier: 1.3 });
  });

  it("名前を変える（空でもよい）", () => {
    const renamed = expectOk(updateBoostGroup(def, "E2-3-C", { name: "連合艦隊C（新）" }));
    const emptied = expectOk(updateBoostGroup(def, "E2-3-C", { name: "" }));

    expect(groupOf(renamed, "E2-3-C")).toEqual({ ...groupOf(def, "E2-3-C"), name: "連合艦隊C（新）" });
    expect(groupOf(emptied, "E2-3-C").name).toBe("");
  });

  it("同じ段階のほかのグループは変わらない", () => {
    const doc = expectOk(updateBoostGroup(def, "E2-3-C", { multiplier: 1.3, name: "C" }));

    expect(groupOf(doc, "E2-3-B")).toEqual(groupOf(def, "E2-3-B"));
    expect(groupOf(doc, "E2-3-A")).toEqual(groupOf(def, "E2-3-A"));
  });

  it("倍率が 1 未満・有限の数でなければ invalid_value", () => {
    expectEditError(updateBoostGroup(def, "E2-3-C", { multiplier: 0.5 }), "invalid_value");
    expectEditError(updateBoostGroup(def, "E2-3-C", { multiplier: Number.NaN }), "invalid_value");
  });

  it("ないグループは変えられない（not_found）", () => {
    expectEditError(updateBoostGroup(def, "no-such-group", { multiplier: 1.1 }), "not_found");
  });
});

describe("addShipNames・removeShipName（艦名タグの追加と ×）", () => {
  it("艦名を最後に追加する", () => {
    const doc = expectOk(addShipNames(def, "E3-3-A", ["伊58"]));

    expect(groupOf(doc, "E3-3-A").shipNames).toEqual(["伊41", "伊58"]);
  });

  it("前後の空白を除き、既にある艦名・入力の中の重複は足さない", () => {
    const doc = expectOk(addShipNames(def, "E3-3-A", [" 伊58 ", "伊41", "伊19", "伊58"]));

    expect(groupOf(doc, "E3-3-A").shipNames).toEqual(["伊41", "伊58", "伊19"]);
  });

  it("空・空白だけの艦名は追加できない（invalid_value）", () => {
    expectEditError(addShipNames(def, "E3-3-A", [""]), "invalid_value");
    expectEditError(addShipNames(def, "E3-3-A", ["伊58", " 　"]), "invalid_value");
  });

  it("ないグループには追加できない（not_found）", () => {
    expectEditError(addShipNames(def, "no-such-group", ["伊58"]), "not_found");
  });

  it("艦名を 1 つ外す", () => {
    const doc = expectOk(removeShipName(def, "E2-3-C", "響"));

    expect(groupOf(doc, "E2-3-C").shipNames).toEqual(["千歳", "千代田", "瑞鳳", "瑞鶴", "初霜", "潮"]);
  });

  it("グループにない艦名・ないグループは外せない（not_found）", () => {
    expectEditError(removeShipName(def, "E2-3-C", "大和"), "not_found");
    expectEditError(removeShipName(def, "no-such-group", "響"), "not_found");
  });
});

describe("deleteBoostGroup（グループの ×）", () => {
  it("特効グループを削除し、同じ段階のほかのグループの並びは保たれる", () => {
    const doc = expectOk(deleteBoostGroup(def, "E2-3-B"));

    expect(stageOf(doc, "E2-3").boosts.map((g) => g.id)).toEqual(["E2-3-C", "E2-3-A"]);
    expect(hasGroup(doc, "E2-3-B")).toBe(false);
  });

  it("ないグループは削除できない（not_found）", () => {
    expectEditError(deleteBoostGroup(def, "no-such-group"), "not_found");
  });
});

describe("parseShipNameList（攻略サイトの艦名リストを貼り付け）", () => {
  it("改行で区切られた艦名を一覧にする（\\n・\\r\\n・\\r）", () => {
    expect(parseShipNameList("雪風\n時雨\r\n長波\r朝霜")).toEqual(["雪風", "時雨", "長波", "朝霜"]);
  });

  it("読点・カンマで区切られた艦名を一覧にする", () => {
    expect(parseShipNameList("雪風、時雨,長波，朝霜")).toEqual(["雪風", "時雨", "長波", "朝霜"]);
  });

  it("スラッシュ（半角・全角）で区切られた艦名を一覧にする", () => {
    expect(parseShipNameList("雪風/時雨／長波")).toEqual(["雪風", "時雨", "長波"]);
  });

  it("タブで区切られた艦名を一覧にする（表計算からの貼り付け）", () => {
    expect(parseShipNameList("雪風\t時雨\t長波")).toEqual(["雪風", "時雨", "長波"]);
  });

  it("区切りが混ざっていても、前後の空白（半角・全角）を除いて一覧にする", () => {
    expect(parseShipNameList("  雪風 、　時雨 /\n 長波  ")).toEqual(["雪風", "時雨", "長波"]);
  });

  it("空の項目は除く", () => {
    expect(parseShipNameList("雪風、、\n\n時雨、")).toEqual(["雪風", "時雨"]);
  });

  it("重複は除き、先に出た順に並べる", () => {
    expect(parseShipNameList("時雨、雪風、時雨、長波、雪風")).toEqual(["時雨", "雪風", "長波"]);
  });

  it("艦名の中の半角空白は区切りにしない", () => {
    expect(parseShipNameList("Gambier Bay、Samuel B.Roberts\nDe Ruyter")).toEqual([
      "Gambier Bay",
      "Samuel B.Roberts",
      "De Ruyter",
    ]);
  });

  it("空の文字列・区切りだけなら空の一覧", () => {
    expect(parseShipNameList("")).toEqual([]);
    expect(parseShipNameList(" 、\n／ ")).toEqual([]);
  });
});

describe("setGroupNationalities（特効グループの国籍を選び直す。v1.1）", () => {
  it("国籍を入れる（国籍のなかったグループに）", () => {
    const doc = expectOk(setGroupNationalities(def, "E2-3-C", ["usa"]));

    expect(groupOf(doc, "E2-3-C")).toEqual({ ...groupOf(def, "E2-3-C"), nationalities: ["usa"] });
  });

  it("BOOST_NATIONALITIES の順（日本・アメリカ・イギリス・ドイツ…）に並べ直し、重複を除く", () => {
    const doc = expectOk(setGroupNationalities(def, "E2-3-C", ["thailand", "uk", "usa", "uk", "japan", "germany"]));

    expect(groupOf(doc, "E2-3-C").nationalities).toEqual(["japan", "usa", "uk", "germany", "thailand"]);
  });

  it("国籍を持つグループの国籍を、渡した国籍だけに置き換える（足すのではない）", () => {
    const withUsa = expectOk(setGroupNationalities(def, "E2-3-C", ["usa", "uk"]));

    const doc = expectOk(setGroupNationalities(withUsa, "E2-3-C", ["italy"]));

    expect(groupOf(doc, "E2-3-C").nationalities).toEqual(["italy"]);
  });

  it("空にすると nationalities の項目を消す（キーを持たない）", () => {
    const withUsa = expectOk(setGroupNationalities(def, "E2-3-C", ["usa"]));

    const doc = expectOk(setGroupNationalities(withUsa, "E2-3-C", []));

    expect(Object.hasOwn(groupOf(doc, "E2-3-C"), "nationalities")).toBe(false);
    expect(groupOf(doc, "E2-3-C")).toEqual(groupOf(def, "E2-3-C"));
  });

  it("国籍のないグループを空にしても、項目は作らない", () => {
    const doc = expectOk(setGroupNationalities(def, "E2-3-C", []));

    expect(Object.hasOwn(groupOf(doc, "E2-3-C"), "nationalities")).toBe(false);
  });

  it("艦名・倍率・名前と、同じ段階・ほかの段階のグループは変わらない", () => {
    const doc = expectOk(setGroupNationalities(def, "E2-3-C", ["usa"]));

    expect(groupOf(doc, "E2-3-C")).toMatchObject({
      name: groupOf(def, "E2-3-C").name,
      multiplier: groupOf(def, "E2-3-C").multiplier,
      shipNames: groupOf(def, "E2-3-C").shipNames,
    });
    expect(groupOf(doc, "E2-3-B")).toEqual(groupOf(def, "E2-3-B"));
    expect(doc.stages.filter((s) => s.id !== "E2-3")).toEqual(def.stages.filter((s) => s.id !== "E2-3"));
  });

  it.each<[string, string]>([
    ["unknown（国籍ではあるが選べない）", "unknown"],
    ["知らない国籍", "china"],
    ["空の文字列", ""],
  ])("選べない国籍（%s）があれば invalid_value（文書は変えない）", (_label, value) => {
    expectEditError(
      setGroupNationalities(def, "E2-3-C", ["usa", value] as unknown as readonly BoostNationality[]),
      "invalid_value",
    );
  });

  it("ないグループは変えられない（not_found）", () => {
    expectEditError(setGroupNationalities(def, "no-such-group", ["usa"]), "not_found");
  });

  it("定義の編集の入口（@/domain/definition-edit）からも呼べる（同じ関数）", () => {
    expect(typeof setGroupNationalities).toBe("function");
    expect(definitionEdit.setGroupNationalities).toBe(setGroupNationalities);
  });
});
