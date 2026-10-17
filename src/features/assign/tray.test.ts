// 割り振り画面の控えの絞り込みと並び順（roadmap T2-6、要件 3.3）の単体テスト
//
// テスト用データ
// - 艦：モックの所持艦 31 隻（summer2026Ships）＋足りない艦種の 7 隻（extraShips）＋マスタにない艦（unknownShip）
// - 割り当て：特に断らなければ一覧の割り当て（summer2026Assignments）。このときの控えは次の 20 隻
//   雪風改 yukikaze2（Lv85・駆逐・中間改造）、朝霜改二 asashimo2（Lv92・駆逐）、浜波改 hamanami（Lv110・駆逐）、
//   利根改二 tone（Lv150・航巡）、日向改二 hyuga（Lv140・航戦・伊勢型）、瑞鳳改二乙 zuiho（Lv130・軽空）、
//   秋津洲改 akitsushima（Lv95・水母）、大鯨 taigei（Lv80・潜母・未改造）、速吸改 hayasui（Lv90・補給）、
//   明石改 akashi（Lv99・工作）、あきつ丸改 akitsumaru（Lv88・揚陸・特効なし）、伊168改 i168（Lv100・潜水）、
//   妙高改二 myoukou（Lv147・重巡）、占守改 shimushu（Lv63・海防・特効なし）、大鳳改 taihou（Lv121・装空・特効なし）、
//   伊401改 i401（Lv104・潜空・特効なし）、鹿島改 kashima（Lv76・練巡）、榛名改二 haruna（Lv158・戦艦）、
//   伊勢 ise（Lv133・戦艦・伊勢型・未改造）、マスタにない艦 unknown（Lv1・特効なし）
//   （改造状態を書いていない艦は最終改造）
// - 一番効く札（2026夏イベの定義）：連合艦隊＝雪風改・朝霜改二・浜波改（+110）、利根改二・日向改二・大鯨・妙高改二・
//   鹿島改・榛名改二・伊勢（+82）、瑞鳳改二乙（+81）／多号作戦部隊＝秋津洲改・明石改（+24）／
//   ウルシー攻撃部隊＝速吸改（+56）／第六艦隊＝伊168改（+48）
import { describe, expect, it } from "vitest";
import { fudaBoost, shipBoostSummary } from "@/domain/boost";
import type { PublicDefinition } from "@/domain/definition/types";
import { boostTargetOf, createShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import {
  cloneSummer2026Definition,
  extraMasterEntries,
  extraShips,
  shipByUid,
  summer2026Assignments,
  summer2026Definition,
  summer2026DefinitionWithExtraFudas,
  summer2026MasterEntries,
  summer2026Ships,
  unknownShip,
} from "@/test/fixtures";
import {
  buildTray,
  countActiveFilters,
  createInitialTrayOptions,
  resetTrayOptions,
  SHIP_TYPE_TABS,
  shipTypeTabOf,
  type BuildTrayInput,
  type ShipTypeTabId,
  type TrayOptions,
  type TrayResult,
} from "./tray";

// ---- テストの補助 ----

const def = summer2026Definition;
const master = createShipMaster([...summer2026MasterEntries, ...extraMasterEntries]);
/** マスタにない艦を含むすべての艦 */
const allShips: readonly OwnedShip[] = [...summer2026Ships, ...extraShips, unknownShip];
/** マスタにある艦だけ（マスタにない艦の扱いに左右されないテストで使う） */
const knownShips: readonly OwnedShip[] = [...summer2026Ships, ...extraShips];
const extraShip = (uid: string): OwnedShip => {
  const found = extraShips.find((s) => s.uid === uid);
  if (!found) throw new Error(`追加のテスト用データに個体 ${uid} がありません`);
  return found;
};

/** 一覧の割り当てのときの控え（マスタにある艦） */
const TRAY_KNOWN_UIDS = [
  "yukikaze2", "asashimo2", "hamanami", "tone", "hyuga", "zuiho", "akitsushima", "taigei", "hayasui", "akashi",
  "akitsumaru", "i168", "myoukou", "shimushu", "taihou", "i401", "kashima", "haruna", "ise",
];
/** 上のうち、どの札でも特効がない艦 */
const NO_BOOST_UIDS = ["akitsumaru", "shimushu", "taihou", "i401"];

/** 条件をすべて外した状態（すべて表示・並び順は艦型）。テストごとに必要な条件だけを変える */
const NO_FILTER: TrayOptions = {
  query: "",
  tab: "all",
  remodelStages: { unremodeled: true, intermediate: true, final: true },
  boostOnly: false,
  fudaIds: [],
  sort: "class",
  view: "dense",
};

/** 控えを作る。既定は 2026夏イベの定義・すべての艦・一覧の割り当て・条件なし */
function tray(
  patch: Partial<TrayOptions> = {},
  input: Partial<Omit<BuildTrayInput, "options">> = {},
): TrayResult {
  return buildTray({
    definition: def,
    master,
    ships: allShips,
    assignments: summer2026Assignments,
    ...input,
    options: { ...NO_FILTER, ...patch },
  });
}

/** 表示される艦の個体 ID（並び順どおり） */
function shownUids(result: TrayResult): string[] {
  return result.groups.flatMap((g) => g.entries.map((e) => e.ship.uid));
}

/** 区切りを [見出し, 個体 ID の並び] の形にして比べやすくする */
function compactGroups(result: TrayResult): [string, string[]][] {
  return result.groups.map((g) => [g.title, g.entries.map((e) => e.ship.uid)]);
}

/** 見出しの区切りの個体 ID（その見出しの区切りがあることも確かめる） */
function groupUids(result: TrayResult, title: string): string[] {
  expect(result.groups.map((g) => g.title)).toContain(title);
  const group = result.groups.find((g) => g.title === title);
  return group?.entries.map((e) => e.ship.uid) ?? [];
}

/** 個体をある札に置いたときのスコア（期待値を特効の計算から求める） */
function scoreOf(uid: string, fudaId: string, definition: PublicDefinition = def): number {
  const ship = allShips.find((s) => s.uid === uid);
  if (!ship) throw new Error(`個体 ${uid} がありません`);
  return fudaBoost(definition, fudaId, boostTargetOf(master, ship.shipId)).score;
}

/** 2026夏イベの定義の「E3 ギミック」（第三十一戦隊・特効なし）に、あきつ丸へ ×1.001 の特効を足した定義（スコアは丸めて 0、でも特効あり） */
function definitionWithTinyBoost(): PublicDefinition {
  const copy = cloneSummer2026Definition();
  const stage = copy.stages.find((s) => s.id === "E3-G");
  if (!stage) throw new Error("段階 E3-G がありません");
  stage.boosts.push({ id: "E3-G-X", name: "微小", multiplier: 1.001, shipNames: ["あきつ丸"] });
  return copy;
}

const ALL_SORTS = ["class", "lv", "boost", "name"] as const;

/** ALL 以外の艦種タブの ID（SHIP_TYPE_TABS の実装に頼らず並べる） */
const SHIP_TYPE_TABS_WITHOUT_ALL: readonly Exclude<ShipTypeTabId, "all">[] = [
  "carrier", "light-carrier", "battleship", "aviation-battleship", "heavy-cruiser", "aviation-cruiser",
  "light-cruiser", "destroyer", "escort", "submarine", "seaplane-tender", "other",
];

describe("控えの数（「表示数 / 控えの総数」）", () => {
  it("控えは割り当てていない艦で、条件なしなら表示数と控えの総数はどちらも控えの隻数", () => {
    const result = tray();

    expect(new Set(shownUids(result))).toEqual(new Set([...TRAY_KNOWN_UIDS, "unknown"]));
    expect(result.shownCount).toBe(20);
    expect(result.totalCount).toBe(20);
  });

  it("札に置いた艦は、条件に合っても控えに出ない", () => {
    const result = tray({ query: "時雨" });

    // 時雨改三（ウルシー攻撃部隊）と時雨改二（連合艦隊）はどちらも札に置いてある
    expect(shownUids(result)).toEqual([]);
    expect(result.totalCount).toBe(20);
  });

  it("絞り込むと表示数だけが減り、控えの総数は変わらない。区切りの隻数の合計は表示数と同じ", () => {
    const result = tray({ boostOnly: true });

    expect(result.shownCount).toBe(15);
    expect(result.totalCount).toBe(20);
    expect(result.groups.reduce((sum, g) => sum + g.count, 0)).toBe(15);
  });

  it("初期の条件（並び順「艦型」・「特効のある艦だけ」ON）では、特効のある控えの艦だけが出る", () => {
    const result = buildTray({
      definition: def,
      master,
      ships: allShips,
      assignments: summer2026Assignments,
      options: createInitialTrayOptions(),
    });

    expect(new Set(shownUids(result))).toEqual(
      new Set(TRAY_KNOWN_UIDS.filter((uid) => !NO_BOOST_UIDS.includes(uid))),
    );
    expect(result.shownCount).toBe(15);
    expect(result.totalCount).toBe(20);
  });

  it("定義にない札に割り当てた艦は、控えとして数えて出す（U17：定義から消えた札の割り当ては控えに戻す）", () => {
    const assignments: AssignmentMap = { ...summer2026Assignments, i41: "deleted-fuda" };

    const result = tray({}, { assignments });

    expect(shownUids(result)).toContain("i41");
    expect(result.totalCount).toBe(21);
  });

  it("条件に合う艦がいないときは区切りが空で、表示数は 0（控えの総数はそのまま）", () => {
    const result = tray({ query: "該当する艦はいない" });

    expect(result.groups).toEqual([]);
    expect(result.shownCount).toBe(0);
    expect(result.totalCount).toBe(20);
  });
});

describe("検索（図鑑 ID・名称）", () => {
  it("名称の一部で検索できる", () => {
    const result = tray({ query: "時雨" }, { assignments: {} });

    expect(new Set(shownUids(result))).toEqual(new Set(["shigure", "shigure2"]));
  });

  it("名称の途中の文字でも一致する", () => {
    const result = tray({ query: "改二乙" }, { assignments: {} });

    expect(new Set(shownUids(result))).toEqual(new Set(["kasumi", "yahagi", "zuiho"]));
  });

  it("図鑑 ID（マスタの図鑑番号）で検索できる", () => {
    // 時雨改二の図鑑番号は 1003（テスト用の値）
    const result = tray({ query: "1003" }, { assignments: {} });

    expect(shownUids(result)).toEqual(["shigure2"]);
  });

  it("図鑑 ID は数字がちょうど一致したときだけ当たる（図鑑番号 1001〜1009 は「100」では当たらない）", () => {
    // 対照：時雨改三の図鑑番号 1004 ちょうどなら当たる
    expect(shownUids(tray({ query: "1004" }, { assignments: {} }))).toEqual(["shigure"]);

    const result = tray({ query: "100" }, { assignments: {} });

    expect(shownUids(result)).toEqual([]);
  });

  it("数字だけの検索でも、名称に含まれていれば当たる（「41」は伊41改の名称に一致。図鑑番号 41 の艦はいない）", () => {
    const result = tray({ query: "41" }, { assignments: {} });

    expect(shownUids(result)).toEqual(["i41"]);
  });

  it("前後の空白（半角・全角）は無視する", () => {
    const result = tray({ query: " 時雨　" }, { assignments: {} });

    expect(new Set(shownUids(result))).toEqual(new Set(["shigure", "shigure2"]));
  });

  it("検索欄が空なら絞り込まない", () => {
    const result = tray({ query: "" }, { assignments: {} });

    expect(result.shownCount).toBe(allShips.length);
  });

  it("英字の大文字・小文字を区別しない（「warspite」「WARSPITE」「ｗａｒｓｐｉｔｅ」で Warspite改 が当たる）", () => {
    // 準備：英字の名前の艦（仮マスタにない艦 ID）を足す
    const warspite: OwnedShip = { uid: "warspite", shipId: 439, level: 99, luck: 12, sallyArea: 0 };
    const withWarspite = createShipMaster([
      ...summer2026MasterEntries,
      {
        id: 439,
        name: "Warspite改",
        baseName: "Warspite",
        yomi: "うぉーすぱいと",
        shipTypeId: 9,
        shipClassId: 67,
        shipClassName: "Queen Elizabeth級",
        nationality: "uk",
        remodelStage: "final",
        sortNo: 1100,
        luckBase: 10,
      },
    ]);

    // 実行・検証
    for (const query of ["warspite", "WARSPITE", "ｗａｒｓｐｉｔｅ"]) {
      const result = tray({ query }, { master: withWarspite, ships: [...summer2026Ships, warspite], assignments: {} });
      expect(shownUids(result), `検索「${query}」`).toEqual(["warspite"]);
    }
  });
});

describe("艦種タブ（要件 3.3 の対応表）", () => {
  it("13 のタブが要件の表の順に並ぶ", () => {
    expect(SHIP_TYPE_TABS.map((t) => t.label)).toEqual([
      "ALL", "空母", "軽母", "戦艦", "航戦", "重巡", "航巡", "軽巡", "駆逐", "海防", "潜水", "水母", "その他",
    ]);
    expect(SHIP_TYPE_TABS.map((t) => t.id)).toEqual([
      "all", "carrier", "light-carrier", "battleship", "aviation-battleship", "heavy-cruiser", "aviation-cruiser",
      "light-cruiser", "destroyer", "escort", "submarine", "seaplane-tender", "other",
    ]);
  });

  // 艦種の番号は start2 の api_mst_stype（docs/research/import-and-master.md）
  it.each([
    [11, "正規空母", "carrier"],
    [18, "装甲空母", "carrier"],
    [7, "軽空母", "light-carrier"],
    [8, "戦艦", "battleship"],
    [9, "戦艦", "battleship"],
    [10, "航空戦艦", "aviation-battleship"],
    [5, "重巡洋艦", "heavy-cruiser"],
    [6, "航空巡洋艦", "aviation-cruiser"],
    [3, "軽巡洋艦", "light-cruiser"],
    [4, "重雷装巡洋艦", "light-cruiser"],
    [21, "練習巡洋艦", "light-cruiser"],
    [2, "駆逐艦", "destroyer"],
    [1, "海防艦", "escort"],
    [13, "潜水艦", "submarine"],
    [14, "潜水空母", "submarine"],
    [16, "水上機母艦", "seaplane-tender"],
    [20, "潜水母艦", "other"],
    [17, "揚陸艦", "other"],
    [15, "補給艦", "other"],
    [22, "補給艦", "other"],
    [19, "工作艦", "other"],
  ] as const)("艦種 %i（%s）は「%s」のタブに入る", (shipTypeId, _name, tab) => {
    expect(shipTypeTabOf(shipTypeId)).toBe(tab);
  });

  it("対応表にない艦種の番号は、ALL 以外のどのタブにも入らない", () => {
    expect(shipTypeTabOf(2)).toBe("destroyer"); // 対照：対応表にある番号
    expect(shipTypeTabOf(0)).toBeNull();
    expect(shipTypeTabOf(99)).toBeNull();
  });

  // 割り当てなし（すべての艦が控え）・条件なしで、タブごとに出る艦
  it.each<[ShipTypeTabId, string[]]>([
    ["carrier", ["zuikaku", "taihou"]],
    ["light-carrier", ["zuiho"]],
    ["battleship", ["yamato", "nagato", "haruna", "ise"]],
    ["aviation-battleship", ["hyuga"]],
    ["heavy-cruiser", ["myoukou"]],
    ["aviation-cruiser", ["tone"]],
    ["light-cruiser", ["isuzu", "yahagi", "kitakami", "kashima"]],
    [
      "destroyer",
      [
        "shigure", "shigure2", "yukikaze", "yukikaze2", "naganami", "okinami", "asashimo", "asashimo2",
        "hatsushimo", "ushio", "fuyuzuki", "shiranui", "kasumi", "hamanami", "suzukaze",
      ],
    ],
    ["escort", ["shimushu"]],
    ["submarine", ["i41", "i168", "i401"]],
    ["seaplane-tender", ["akitsushima"]],
    ["other", ["taigei", "akitsumaru", "hayasui", "akashi"]],
  ])("タブ %s では対応する艦種の艦だけが出る", (tab, expected) => {
    const result = tray({ tab }, { assignments: {} });

    expect(new Set(shownUids(result))).toEqual(new Set(expected));
  });

  it("ALL ではマスタにない艦を含むすべての控えの艦が出る", () => {
    const result = tray({ tab: "all" }, { assignments: {} });

    expect(new Set(shownUids(result))).toEqual(new Set(allShips.map((s) => s.uid)));
  });
});

describe("改造状態・「特効のある艦だけ」・「特効が効く札」で絞り込む", () => {
  it("未改造を外すと、未改造の艦（大鯨・伊勢）が出なくなる", () => {
    const result = tray(
      { remodelStages: { unremodeled: false, intermediate: true, final: true } },
      { ships: knownShips },
    );

    expect(new Set(shownUids(result))).toEqual(
      new Set(TRAY_KNOWN_UIDS.filter((uid) => uid !== "taigei" && uid !== "ise")),
    );
  });

  it("中間改造を外すと、中間改造の艦（雪風改）が出なくなる", () => {
    const result = tray(
      { remodelStages: { unremodeled: true, intermediate: false, final: true } },
      { ships: knownShips },
    );

    expect(new Set(shownUids(result))).toEqual(new Set(TRAY_KNOWN_UIDS.filter((uid) => uid !== "yukikaze2")));
  });

  it("最終改造を外すと、未改造・中間改造の艦だけが出る", () => {
    const result = tray(
      { remodelStages: { unremodeled: true, intermediate: true, final: false } },
      { ships: knownShips },
    );

    expect(new Set(shownUids(result))).toEqual(new Set(["yukikaze2", "taigei", "ise"]));
  });

  it("「特効のある艦だけ」では、どれかの札で特効がある艦だけが出る（特効のない艦・マスタにない艦は出ない）", () => {
    const result = tray({ boostOnly: true });

    expect(new Set(shownUids(result))).toEqual(
      new Set(TRAY_KNOWN_UIDS.filter((uid) => !NO_BOOST_UIDS.includes(uid))),
    );
  });

  it("「特効のある艦だけ」は倍率が 1 より大きいかで決める：スコアが丸めて 0 になる艦も出る（hasBoost）", () => {
    // 準備：あきつ丸改は第三十一戦隊で ×1.001（スコア 0）
    const definition = definitionWithTinyBoost();
    expect(scoreOf("akitsumaru", "s31", definition)).toBe(0);

    // 実行
    const result = tray({ boostOnly: true }, { definition });

    // 検証
    expect(shownUids(result)).toContain("akitsumaru");
  });

  it("「特効が効く札」で 1 つ選ぶと、その札で特効がある艦だけが出る", () => {
    const result = tray({ fudaIds: ["sixth"] });

    expect(shownUids(result)).toEqual(["i168"]);
  });

  it("「特効が効く札」で複数選ぶと、選んだ札のどれかで特効がある艦が出る", () => {
    const result = tray({ fudaIds: ["tago", "sixth"] });

    expect(new Set(shownUids(result))).toEqual(new Set(["asashimo2", "hamanami", "akitsushima", "akashi", "i168"]));
  });

  it("「特効が効く札」は一番効く札でなくてもよい（雪風改・朝霜改二は連合艦隊が一番だが、第三十一戦隊でも効く）", () => {
    const result = tray({ fudaIds: ["s31"] });

    expect(new Set(shownUids(result))).toEqual(new Set(["yukikaze2", "asashimo2"]));
  });

  it("「特効が効く札」もスコアではなく倍率で決める：スコアが丸めて 0 の札を選んでも出る", () => {
    const result = tray({ fudaIds: ["s31"] }, { definition: definitionWithTinyBoost() });

    expect(shownUids(result)).toContain("akitsumaru");
  });

  it("どの段階にも使われない札だけを選ぶと、条件に合う艦はいない", () => {
    // 対照：同じ定義で使われている札（連合艦隊）を選べば艦が出る
    expect(tray({ fudaIds: ["rengo"] }, { definition: summer2026DefinitionWithExtraFudas }).shownCount).toBeGreaterThan(0);

    const result = tray({ fudaIds: ["unused"] }, { definition: summer2026DefinitionWithExtraFudas });

    expect(result.groups).toEqual([]);
    expect(result.shownCount).toBe(0);
  });

  it("条件はすべて同時に効く（艦種タブ・検索・改造状態・特効・札）", () => {
    const result = tray({ tab: "destroyer", boostOnly: true, fudaIds: ["tago"] });

    expect(new Set(shownUids(result))).toEqual(new Set(["asashimo2", "hamanami"]));
  });
});

describe("条件の数（「絞り込み」のバッジ）", () => {
  it("外した改造状態の数だけ数える", () => {
    const base = { boostOnly: false, fudaIds: [] };

    expect(countActiveFilters({ ...base, remodelStages: { unremodeled: true, intermediate: true, final: true } })).toBe(0);
    expect(countActiveFilters({ ...base, remodelStages: { unremodeled: false, intermediate: true, final: true } })).toBe(1);
    expect(countActiveFilters({ ...base, remodelStages: { unremodeled: false, intermediate: false, final: true } })).toBe(2);
    expect(countActiveFilters({ ...base, remodelStages: { unremodeled: false, intermediate: false, final: false } })).toBe(3);
  });

  it("「特効のある艦だけ」は ON なら 1 つと数える", () => {
    const remodelStages = { unremodeled: true, intermediate: true, final: true };

    expect(countActiveFilters({ remodelStages, boostOnly: true, fudaIds: [] })).toBe(1);
    expect(countActiveFilters({ remodelStages, boostOnly: false, fudaIds: [] })).toBe(0);
  });

  it("選んだ札の数だけ数え、外した改造状態・「特効のある艦だけ」と足し合わせる", () => {
    const count = countActiveFilters({
      remodelStages: { unremodeled: false, intermediate: true, final: false },
      boostOnly: true,
      fudaIds: ["rengo", "sixth"],
    });

    expect(count).toBe(5);
  });

  it("艦種タブ・検索・並び順・表示は数えない", () => {
    const options: TrayOptions = { ...NO_FILTER, tab: "destroyer", query: "時雨", sort: "lv", view: "card" };

    expect(countActiveFilters(options)).toBe(0);
    expect(countActiveFilters({ ...options, boostOnly: true })).toBe(1);
  });

  it("初期の条件では 1（「特効のある艦だけ」が ON）", () => {
    expect(countActiveFilters(createInitialTrayOptions())).toBe(1);
  });
});

describe("初期の条件と「リセット」", () => {
  it("初期値は艦種タブ ALL・並び順「艦型」・改造状態すべて ON・「特効のある艦だけ」ON・札の選択なし・検索なし・表示「一行」", () => {
    expect(createInitialTrayOptions()).toEqual({
      query: "",
      tab: "all",
      remodelStages: { unremodeled: true, intermediate: true, final: true },
      boostOnly: true,
      fudaIds: [],
      sort: "class",
      view: "dense",
    });
  });

  it("並び順と表示の初期値は外から渡せる（設定の値。ほかの初期値は変わらない）", () => {
    const options = createInitialTrayOptions({ sort: "lv", view: "card" });

    expect(options.sort).toBe("lv");
    expect(options.view).toBe("card");
    expect(options.boostOnly).toBe(true);
    expect(options.tab).toBe("all");
  });

  it("「リセット」で、艦種タブ ALL・並び順「艦型」・改造状態すべて ON・「特効のある艦だけ」OFF・札の選択なしに戻り、条件の数は 0 になる", () => {
    // 準備：条件をいろいろ変えた状態
    const changed: TrayOptions = {
      query: "",
      tab: "destroyer",
      remodelStages: { unremodeled: false, intermediate: false, final: true },
      boostOnly: true,
      fudaIds: ["rengo", "tago"],
      sort: "boost",
      view: "dense",
    };

    // 実行
    const reset = resetTrayOptions(changed);

    // 検証
    expect(reset.tab).toBe("all");
    expect(reset.sort).toBe("class");
    expect(reset.remodelStages).toEqual({ unremodeled: true, intermediate: true, final: true });
    expect(reset.boostOnly).toBe(false);
    expect(reset.fudaIds).toEqual([]);
    expect(countActiveFilters(reset)).toBe(0);
  });

  it("「リセット」は、設定から渡した並び順でも「艦型」に戻し、表示（一行／カード）は変えない（モックの resetAll どおり）", () => {
    const options = createInitialTrayOptions({ sort: "name", view: "card" });

    const reset = resetTrayOptions(options);

    expect(reset.sort).toBe("class");
    expect(reset.view).toBe("card");
    expect(reset.boostOnly).toBe(false);
  });
});

describe("並び順：艦型", () => {
  it("艦型ごとに区切り、艦種の順（戦艦→航戦→装空→軽空→重巡→航巡→練巡→駆逐→海防→潜水→潜空→水母→潜母→揚陸→補給→工作）に並ぶ", () => {
    // 伊勢（艦型が 2 つの艦種にまたがる例）は別のテストで確かめるため外す
    const ships = knownShips.filter((s) => s.uid !== "ise");

    const result = tray({ sort: "class" }, { ships });

    expect(compactGroups(result)).toEqual([
      ["金剛型", ["haruna"]],
      ["伊勢型", ["hyuga"]],
      ["大鳳型", ["taihou"]],
      ["祥鳳型", ["zuiho"]],
      ["妙高型", ["myoukou"]],
      ["利根型", ["tone"]],
      ["香取型", ["kashima"]],
      ["夕雲型", ["hamanami", "asashimo2"]],
      ["陽炎型", ["yukikaze2"]],
      ["占守型", ["shimushu"]],
      ["海大VI型", ["i168"]],
      ["巡潜甲型改二", ["i401"]],
      ["秋津洲型", ["akitsushima"]],
      ["大鯨型", ["taigei"]],
      ["特種船丙型", ["akitsumaru"]],
      ["速吸型", ["hayasui"]],
      ["明石型", ["akashi"]],
    ]);
  });

  it("正空は装空より前、軽巡→雷巡→練巡の順に並ぶ", () => {
    // 準備：わざと逆の順に渡す
    const ships = [extraShip("kashima"), shipByUid("kitakami"), shipByUid("isuzu"), extraShip("taihou"), shipByUid("zuikaku")];

    const result = tray({ sort: "class" }, { ships, assignments: {} });

    expect(result.groups.map((g) => g.title)).toEqual(["翔鶴型", "大鳳型", "長良型", "球磨型", "香取型"]);
  });

  it("同じ艦種の中は艦型名の順（夕雲型→陽炎型）、艦型の中は Lv の高い順", () => {
    const result = tray({ sort: "class", tab: "destroyer" }, { ships: knownShips, assignments: {} });

    const titles = result.groups.map((g) => g.title);
    expect(titles.indexOf("夕雲型")).toBeLessThan(titles.indexOf("陽炎型"));
    // 長波改二 152、朝霜改二 140、沖波改二 130、浜波改 110、朝霜改二 92
    expect(groupUids(result, "夕雲型")).toEqual(["naganami", "asashimo", "okinami", "hamanami", "asashimo2"]);
    // 雪風改二 168、不知火改二 145、雪風改 85
    expect(groupUids(result, "陽炎型")).toEqual(["yukikaze", "shiranui", "yukikaze2"]);
  });

  it("艦型が 2 つの艦種にまたがるときは見出しを 1 つにまとめ、前の艦種の位置に置き、中は Lv の高い順", () => {
    // 準備：伊勢型は 伊勢（戦艦・Lv133）と 日向改二（航戦・Lv140）、金剛型は 榛名改二（戦艦・Lv158）
    const ships = [shipByUid("hyuga"), extraShip("ise"), extraShip("haruna")];

    // 実行
    const result = tray({ sort: "class" }, { ships });

    // 検証：伊勢型は戦艦の位置（艦型名の順で金剛型より前）に 1 つだけ
    expect(compactGroups(result)).toEqual([
      ["伊勢型", ["hyuga", "ise"]],
      ["金剛型", ["haruna"]],
    ]);
  });

  it("マスタにない艦（艦型が分からない）は最後の区切りに入る", () => {
    const result = tray({ sort: "class" });

    const last = result.groups.at(-1);
    expect(last?.entries.map((e) => e.ship.uid)).toEqual(["unknown"]);
    expect(shownUids(result).filter((uid) => uid === "unknown")).toHaveLength(1);
  });
});

describe("並び順：Lv", () => {
  it("「Lv 150 以上」「Lv 140 以上」のように 10 刻みで区切り、Lv の高い順に並ぶ（艦のいない区切りは出さない）", () => {
    const result = tray({ sort: "lv" }, { ships: knownShips });

    expect(compactGroups(result)).toEqual([
      ["Lv 150 以上", ["haruna", "tone"]],
      ["Lv 140 以上", ["myoukou", "hyuga"]],
      ["Lv 130 以上", ["ise", "zuiho"]],
      ["Lv 120 以上", ["taihou"]],
      ["Lv 110 以上", ["hamanami"]],
      ["Lv 100 以上", ["i401", "i168"]],
      ["Lv 90 以上", ["akashi", "akitsushima", "asashimo2", "hayasui"]],
      ["Lv 80 以上", ["akitsumaru", "yukikaze2", "taigei"]],
      ["Lv 70 以上", ["kashima"]],
      ["Lv 60 以上", ["shimushu"]],
    ]);
  });

  it("Lv 160 を超える艦は「Lv 170 以上」などの区切りに入る", () => {
    // 時雨改三・大和改二重は Lv175、雪風改二は Lv168
    const ships = [shipByUid("yukikaze"), shipByUid("shigure"), shipByUid("yamato")];

    const result = tray({ sort: "lv" }, { ships, assignments: {} });

    expect(result.groups.map((g) => [g.title, g.count])).toEqual([
      ["Lv 170 以上", 2],
      ["Lv 160 以上", 1],
    ]);
  });

  it("Lv 10 未満の艦は「Lv 1 以上」の区切り（キー lv-0）に入り、最後に並ぶ（「Lv 0 以上」とは書かない）", () => {
    // 準備：浜波改（Lv110）、Lv9 の時雨、マスタにない艦（Lv1）
    const lowShigure: OwnedShip = { uid: "low-shigure", shipId: 43, level: 9, luck: 10, sallyArea: 0 };
    const ships = [unknownShip, lowShigure, shipByUid("hamanami")];

    // 実行
    const result = tray({ sort: "lv" }, { ships, assignments: {} });

    // 検証
    expect(compactGroups(result)).toEqual([
      ["Lv 110 以上", ["hamanami"]],
      ["Lv 1 以上", ["low-shigure", "unknown"]],
    ]);
    expect(result.groups.at(-1)?.key).toBe("lv-0");
  });
});

describe("並び順：特効の強さ", () => {
  it("一番効く札ごとに「（札名）で効く」で区切り（定義の札の順）、最後に「特効なし」。艦のいない札の区切りは出さない", () => {
    const result = tray({ sort: "boost" }, { ships: knownShips });

    expect(result.groups.map((g) => g.title)).toEqual([
      "多号作戦部隊で効く",
      "連合艦隊で効く",
      "ウルシー攻撃部隊で効く",
      "第六艦隊で効く",
      "特効なし",
    ]);
    expect(new Set(groupUids(result, "多号作戦部隊で効く"))).toEqual(new Set(["akitsushima", "akashi"]));
    expect(new Set(groupUids(result, "連合艦隊で効く"))).toEqual(
      new Set(["yukikaze2", "asashimo2", "hamanami", "tone", "hyuga", "taigei", "myoukou", "kashima", "haruna", "ise", "zuiho"]),
    );
    expect(groupUids(result, "ウルシー攻撃部隊で効く")).toEqual(["hayasui"]);
    expect(groupUids(result, "第六艦隊で効く")).toEqual(["i168"]);
    expect(new Set(groupUids(result, "特効なし"))).toEqual(new Set(NO_BOOST_UIDS));
  });

  it("区切りの中は、その札でのスコアの高い順", () => {
    const result = tray({ sort: "boost" }, { ships: knownShips });

    const scores = groupUids(result, "連合艦隊で効く").map((uid) => scoreOf(uid, "rengo"));
    expect(scores).toEqual([110, 110, 110, 82, 82, 82, 82, 82, 82, 82, 81]);
  });

  it("スコアが丸めて 0 でも特効がある艦は「（札名）で効く」に入り、「特効なし」には入らない（hasBoost）", () => {
    const result = tray({ sort: "boost" }, { ships: knownShips, definition: definitionWithTinyBoost() });

    expect(groupUids(result, "第三十一戦隊で効く")).toEqual(["akitsumaru"]);
    expect(groupUids(result, "特効なし")).not.toContain("akitsumaru");
  });

  it("どの段階にも使われない札の区切りは出さない", () => {
    const result = tray({ sort: "boost" }, { ships: knownShips, definition: summer2026DefinitionWithExtraFudas });

    expect(result.groups.map((g) => g.title)).not.toContain("未使用の札で効く");
    expect(result.groups.at(-1)?.title).toBe("特効なし");
  });

  it("マスタにない艦は「特効なし」に入る", () => {
    const result = tray({ sort: "boost" });

    expect(groupUids(result, "特効なし")).toContain("unknown");
  });
});

describe("並び順：名前", () => {
  it("「名前順」の 1 区切りで、マスタの読みの五十音順に並ぶ", () => {
    const result = tray({ sort: "name" }, { ships: knownShips });

    expect(compactGroups(result)).toEqual([
      [
        "名前順",
        [
          "akashi", // あかし（明石改）
          "akitsushima", // あきつしま（秋津洲改）
          "akitsumaru", // あきつまる（あきつ丸改）
          "asashimo2", // あさしも（朝霜改二）
          "i168", // い168（伊168改）
          "i401", // い401（伊401改）
          "ise", // いせ（伊勢）
          "kashima", // かしま（鹿島改）
          "shimushu", // しむしゅ（占守改）
          "zuiho", // ずいほう（瑞鳳改二乙）
          "taigei", // たいげい（大鯨）
          "taihou", // たいほう（大鳳改）
          "tone", // とね（利根改二）
          "hamanami", // はまなみ（浜波改）
          "hayasui", // はやすい（速吸改）
          "haruna", // はるな（榛名改二）
          "hyuga", // ひゅうが（日向改二）
          "myoukou", // みょうこう（妙高改二）
          "yukikaze2", // ゆきかぜ（雪風改）
        ],
      ],
    ]);
  });

  it("同じ名前の艦（同名艦）は Lv の高い順", () => {
    // 朝霜改二が 2 隻（asashimo Lv140、asashimo2 Lv92）
    const result = tray({ sort: "name" }, { ships: knownShips, assignments: {} });

    const uids = shownUids(result);
    expect(uids.indexOf("asashimo")).toBeLessThan(uids.indexOf("asashimo2"));
  });

  it("条件に合う艦がいなければ「名前順」の区切りも出さない", () => {
    // 対照：艦がいれば「名前順」の区切りが出る
    expect(tray({ sort: "name" }).groups.map((g) => g.title)).toEqual(["名前順"]);

    const result = tray({ sort: "name", query: "該当する艦はいない" });

    expect(result.groups).toEqual([]);
  });
});

describe("どの並び順にも共通", () => {
  it.each(ALL_SORTS)("並び順 %s：見出しの隻数は区切りの艦の数と同じで、キーは重複せず、艦のいない区切りはない", (sort) => {
    const result = tray({ sort });

    expect(result.groups.length).toBeGreaterThan(0);
    for (const group of result.groups) {
      expect(group.count).toBe(group.entries.length);
      expect(group.count).toBeGreaterThan(0);
    }
    const keys = result.groups.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(ALL_SORTS)("並び順 %s：表示する艦は条件に合う控えの艦と同じで、1 隻が 2 つの区切りに出ることはない", (sort) => {
    const result = tray({ sort });

    const uids = shownUids(result);
    expect(uids).toHaveLength(20);
    expect(new Set(uids)).toEqual(new Set([...TRAY_KNOWN_UIDS, "unknown"]));
    expect(result.shownCount).toBe(20);
  });

  it("控えの各艦に、マスタで引いた情報と特効のまとめを持たせる（艦カードの表示に使う）", () => {
    const result = tray();

    const entry = result.groups.flatMap((g) => g.entries).find((e) => e.ship.uid === "yukikaze2");
    expect(entry?.ship).toEqual(shipByUid("yukikaze2"));
    expect(entry?.info).toMatchObject({ known: true, name: "雪風改" });
    expect(entry?.boost).toEqual(shipBoostSummary(def, { baseName: "雪風", nationality: "japan" }));
  });
});

describe("マスタにない艦（名前が分からない艦）", () => {
  it.each(ALL_SORTS)("並び順 %s でも止まらず、控えに 1 回だけ出る", (sort) => {
    const result = tray({ sort });

    const entries = result.groups.flatMap((g) => g.entries).filter((e) => e.ship.uid === "unknown");
    expect(entries).toHaveLength(1);
    expect(entries[0].info).toMatchObject({ known: false, name: "名前が分からない艦" });
    expect(entries[0].boost.effective).toEqual([]);
  });

  it("特効がないので、「特効のある艦だけ」が ON だと出ない（控えの総数には入る）", () => {
    const result = tray({ boostOnly: true });

    expect(shownUids(result)).not.toContain("unknown");
    expect(result.totalCount).toBe(20);
  });

  it("艦種が分からないので、ALL 以外の艦種タブには出ない", () => {
    expect(shownUids(tray({ tab: "all" }))).toContain("unknown"); // 対照：ALL には出る
    for (const tab of SHIP_TYPE_TABS_WITHOUT_ALL) {
      expect(shownUids(tray({ tab }))).not.toContain("unknown");
    }
  });

  it("並び順「艦型」では、最後の「艦型不明」の区切り（キー class-unknown）に入る", () => {
    const result = tray({ sort: "class" });

    expect(result.groups.at(-1)).toMatchObject({ key: "class-unknown", title: "艦型不明", count: 1 });
    expect(groupUids(result, "艦型不明")).toEqual(["unknown"]);
  });

  it("並び順「名前」では、Lv が高くても最後に並ぶ（読みの五十音順の艦の後ろ）", () => {
    // 準備：マスタにない艦を Lv の高い 1 隻と Lv1 の 1 隻にし、先頭に渡す
    const highUnknown: OwnedShip = { uid: "unknown-high", shipId: 99998, level: 175, luck: 10, sallyArea: 0 };
    const ships = [highUnknown, unknownShip, ...knownShips];

    // 実行
    const result = tray({ sort: "name" }, { ships });

    // 検証：マスタにない艦どうしは同点の順（Lv の高い順）
    expect(shownUids(result).slice(-2)).toEqual(["unknown-high", "unknown"]);
    expect(shownUids(result).slice(0, -2)).toHaveLength(TRAY_KNOWN_UIDS.length);
  });

  it.each<[string, TrayOptions["remodelStages"]]>([
    ["未改造", { unremodeled: false, intermediate: true, final: true }],
    ["中間改造", { unremodeled: true, intermediate: false, final: true }],
    ["最終改造", { unremodeled: true, intermediate: true, final: false }],
  ])("改造状態が分からないので、改造状態の「%s」を外しても消えない", (_label, remodelStages) => {
    const result = tray({ remodelStages });

    expect(shownUids(result)).toContain("unknown");
  });

  it("改造状態をすべて外すと、マスタにある艦は出なくなるが、マスタにない艦は残る", () => {
    const result = tray({ remodelStages: { unremodeled: false, intermediate: false, final: false } });

    expect(shownUids(result)).toEqual(["unknown"]);
    expect(result.shownCount).toBe(1);
    expect(result.totalCount).toBe(20);
  });
});

describe("同点のときの順（どの並び順でも）", () => {
  // 時雨改二（艦 ID 145・図鑑番号 1003）と時雨改三（961・1004）は、艦型（白露型）・読み（しぐれ）・特効（時雨）が同じで、
  // 図鑑番号だけが違う。同じ Lv にすると、どの並び順でも同じ区切りの中で同点になる
  const SHIGURE_KAI2 = 145;
  const SHIGURE_KAI3 = 961;
  const at99 = (uid: string, shipId: number): OwnedShip => ({ uid, shipId, level: 99, luck: 15, sallyArea: 0 });

  it.each(ALL_SORTS)("並び順 %s：同じ Lv なら図鑑番号の小さい順（個体 ID の順とは逆でも）", (sort) => {
    // 準備：個体 ID の順（a → b）と図鑑番号の順（b〔1003〕→ a〔1004〕）を逆にし、a を先に渡す
    const ships = [at99("a", SHIGURE_KAI3), at99("b", SHIGURE_KAI2)];

    // 実行
    const result = tray({ sort }, { ships, assignments: {} });

    // 検証
    expect(result.groups).toHaveLength(1);
    expect(shownUids(result)).toEqual(["b", "a"]);
  });

  it.each(ALL_SORTS)("並び順 %s：Lv も図鑑番号も同じなら個体 ID の順（渡した順によらない）", (sort) => {
    // 準備：同じ艦（時雨改二）・同じ Lv の 3 隻を、個体 ID の順と違う順に渡す
    const ships = [at99("c", SHIGURE_KAI2), at99("a", SHIGURE_KAI2), at99("b", SHIGURE_KAI2)];

    // 実行
    const result = tray({ sort }, { ships, assignments: {} });

    // 検証
    expect(shownUids(result)).toEqual(["a", "b", "c"]);
  });

  it.each(ALL_SORTS)("並び順 %s：個体 ID の数字の部分は数として比べる（取り込みの api_id。「99」は「100」より前）", (sort) => {
    const ships = [at99("100", SHIGURE_KAI2), at99("99", SHIGURE_KAI2)];

    const result = tray({ sort }, { ships, assignments: {} });

    expect(shownUids(result)).toEqual(["99", "100"]);
  });

  it("Lv が違えば、図鑑番号・個体 ID より Lv の高い順が先", () => {
    // 準備：図鑑番号・個体 ID が後ろの艦（z・時雨改三）の Lv を高くする
    const ships = [at99("a", SHIGURE_KAI2), { ...at99("z", SHIGURE_KAI3), level: 100 }];

    const result = tray({ sort: "name" }, { ships, assignments: {} });

    expect(shownUids(result)).toEqual(["z", "a"]);
  });
});
