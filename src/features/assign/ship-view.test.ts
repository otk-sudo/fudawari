// 割り振り画面の表示に使う値を作る純粋な関数（ship-view.ts）の単体テスト
//
// テスト用データ
// - 定義：2026夏イベ（summer2026Definition）。札は定義の順に
//   第三十一戦隊（s31・#8B93A1）、多号作戦部隊（tago・#5FB0E8）、連合艦隊（rengo・#4C8DF6）、
//   ウルシー攻撃部隊（ulithi・#3FB37F）、第六艦隊（sixth・#A97EF0）
// - 段階（配列の順）：E1-1（s31）、E2-G（s31）、E2-1（tago）、E2-2（rengo）、E2-3（rengo）、E3-G（s31）、
//   E3-1（ulithi）、E3-2（s31）、E3-3（sixth）、E3-4（ulithi）
// - 艦：モックの所持艦 31 隻（summer2026Ships）、マスタは仮マスタ（summer2026MasterEntries）
//   - 時雨改二（shigure2）：連合艦隊 +110（E2 ゲージ2 ×1.19、E2 ゲージ3 ×1.24）、ウルシー攻撃部隊 +56
//   - 涼風改二（suzukaze）：どの札でも特効なし
import { describe, expect, it } from "vitest";
import { shipBoostSummary } from "@/domain/boost";
import { createShipMaster, lookupShip } from "@/domain/master";
import type { ShipLookup, ShipMasterEntry } from "@/domain/master/types";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import {
  cloneSummer2026Definition,
  shipByUid,
  summer2026Assignments,
  summer2026Definition,
  summer2026MasterEntries,
  summer2026Ships,
  unknownShip,
} from "@/test/fixtures";
import {
  boostIn,
  boostLines,
  formatMultiplier,
  formatVersionDate,
  fudaMapOf,
  fudaStageLabels,
  hasBoostIn,
  inkOn,
  placedFudaOf,
  shipEntryOf,
  shipsByFuda,
  shipTypeLabel,
} from "./ship-view";

// ---- テストの補助 ----

const def = summer2026Definition;
const master = createShipMaster(summer2026MasterEntries);
/** 定義の札 ID の集まり */
const FUDA_IDS: ReadonlySet<string> = new Set(def.fudas.map((fuda) => fuda.id));

/** マスタにある艦の引いた結果（艦種の番号だけを変える。ほかは時雨改二の値） */
function knownShipOfType(shipTypeId: number): ShipLookup {
  const base = summer2026MasterEntries.find((entry) => entry.id === 145);
  if (base === undefined) throw new Error("仮マスタに時雨改二（145）がありません");
  const entry: ShipMasterEntry = { ...base, shipTypeId };
  return { known: true, ...entry };
}

/** 個体の画面に出す情報（定義・仮マスタで引く） */
function entryOf(uid: string) {
  return shipEntryOf(def, master, shipByUid(uid));
}

describe("艦種の略称（shipTypeLabel）", () => {
  // 艦種の番号は start2 の api_mst_stype（docs/research/import-and-master.md）
  it.each([
    [1, "海防"],
    [2, "駆逐"],
    [3, "軽巡"],
    [4, "雷巡"],
    [5, "重巡"],
    [6, "航巡"],
    [7, "軽空"],
    [8, "戦艦"],
    [9, "戦艦"],
    [10, "航戦"],
    [11, "正空"],
    [12, "戦艦"],
    [13, "潜水"],
    [14, "潜空"],
    [15, "補給"],
    [16, "水母"],
    [17, "揚陸"],
    [18, "装空"],
    [19, "工作"],
    [20, "潜母"],
    [21, "練巡"],
    [22, "補給"],
  ] as const)("艦種 %i は「%s」", (shipTypeId, label) => {
    expect(shipTypeLabel(knownShipOfType(shipTypeId))).toBe(label);
  });

  it("対応表にない艦種の番号は「艦種不明」", () => {
    expect(shipTypeLabel(knownShipOfType(2))).toBe("駆逐"); // 対照：対応表にある番号
    expect(shipTypeLabel(knownShipOfType(0))).toBe("艦種不明");
    expect(shipTypeLabel(knownShipOfType(99))).toBe("艦種不明");
  });

  it("マスタにない艦は「艦種不明」", () => {
    expect(shipTypeLabel(lookupShip(master, unknownShip.shipId))).toBe("艦種不明");
  });
});

describe("艦の情報と特効（shipEntryOf・hasBoostIn・boostIn）", () => {
  it("個体・マスタで引いた情報・特効のまとめを持つ", () => {
    const ship = shipByUid("shigure2");

    const entry = shipEntryOf(def, master, ship);

    expect(entry.ship).toBe(ship);
    expect(entry.info).toMatchObject({ known: true, name: "時雨改二" });
    expect(entry.boost).toEqual(shipBoostSummary(def, { baseName: "時雨", nationality: "japan" }));
  });

  it("マスタにない艦は、名前が分からない艦で特効なし", () => {
    const entry = shipEntryOf(def, master, unknownShip);

    expect(entry.info).toMatchObject({ known: false, name: "名前が分からない艦" });
    expect(entry.boost.effective).toEqual([]);
    expect(entry.boost.ineffectiveFudaIds).toEqual(def.fudas.map((fuda) => fuda.id));
  });

  it("効く札では特効あり・その札の特効を返し、効かない札では特効なし・undefined", () => {
    const entry = entryOf("shigure2");

    expect(hasBoostIn(entry, "rengo")).toBe(true);
    expect(boostIn(entry, "rengo")).toMatchObject({ fudaId: "rengo", score: 110 });
    expect(hasBoostIn(entry, "sixth")).toBe(false);
    expect(boostIn(entry, "sixth")).toBeUndefined();
  });

  it("どの札でも効かない艦は、どの札でも特効なし", () => {
    const entry = entryOf("suzukaze");

    for (const fuda of def.fudas) {
      expect(hasBoostIn(entry, fuda.id), fuda.name).toBe(false);
      expect(boostIn(entry, fuda.id), fuda.name).toBeUndefined();
    }
  });
});

describe("個体の今の札（placedFudaOf）", () => {
  it("定義にある札に割り当てていればその札の ID", () => {
    expect(placedFudaOf({ shigure2: "rengo" }, "shigure2", FUDA_IDS)).toBe("rengo");
  });

  it("割り当てがない・値が undefined なら控え（null）", () => {
    expect(placedFudaOf({}, "shigure2", FUDA_IDS)).toBeNull();
    expect(placedFudaOf({ shigure2: undefined }, "shigure2", FUDA_IDS)).toBeNull();
  });

  it("定義にない札に割り当てていれば控え（null。U17）", () => {
    expect(placedFudaOf({ shigure2: "removed-fuda" }, "shigure2", FUDA_IDS)).toBeNull();
  });

  it("割り当て自身のキーだけを見る（プロトタイプから受け継いだ項目は割り当てとして拾わない）", () => {
    // 準備：自分のキーは持たず、プロトタイプに shigure2 → rengo がある割り当て
    const inherited: AssignmentMap = Object.create({ shigure2: "rengo" }) as AssignmentMap;
    expect(inherited.shigure2).toBe("rengo"); // 前提：普通に読むと見える

    // 実行・検証
    expect(placedFudaOf(inherited, "shigure2", FUDA_IDS)).toBeNull();
    expect(placedFudaOf({}, "toString", FUDA_IDS)).toBeNull();
  });
});

describe("札ごとの艦（shipsByFuda）", () => {
  it("定義の札をすべてキーに持ち（艦のいない札は空）、札の中は取り込んだ順", () => {
    // 準備：連合艦隊に 2 隻、第六艦隊に 1 隻、控えに 1 隻
    const ships: OwnedShip[] = [shipByUid("i41"), shipByUid("kitakami"), shipByUid("shigure2"), shipByUid("tone")];
    const assignments: AssignmentMap = { kitakami: "rengo", shigure2: "rengo", i41: "sixth" };

    // 実行
    const byFuda = shipsByFuda(def, ships, assignments);

    // 検証
    expect([...byFuda.keys()]).toEqual(["s31", "tago", "rengo", "ulithi", "sixth"]);
    expect(byFuda.get("rengo")?.map((ship) => ship.uid)).toEqual(["kitakami", "shigure2"]);
    expect(byFuda.get("sixth")?.map((ship) => ship.uid)).toEqual(["i41"]);
    expect(byFuda.get("s31")).toEqual([]);
  });

  it("定義にない札に割り当てた艦はどの札にも入れない（控え。U17）", () => {
    const ships = [shipByUid("shigure2"), shipByUid("tone")];

    const byFuda = shipsByFuda(def, ships, { shigure2: "removed-fuda", tone: "rengo" });

    expect(byFuda.has("removed-fuda")).toBe(false);
    expect([...byFuda.values()].flat().map((ship) => ship.uid)).toEqual(["tone"]);
  });

  it("一覧の割り当てでは 19 隻を札に置く（第三十一戦隊 4・多号作戦部隊 3・連合艦隊 8・ウルシー攻撃部隊 3・第六艦隊 1）", () => {
    const byFuda = shipsByFuda(def, summer2026Ships, summer2026Assignments);

    expect([...byFuda].map(([fudaId, ships]) => [fudaId, ships.length])).toEqual([
      ["s31", 4],
      ["tago", 3],
      ["rengo", 8],
      ["ulithi", 3],
      ["sixth", 1],
    ]);
  });
});

describe("札（fudaMapOf・fudaStageLabels）", () => {
  it("札 ID から札を引ける", () => {
    const fudas = fudaMapOf(def);

    expect(fudas.get("rengo")).toMatchObject({ name: "連合艦隊", color: "#4C8DF6" });
    expect(fudas.size).toBe(5);
  });

  it("札を使う段階の表示名を「海域名 段階名」で、定義の海域の順・海域の中は段階の配列の順に返す", () => {
    expect(fudaStageLabels(def, "s31")).toEqual(["E1 ギミック〜ゲージ3", "E2 ギミック", "E3 ギミック", "E3 ゲージ2 輸送"]);
    expect(fudaStageLabels(def, "rengo")).toEqual(["E2 ゲージ2", "E2 ゲージ3"]);
  });

  it("海域の順は段階の配列の順ではなく、定義の海域の順（海域の並びを逆にすると E3 が先）", () => {
    // 準備：海域の並びだけを E3・E2・E1 にした定義（段階の配列は E1 → E3 のまま）
    const reversed = cloneSummer2026Definition();
    reversed.areas.reverse();

    // 実行・検証：海域の中は段階の配列の順（E3 ギミック → E3 ゲージ2 輸送）のまま
    expect(fudaStageLabels(reversed, "s31")).toEqual(["E3 ギミック", "E3 ゲージ2 輸送", "E2 ギミック", "E1 ギミック〜ゲージ3"]);
  });

  it("どの段階にも使われない札・定義にない札は空", () => {
    expect(fudaStageLabels(def, "removed-fuda")).toEqual([]);
  });
});

describe("段階の倍率の行（boostLines）", () => {
  it("渡した札の順に、札の中は段階の順で、札の色・段階の表示名・倍率の行を作る（キーは重複しない）", () => {
    // 準備：時雨改二の効く札（連合艦隊 → ウルシー攻撃部隊）
    const entry = entryOf("shigure2");

    // 実行
    const lines = boostLines(def, fudaMapOf(def), entry.boost.effective);

    // 検証
    expect(lines.map(({ color, label, multiplier }) => [color, label, multiplier])).toEqual([
      ["#4C8DF6", "E2 ゲージ2", 1.19],
      ["#4C8DF6", "E2 ゲージ3", 1.24],
      ["#3FB37F", "E3 ゲージ1", 1.14],
      ["#3FB37F", "E3 ゲージ4", 1.14],
    ]);
    expect(new Set(lines.map((line) => line.key)).size).toBe(lines.length);
  });

  it("1 つの札だけを渡せば、その札の段階だけ", () => {
    const rengo = boostIn(entryOf("shigure2"), "rengo");
    if (rengo === undefined) throw new Error("時雨改二は連合艦隊で効くはず");

    const lines = boostLines(def, fudaMapOf(def), [rengo]);

    expect(lines.map((line) => line.label)).toEqual(["E2 ゲージ2", "E2 ゲージ3"]);
  });

  it("特効がなければ行はない", () => {
    expect(boostLines(def, fudaMapOf(def), entryOf("suzukaze").boost.effective)).toEqual([]);
  });
});

describe("書き方（formatMultiplier・formatVersionDate）", () => {
  it.each([
    [1.24, "×1.24"],
    [1.2, "×1.20"],
    [1.375, "×1.38"],
    [2, "×2.00"],
  ])("倍率 %s は「%s」（小数第 2 位まで）", (multiplier, expected) => {
    expect(formatMultiplier(multiplier)).toBe(expected);
  });

  it("特効データの版の日付は「YYYY/MM/DD」", () => {
    expect(formatVersionDate("2026-08-04")).toBe("2026/08/04");
    expect(formatVersionDate("2026-12-31")).toBe("2026/12/31");
  });
});

describe("札の色の上に置く文字の色（inkOn）", () => {
  it("白い札には暗い文字、黒い札には白い文字", () => {
    expect(inkOn("#FFFFFF")).toBe("dark");
    expect(inkOn("#000000")).toBe("light");
  });

  it("暗い文字の色（#101114）や濃い紺の札には白い文字", () => {
    expect(inkOn("#101114")).toBe("light");
    expect(inkOn("#1E3A8A")).toBe("light");
  });

  it.each(["#8B93A1", "#5FB0E8", "#4C8DF6", "#3FB37F", "#A97EF0"])(
    "2026夏イベの札の色 %s には暗い文字（相対輝度が 0.5 未満でも、コントラスト比は暗い文字の方が高い）",
    (color) => {
      expect(inkOn(color)).toBe("dark");
    },
  );

  it("コントラスト比の高い方を選ぶ：灰色の境目（#767676 は白い文字、#7A7A7A は暗い文字）", () => {
    // #767676：白との比 4.54、暗い文字との比 4.16 ／ #7A7A7A：白との比 4.29、暗い文字との比 4.40
    expect(inkOn("#767676")).toBe("light");
    expect(inkOn("#7A7A7A")).toBe("dark");
  });

  it("英字の小文字の色も同じに扱う", () => {
    expect(inkOn("#ffffff")).toBe("dark");
    expect(inkOn("#1e3a8a")).toBe("light");
  });

  it.each(["", "red", "#FFF", "#GGGGGG", "FFFFFF", "#0000000"])("色の形が「#RRGGBB」でなければ（%s）暗い文字", (color) => {
    expect(inkOn(color)).toBe("dark");
  });
});
