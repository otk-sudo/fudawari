import { describe, expect, it } from "vitest";
import type { BoostGroup, Fuda, Importance, PublicDefinition, Stage } from "@/domain/definition/types";
import { boostTargetOf, createShipMaster } from "@/domain/master/master";
import type { BoostNationality, Nationality } from "@/domain/nationality";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import {
  nationalityMasterEntries,
  nationalityShips,
  shipByUid,
  shipTypeMasterEntries,
  shipTypeShips,
  summer2026Assignments,
  summer2026Definition,
  summer2026DefinitionWithUsaBoost,
  summer2026DefinitionWithUsaDestroyerBoost,
  summer2026MasterEntries,
  summer2026Ships,
  unknownShip,
} from "@/test/fixtures";
import {
  countBoostedShipsByStage,
  fudaBoost,
  shipBoostSummary,
  stageLabel,
  stageMultiplier,
} from "./boost";
import type { BoostTarget, ShipBoostSummary } from "./types";

// ---- テストの補助 ----

const def = summer2026Definition;
const ALL_FUDAS = ["s31", "tago", "rengo", "ulithi", "sixth"];

/**
 * 艦種を問わないテストの艦の艦種の番号（どの艦種の選択肢にも入らない番号）。
 * 艦種の条件（shipTypes）を持たないグループは艦種を見ないので、v1・国籍のテストの結果は変わらない
 */
const ANY_SHIP_TYPE = 0;
/** 特効の照合の対象（艦名・国籍・艦種の番号。v1.1） */
const target = (baseName: string, nationality: Nationality, shipTypeId: number = ANY_SHIP_TYPE): BoostTarget => ({
  baseName,
  nationality,
  shipTypeId,
});
/** 日本の艦（v1 のテストの艦はすべて日本） */
const jp = (baseName: string): BoostTarget => target(baseName, "japan");

/** テスト用の定義から段階を取り出す */
function stageOf(stageId: string, definition: PublicDefinition = def): Stage {
  const stage = definition.stages.find((s) => s.id === stageId);
  if (!stage) throw new Error(`段階 ${stageId} がありません`);
  return stage;
}

/** 倍率の小数の誤差を落とす（定義の倍率は小数第 2 位までなので、第 4 位で丸めれば比べられる） */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** まとめを [札 ID, スコア, [段階 ID, 倍率][]] の形にして比べやすくする */
function compact(summary: ShipBoostSummary) {
  return {
    effective: summary.effective.map((f) => [
      f.fudaId,
      f.score,
      f.stages.map((s) => [s.stageId, round4(s.multiplier)]),
    ]),
    ineffective: summary.ineffectiveFudaIds,
  };
}

/** 小さな定義を組み立てる（掛け合わせ・同点などの、テスト用データにない場合を確かめる） */
function miniDefinition(fudas: Fuda[], stages: Stage[]): PublicDefinition {
  return {
    schemaVersion: 1,
    event: {
      id: "mini",
      name: "テスト",
      startAt: "2026-08-07T12:00:00+09:00",
      endAt: null,
      versionDate: "2026-08-04",
    },
    areas: [
      { id: "E1", name: "E1" },
      { id: "E2", name: "E2" },
    ],
    fudas,
    stages,
  };
}
const fuda = (id: string): Fuda => ({ id, name: `札${id}`, color: "#888888", gameNumber: null });
const group = (id: string, multiplier: number, shipNames: string[]): BoostGroup => ({
  id,
  name: id,
  multiplier,
  shipNames,
});
/** 国籍の条件を持つ特効グループ（v1.1） */
const nationalGroup = (
  id: string,
  multiplier: number,
  shipNames: string[],
  nationalities: BoostNationality[],
): BoostGroup => ({ id, name: id, multiplier, shipNames, nationalities });
const stage = (
  id: string,
  areaId: string,
  fudaId: string,
  importance: Importance,
  boosts: BoostGroup[],
): Stage => ({ id, areaId, name: id, fudaId, importance, boosts });

describe("stageMultiplier（艦 × 段階の倍率）", () => {
  it.each<[string, number]>([
    ["初霜", 1.27], // 連合艦隊C
    ["瑞鶴", 1.27], // 連合艦隊C
    ["時雨", 1.24], // 連合艦隊B
    ["雪風", 1.24], // 連合艦隊B
    ["長門", 1.18], // 連合艦隊A
  ])("E2 ゲージ3 で %s は ×%s（モックの倍率）", (baseName, expected) => {
    // 準備
    const e2g3 = stageOf("E2-3");

    // 実行・検証
    expect(stageMultiplier(e2g3, jp(baseName))).toBeCloseTo(expected, 10);
  });

  it("どのグループにも当てはまらない艦は 1", () => {
    expect(stageMultiplier(stageOf("E2-3"), jp("あきつ丸"))).toBe(1);
  });

  it("特効が未入力の段階では 1", () => {
    expect(stageMultiplier(stageOf("E3-G"), jp("初霜"))).toBe(1);
  });

  it("艦名が分からない艦（null）は 1", () => {
    expect(stageMultiplier(stageOf("E2-3"), null)).toBe(1);
  });

  it("艦名は完全に一致したときだけ当てはまる（「松」のグループは「松風」に効かない）", () => {
    const e2g3 = stageOf("E2-3");

    expect(stageMultiplier(e2g3, jp("松"))).toBeCloseTo(1.24, 10);
    expect(stageMultiplier(e2g3, jp("松風"))).toBe(1);
  });

  it("同じ段階で複数のグループに当てはまると、倍率を掛け合わせる（U12）", () => {
    // 準備：初霜は 2 つのグループに、雪風は 1 つに入っている
    const s = stage("S", "E1", "a", "hard", [
      group("g1", 1.27, ["初霜"]),
      group("g2", 1.1, ["初霜", "雪風"]),
    ]);

    // 実行・検証
    expect(stageMultiplier(s, jp("初霜"))).toBeCloseTo(1.27 * 1.1, 10);
    expect(stageMultiplier(s, jp("雪風"))).toBeCloseTo(1.1, 10);
    expect(stageMultiplier(s, jp("長波"))).toBe(1);
  });

  it("3 つのグループに当てはまると 3 つとも掛け合わせる", () => {
    const s = stage("S", "E1", "a", "normal", [
      group("g1", 1.1, ["時雨"]),
      group("g2", 1.2, ["時雨"]),
      group("g3", 1.05, ["時雨"]),
    ]);

    expect(stageMultiplier(s, jp("時雨"))).toBeCloseTo(1.1 * 1.2 * 1.05, 10);
  });
});

describe("fudaBoost（艦 × 札のスコア・特効の有無・最大倍率）", () => {
  it("初霜を連合艦隊に置くと +81（E2 ゲージ3〔難所〕の ×1.27 だけが効く：(1.27 − 1) × 100 × 3）", () => {
    // 実行
    const boost = fudaBoost(def, "rengo", jp("初霜"));

    // 検証
    expect(boost).toEqual({
      fudaId: "rengo",
      score: 81,
      stages: [{ stageId: "E2-3", multiplier: expect.closeTo(1.27, 10) }],
      hasBoost: true,
      maxMultiplier: expect.closeTo(1.27, 10),
    });
  });

  it.each<[string, string, number]>([
    // 重要（重み 2）と難所（重み 3）：(1.19 − 1) × 100 × 2 ＋ (1.24 − 1) × 100 × 3 = 38 ＋ 72
    ["時雨", "rengo", 110],
    // 普通（重み 1）が 3 段階：9 ＋ 8 ＋ 12（特効が未入力の E3 ギミックは足さない）
    ["初霜", "s31", 29],
    // 重要（重み 2）：(1.38 − 1) × 100 × 2
    ["伊41", "sixth", 76],
    // E3 ゲージ1 には利根がいないので、E3 ゲージ4〔難所〕の ×1.08 だけ：8 × 3
    ["利根", "ulithi", 24],
  ])("%s を %s に置いたときのスコアは %i（重みは 普通 1／重要 2／難所 3）", (baseName, fudaId, expected) => {
    expect(fudaBoost(def, fudaId, jp(baseName)).score).toBe(expected);
  });

  it("効く段階は定義の順に並び、効かない段階は入らない", () => {
    // 北上は第三十一戦隊の E1・E2 ギミック・E3 ゲージ2 輸送で効く（E3 ギミックは特効が未入力）
    const boost = fudaBoost(def, "s31", jp("北上"));

    expect(boost.stages.map((s) => [s.stageId, round4(s.multiplier)])).toEqual([
      ["E1-1", 1.21],
      ["E2-G", 1.16],
      ["E3-2", 1.16],
    ]);
  });

  it("効く段階は海域の順で、同じ海域の中は配列の中の前後の順に並ぶ（配列の末尾に足した E1 の段階は E1 の最後）", () => {
    // 準備：E2 の段階の後ろに、E1 の段階を 2 つ足した定義
    const mini = miniDefinition(
      [fuda("a")],
      [
        stage("x2", "E2", "a", "normal", [group("g2", 1.2, ["時雨"])]),
        stage("x1a", "E1", "a", "normal", [group("g1a", 1.1, ["時雨"])]),
        stage("x1b", "E1", "a", "normal", [group("g1b", 1.3, ["時雨"])]),
      ],
    );

    // 実行
    const boost = fudaBoost(mini, "a", jp("時雨"));

    // 検証
    expect(boost.stages.map((s) => s.stageId)).toEqual(["x1a", "x1b", "x2"]);
  });

  it("特効がない札は スコア 0・効く段階なし・特効なし・最大倍率 1（一覧のバッジは「–」）", () => {
    expect(fudaBoost(def, "s31", jp("涼風"))).toEqual({
      fudaId: "s31",
      score: 0,
      stages: [],
      hasBoost: false,
      maxMultiplier: 1,
    });
  });

  it.each<[string, string, number]>([
    ["時雨", "rengo", 1.24],
    ["潮", "rengo", 1.27],
    ["北上", "rengo", 1.18],
    ["冬月", "s31", 1.21],
    ["大和", "ulithi", 1.08],
  ])("%s の %s での最大倍率は ×%s（一覧のバッジ）", (baseName, fudaId, expected) => {
    const boost = fudaBoost(def, fudaId, jp(baseName));

    expect(boost.hasBoost).toBe(true);
    expect(boost.maxMultiplier).toBeCloseTo(expected, 10);
  });

  it("掛け合わせた倍率でスコアと最大倍率を求め、スコアは合計を整数に丸める", () => {
    // 準備：難所の段階で ×1.27 と ×1.10 の 2 グループに当てはまる
    const mini = miniDefinition(
      [fuda("a")],
      [stage("S", "E1", "a", "hard", [group("g1", 1.27, ["初霜"]), group("g2", 1.1, ["初霜"])])],
    );

    // 実行
    const boost = fudaBoost(mini, "a", jp("初霜"));

    // 検証：(1.27 × 1.1 − 1) × 100 × 3 = 119.1 → 119
    expect(boost.score).toBe(119);
    expect(boost.maxMultiplier).toBeCloseTo(1.397, 10);
  });

  it("定義にない札 ID なら特効なし（例外を投げない）", () => {
    expect(fudaBoost(def, "no-such-fuda", jp("初霜"))).toEqual({
      fudaId: "no-such-fuda",
      score: 0,
      stages: [],
      hasBoost: false,
      maxMultiplier: 1,
    });
  });

  it("艦名が分からない艦（null）はどの札でも特効なし", () => {
    for (const fudaId of ALL_FUDAS) {
      expect(fudaBoost(def, fudaId, null)).toMatchObject({ score: 0, hasBoost: false, stages: [] });
    }
  });
});

describe("shipBoostSummary（効く札をスコアの高い順に、効く段階と倍率、効かない札）", () => {
  it("初霜：連合艦隊 +81、第三十一戦隊 +29、多号作戦部隊 +24 の順。効かないのはウルシー攻撃部隊・第六艦隊", () => {
    // 実行
    const summary = shipBoostSummary(def, jp("初霜"));

    // 検証
    expect(compact(summary)).toEqual({
      effective: [
        ["rengo", 81, [["E2-3", 1.27]]],
        [
          "s31",
          29,
          [
            ["E1-1", 1.09],
            ["E2-G", 1.08],
            ["E3-2", 1.12],
          ],
        ],
        ["tago", 24, [["E2-1", 1.24]]],
      ],
      ineffective: ["ulithi", "sixth"],
    });
  });

  it("北上：連合艦隊 +82、第三十一戦隊 +53、ウルシー攻撃部隊 +32 の順", () => {
    expect(compact(shipBoostSummary(def, jp("北上")))).toEqual({
      effective: [
        [
          "rengo",
          82,
          [
            ["E2-2", 1.14],
            ["E2-3", 1.18],
          ],
        ],
        [
          "s31",
          53,
          [
            ["E1-1", 1.21],
            ["E2-G", 1.16],
            ["E3-2", 1.16],
          ],
        ],
        [
          "ulithi",
          32,
          [
            ["E3-1", 1.08],
            ["E3-4", 1.08],
          ],
        ],
      ],
      ineffective: ["tago", "sixth"],
    });
  });

  it("長波：4 つの札で効き、スコアの高い順（連合艦隊 110 → ウルシー攻撃部隊 56 → 第三十一戦隊 29 → 多号作戦部隊 24）", () => {
    const summary = shipBoostSummary(def, jp("長波"));

    expect(summary.effective.map((f) => [f.fudaId, f.score])).toEqual([
      ["rengo", 110],
      ["ulithi", 56],
      ["s31", 29],
      ["tago", 24],
    ]);
    expect(summary.ineffectiveFudaIds).toEqual(["sixth"]);
  });

  it("特効がない艦は、効く札なし・すべての札が定義の順で効かない札", () => {
    expect(shipBoostSummary(def, jp("あきつ丸"))).toEqual({ effective: [], ineffectiveFudaIds: ALL_FUDAS });
  });

  it("艦名が分からない艦（null）も、すべての札が効かない札", () => {
    expect(shipBoostSummary(def, null)).toEqual({ effective: [], ineffectiveFudaIds: ALL_FUDAS });
  });

  it("スコアが同点の札は定義の札の順に並ぶ（段階の並びには左右されない）", () => {
    // 準備：札 b の段階が先に並ぶが、札の順は a → b。どちらも +10
    const mini = miniDefinition(
      [fuda("a"), fuda("b"), fuda("c")],
      [
        stage("sb", "E1", "b", "normal", [group("gb", 1.1, ["テスト艦"])]),
        stage("sa", "E2", "a", "normal", [group("ga", 1.1, ["テスト艦"])]),
      ],
    );

    // 実行
    const summary = shipBoostSummary(mini, jp("テスト艦"));

    // 検証
    expect(summary.effective.map((f) => [f.fudaId, f.score])).toEqual([
      ["a", 10],
      ["b", 10],
    ]);
    expect(summary.ineffectiveFudaIds).toEqual(["c"]);
  });
});

describe("countBoostedShipsByStage（段階ごとの「特効 n 隻」）", () => {
  it("一覧のモックの割り当てで、段階ごとの特効の隻数がモックと同じになる", () => {
    // 準備
    const master = createShipMaster(summer2026MasterEntries);

    // 実行
    const counts = countBoostedShipsByStage(def, master, summer2026Ships, summer2026Assignments);

    // 検証（Main.dc.html の攻略の流れ。E3 ギミックは特効が未入力なので 0）
    expect(counts).toEqual({
      "E1-1": 3,
      "E2-G": 3,
      "E2-1": 3,
      "E2-2": 6,
      "E2-3": 8,
      "E3-G": 0,
      "E3-1": 3,
      "E3-2": 3,
      "E3-3": 1,
      "E3-4": 3,
    });
  });

  it("割り当てがなければ、すべての段階が 0", () => {
    const master = createShipMaster(summer2026MasterEntries);

    const counts = countBoostedShipsByStage(def, master, summer2026Ships, {});

    expect(counts).toEqual(Object.fromEntries(def.stages.map((s) => [s.id, 0])));
  });

  it("同名艦は別の個体として、それぞれ数える（朝霜改二 2 隻を多号作戦部隊に置くと 2 隻）", () => {
    const master = createShipMaster(summer2026MasterEntries);
    const assignments: AssignmentMap = { asashimo: "tago", asashimo2: "tago" };

    const counts = countBoostedShipsByStage(def, master, summer2026Ships, assignments);

    expect(counts["E2-1"]).toBe(2);
  });

  it("一覧にない個体・定義にない札への割り当てと、マスタにない艦は数えない", () => {
    // 準備：数えるのは 潮改二（連合艦隊。E2 ゲージ3 だけ特効あり）だけ
    const master = createShipMaster(summer2026MasterEntries);
    const ships = [...summer2026Ships, unknownShip];
    const assignments: AssignmentMap = {
      ghost: "rengo", // 一覧にない個体
      hatsushimo: "no-such-fuda", // 定義にない札
      [unknownShip.uid]: "rengo", // マスタにない艦
      ushio: "rengo",
    };

    // 実行
    const counts = countBoostedShipsByStage(def, master, ships, assignments);

    // 検証
    expect(counts).toEqual({
      ...Object.fromEntries(def.stages.map((s) => [s.id, 0])),
      "E2-3": 1,
    });
  });
});

describe("stageLabel（段階の表示名）", () => {
  it.each<[string, string]>([
    ["E2-3", "E2 ゲージ3"],
    ["E1-1", "E1 ギミック〜ゲージ3"],
    ["E3-2", "E3 ゲージ2 輸送"],
  ])("段階 %s の表示名は「%s」", (stageId, expected) => {
    expect(stageLabel(def, stageId)).toBe(expected);
  });

  // UI／UX レビュー 中6：本番の定義の段階名は「E1-1 第一ゲージ」のように海域名で始まり、前に海域を付けると「E1 E1-1 第一ゲージ」と
  // 二重に出る。段階名が海域名で始まり、その直後が区切り（- ・空白〔全角を含む〕・括弧〔全角・半角〕）か段階名の終わりなら、
  // 海域を前に付けない。それ以外は今のまま「海域名 段階名」
  describe("段階名が海域名で始まるとき（UI／UX レビュー 中6）", () => {
    /** 段階 E1-1（海域 E1）の段階名を name にした定義。areaName を渡すと海域 E1 の表示名も変える */
    function definitionWithStageName(name: string, areaName?: string): PublicDefinition {
      return {
        ...def,
        areas: def.areas.map((area) => (area.id === "E1" && areaName !== undefined ? { ...area, name: areaName } : area)),
        stages: def.stages.map((stage) => (stage.id === "E1-1" ? { ...stage, name } : stage)),
      };
    }

    it.each<[stageName: string, expected: string]>([
      ["E1-1 第一ゲージ", "E1-1 第一ゲージ"],
      ["E1-G", "E1-G"],
      ["E1 第一ゲージ", "E1 第一ゲージ"],
      ["E1　第一ゲージ", "E1　第一ゲージ"],
      ["E1（甲）第一ゲージ", "E1（甲）第一ゲージ"],
      ["E1(甲)第一ゲージ", "E1(甲)第一ゲージ"],
      ["E1", "E1"],
    ])("海域 E1 の段階名「%s」は海域を前に付けず「%s」", (stageName, expected) => {
      // 準備
      const definition = definitionWithStageName(stageName);

      // 実行・検証
      expect(stageLabel(definition, "E1-1")).toBe(expected);
    });

    it.each<[stageName: string, expected: string]>([
      ["第一ゲージ", "E1 第一ゲージ"],
      ["E10 ゲージ1", "E1 E10 ゲージ1"],
      ["E1ギミック", "E1 E1ギミック"],
      ["E2-1 輸送", "E1 E2-1 輸送"],
      ["ゲージ E1-1", "E1 ゲージ E1-1"],
    ])(
      "海域 E1 の段階名「%s」は海域名の直後が区切りでない（または海域名で始まらない）ので、今のまま「%s」",
      (stageName, expected) => {
        // 準備
        const definition = definitionWithStageName(stageName);

        // 実行・検証
        expect(stageLabel(definition, "E1-1")).toBe(expected);
      },
    );

    it.each<[areaName: string, stageName: string, expected: string]>([
      ["E.1", "E.1-1 ゲージ", "E.1-1 ゲージ"],
      ["E.1", "EX1-1 ゲージ", "E.1 EX1-1 ゲージ"],
      ["前段", "前段（輸送）", "前段（輸送）"],
      ["前段", "前段作戦", "前段 前段作戦"],
    ])("海域名「%s」の段階名「%s」は「%s」（海域名は文字どおりに比べる）", (areaName, stageName, expected) => {
      // 準備
      const definition = definitionWithStageName(stageName, areaName);

      // 実行・検証
      expect(stageLabel(definition, "E1-1")).toBe(expected);
    });
  });
});

describe("個体から（艦船マスタの改装段階を問わない艦名を通して）", () => {
  it("初霜改二の個体を連合艦隊に置くと +81", () => {
    // 準備
    const master = createShipMaster(summer2026MasterEntries);
    const hatsushimo = shipByUid("hatsushimo");

    // 実行
    const boost = fudaBoost(def, "rengo", boostTargetOf(master, hatsushimo.shipId));

    // 検証
    expect(boost.score).toBe(81);
  });

  it("艦名は改装段階を問わず一致する（時雨改二・時雨改三 は「時雨」のグループで ×1.24）", () => {
    const master = createShipMaster(summer2026MasterEntries);
    const e2g3 = stageOf("E2-3");

    for (const uid of ["shigure", "shigure2"]) {
      const ship = shipByUid(uid);
      expect(stageMultiplier(e2g3, boostTargetOf(master, ship.shipId))).toBeCloseTo(1.24, 10);
    }
  });

  it("マスタにない艦（名前が分からない艦）は、どの札でも特効なし", () => {
    const master = createShipMaster(summer2026MasterEntries);

    const summary = shipBoostSummary(def, boostTargetOf(master, unknownShip.shipId));

    expect(summary).toEqual({ effective: [], ineffectiveFudaIds: ALL_FUDAS });
  });

  it("割り振り画面のパネル（Assign.dc.html）の初霜改二：効く札の順と、効く段階の表示名", () => {
    // 準備
    const master = createShipMaster(summer2026MasterEntries);
    const summary = shipBoostSummary(def, boostTargetOf(master, shipByUid("hatsushimo").shipId));
    const fudaName = (id: string) => def.fudas.find((f) => f.id === id)?.name;

    // 実行：画面と同じ形（札名、スコア、効く段階の表示名と倍率）に並べる
    const blocks = summary.effective.map((f) => ({
      name: fudaName(f.fudaId),
      score: f.score,
      lines: f.stages.map((s) => `${stageLabel(def, s.stageId)} ×${s.multiplier.toFixed(2)}`),
    }));

    // 検証
    expect(blocks).toEqual([
      { name: "連合艦隊", score: 81, lines: ["E2 ゲージ3 ×1.27"] },
      {
        name: "第三十一戦隊",
        score: 29,
        lines: ["E1 ギミック〜ゲージ3 ×1.09", "E2 ギミック ×1.08", "E3 ゲージ2 輸送 ×1.12"],
      },
      { name: "多号作戦部隊", score: 24, lines: ["E2 ゲージ1 輸送 ×1.24"] },
    ]);
    expect(summary.ineffectiveFudaIds.map(fudaName)).toEqual(["ウルシー攻撃部隊", "第六艦隊"]);
  });

  it("一覧（Main.dc.html）の札ごとの行：隻数・特効の隻数・倍率のバッジがモックと同じ", () => {
    // 準備
    const master = createShipMaster(summer2026MasterEntries);

    // 実行：札ごとに、割り当てた艦の [艦名, その札での最大倍率（特効なしは "–"）] と特効の隻数を求める
    const rows = def.fudas.map((f) => {
      const members = summer2026Ships.filter((s) => summer2026Assignments[s.uid] === f.id);
      const boosts = members.map((s) => fudaBoost(def, f.id, boostTargetOf(master, s.shipId)));
      return {
        fudaId: f.id,
        count: members.length,
        boosted: boosts.filter((b) => b.hasBoost).length,
        badges: boosts.map((b) => (b.hasBoost ? `×${b.maxMultiplier.toFixed(2)}` : "–")),
      };
    });

    // 検証（並びは summer2026Ships の順）
    expect(rows).toEqual([
      { fudaId: "s31", count: 4, boosted: 3, badges: ["×1.12", "×1.21", "–", "×1.12"] },
      { fudaId: "tago", count: 3, boosted: 3, badges: ["×1.24", "×1.24", "×1.24"] },
      {
        fudaId: "rengo",
        count: 8,
        boosted: 8,
        badges: ["×1.24", "×1.24", "×1.24", "×1.27", "×1.18", "×1.18", "×1.18", "×1.27"],
      },
      { fudaId: "ulithi", count: 3, boosted: 3, badges: ["×1.14", "×1.14", "×1.08"] },
      { fudaId: "sixth", count: 1, boosted: 1, badges: ["×1.38"] },
    ]);
  });
});

// ---- 国籍の条件（v1.1「特効グループに国籍の条件を足す」の仕様 4 章） ----
// 「shipNames に艦の baseName がある、または nationalities に艦の国籍がある」グループが、その艦に効く。
// 1 つのグループは艦名と国籍の両方に当てはまっても倍率を 1 回だけ掛け、別のグループどうしは掛け合わせる（U12）。
// 国籍が unknown の艦は国籍の条件には当てはまらない（艦名の条件には当てはまる）。

describe("国籍の条件（v1.1）", () => {
  describe("stageMultiplier", () => {
    it("国籍の条件のグループは、その国籍の艦に効き、ほかの国籍の艦には効かない", () => {
      // 準備：艦名なし・国籍 アメリカ の ×1.2
      const s = stage("S", "E1", "a", "normal", [nationalGroup("us", 1.2, [], ["usa"])]);

      // 実行・検証
      expect(stageMultiplier(s, target("Iowa", "usa"))).toBeCloseTo(1.2, 10);
      expect(stageMultiplier(s, target("Samuel B.Roberts", "usa"))).toBeCloseTo(1.2, 10);
      expect(stageMultiplier(s, target("Warspite", "uk"))).toBe(1);
      expect(stageMultiplier(s, jp("時雨"))).toBe(1);
    });

    it("国籍を複数持つグループは、そのどれかの国籍の艦に効く", () => {
      const s = stage("S", "E1", "a", "normal", [nationalGroup("eu", 1.15, [], ["uk", "germany", "italy"])]);

      expect(stageMultiplier(s, target("Warspite", "uk"))).toBeCloseTo(1.15, 10);
      expect(stageMultiplier(s, target("Bismarck", "germany"))).toBeCloseTo(1.15, 10);
      expect(stageMultiplier(s, target("Iowa", "usa"))).toBe(1);
    });

    it("日本の国籍の条件は、日本の艦（v1 の艦）に効く", () => {
      const s = stage("S", "E1", "a", "normal", [nationalGroup("jp", 1.1, [], ["japan"])]);

      expect(stageMultiplier(s, jp("時雨"))).toBeCloseTo(1.1, 10);
      expect(stageMultiplier(s, target("Iowa", "usa"))).toBe(1);
    });

    it("1 つのグループで艦名と国籍の両方に当てはまっても、倍率は 1 回だけ掛ける（×1.2 であって ×1.44 ではない）", () => {
      const s = stage("S", "E1", "a", "hard", [nationalGroup("us", 1.2, ["Iowa"], ["usa"])]);

      expect(stageMultiplier(s, target("Iowa", "usa"))).toBeCloseTo(1.2, 10);
    });

    it("艦名と国籍の条件を持つグループは、艦名で当てはまる艦にも、国籍で当てはまる艦にも効く", () => {
      // 準備：艦名 Warspite（英）・国籍 アメリカ
      const s = stage("S", "E1", "a", "normal", [nationalGroup("mixed", 1.2, ["Warspite"], ["usa"])]);

      // 実行・検証
      expect(stageMultiplier(s, target("Warspite", "uk"))).toBeCloseTo(1.2, 10); // 艦名で
      expect(stageMultiplier(s, target("Johnston", "usa"))).toBeCloseTo(1.2, 10); // 国籍で
      expect(stageMultiplier(s, target("Ark Royal", "uk"))).toBe(1); // どちらでもない
    });

    it("別のグループどうしは、艦名のグループと国籍のグループでも掛け合わせる（U12）", () => {
      const s = stage("S", "E1", "a", "hard", [
        nationalGroup("us", 1.2, [], ["usa"]),
        group("iowa", 1.1, ["Iowa"]),
        nationalGroup("allies", 1.05, [], ["usa", "uk"]),
      ]);

      expect(stageMultiplier(s, target("Iowa", "usa"))).toBeCloseTo(1.2 * 1.1 * 1.05, 10);
      expect(stageMultiplier(s, target("Johnston", "usa"))).toBeCloseTo(1.2 * 1.05, 10);
      expect(stageMultiplier(s, target("Warspite", "uk"))).toBeCloseTo(1.05, 10);
    });

    // レビューの指摘（回帰）：艦名だけ A・両方 B・国籍だけ C が同じ段階にあるとき、B は 1 回だけ掛け、A・C とは掛け合わせる。
    // グループの並び（両方を持つ B が先頭・中・末尾）に左右されない
    describe("艦名だけ A ×1.1・艦名と国籍の両方 B ×1.2・国籍だけ C ×1.3 が同じ段階にあるとき", () => {
      const groupA = (): BoostGroup => group("A", 1.1, ["Iowa"]);
      const groupB = (): BoostGroup => nationalGroup("B", 1.2, ["Iowa"], ["usa"]);
      const groupC = (): BoostGroup => nationalGroup("C", 1.3, [], ["usa"]);

      it.each<[string, () => BoostGroup[]]>([
        ["A・B・C（共通の B が中）", () => [groupA(), groupB(), groupC()]],
        ["B・A・C（共通の B が先頭）", () => [groupB(), groupA(), groupC()]],
        ["B・C・A（共通の B が先頭）", () => [groupB(), groupC(), groupA()]],
        ["A・C・B（共通の B が末尾）", () => [groupA(), groupC(), groupB()]],
        ["C・A・B（共通の B が末尾）", () => [groupC(), groupA(), groupB()]],
        ["C・B・A（共通の B が中）", () => [groupC(), groupB(), groupA()]],
      ])("並び %s：艦名 A・B と国籍 B・C に当てはまる艦は 1.1 × 1.2 × 1.3（B は 1 回だけ）", (_label, boosts) => {
        // 準備
        const s = stage("S", "E1", "a", "hard", boosts());

        // 実行・検証
        expect(stageMultiplier(s, target("Iowa", "usa"))).toBeCloseTo(1.1 * 1.2 * 1.3, 10);
        // 艦名だけ当てはまる艦（国籍が違う）は A・B、国籍だけ当てはまる艦は B・C
        expect(stageMultiplier(s, target("Iowa", "uk"))).toBeCloseTo(1.1 * 1.2, 10);
        expect(stageMultiplier(s, target("Johnston", "usa"))).toBeCloseTo(1.2 * 1.3, 10);
        expect(stageMultiplier(s, target("Warspite", "uk"))).toBe(1);
      });

      it("札のスコアも、B を 1 回だけ掛けた倍率で求める（難所：(1.716 − 1) × 100 × 3 = 214.8 → 215）", () => {
        const mini = miniDefinition([fuda("a")], [stage("S", "E1", "a", "hard", [groupB(), groupA(), groupC()])]);

        const boost = fudaBoost(mini, "a", target("Iowa", "usa"));

        expect(boost.score).toBe(215);
        expect(boost.maxMultiplier).toBeCloseTo(1.716, 10);
      });
    });

    it("国籍が unknown の艦は国籍の条件には当てはまらないが、艦名の条件には当てはまる", () => {
      const s = stage("S", "E1", "a", "normal", [
        nationalGroup("us", 1.2, [], ["usa"]),
        group("named", 1.1, ["謎の艦"]),
      ]);

      expect(stageMultiplier(s, target("謎の艦", "unknown"))).toBeCloseTo(1.1, 10);
      expect(stageMultiplier(s, target("別の謎の艦", "unknown"))).toBe(1);
    });

    it("検証を通さない定義の国籍に unknown が入っていても、国籍が unknown の艦には効かない", () => {
      const s = stage("S", "E1", "a", "normal", [
        nationalGroup("broken", 1.2, [], ["unknown" as unknown as BoostNationality]),
      ]);

      expect(stageMultiplier(s, target("謎の艦", "unknown"))).toBe(1);
    });

    it("1 つのグループに同じ国籍が重複して書かれていても、そのグループの倍率は 1 回だけ掛ける", () => {
      const s = stage("S", "E1", "a", "normal", [nationalGroup("us", 1.2, [], ["usa", "usa"])]);

      expect(stageMultiplier(s, target("Iowa", "usa"))).toBeCloseTo(1.2, 10);
    });

    it("艦名と国籍は別々に照合する（艦名が「usa」の日本の艦は、国籍 アメリカ のグループに当てはまらない）", () => {
      const s = stage("S", "E1", "a", "normal", [
        nationalGroup("us", 1.2, [], ["usa"]),
        group("uk-name", 1.1, ["uk"]),
      ]);

      expect(stageMultiplier(s, target("usa", "japan"))).toBe(1);
      expect(stageMultiplier(s, target("Warspite", "uk"))).toBe(1);
      expect(stageMultiplier(s, target("uk", "japan"))).toBeCloseTo(1.1, 10);
    });

    it("同じ段階で、いろいろな艦を続けて照合しても結果は変わらない（段階ごとの索引を使い回しても正しい）", () => {
      const s = stage("S", "E1", "a", "normal", [
        nationalGroup("us", 1.2, ["Warspite"], ["usa"]),
        group("jp", 1.1, ["時雨"]),
      ]);
      const targets = [target("Iowa", "usa"), jp("時雨"), target("Warspite", "uk"), target("謎の艦", "unknown")];

      const first = targets.map((t) => stageMultiplier(s, t));
      const second = [...targets]
        .reverse()
        .map((t) => stageMultiplier(s, t))
        .reverse();

      expect(second).toEqual(first);
      expect(first.map(round4)).toEqual([1.2, 1.1, 1.2, 1]);
    });

    it("艦名も国籍もないグループは、どの艦にも効かない", () => {
      const s = stage("S", "E1", "a", "normal", [nationalGroup("empty", 1.5, [], [])]);

      expect(stageMultiplier(s, target("Iowa", "usa"))).toBe(1);
      expect(stageMultiplier(s, jp("時雨"))).toBe(1);
    });

    it("艦が分からない（null）なら、国籍の条件のグループがあっても 1", () => {
      const s = stage("S", "E1", "a", "normal", [nationalGroup("us", 1.2, [], ["usa"])]);

      expect(stageMultiplier(s, null)).toBe(1);
    });
  });

  describe("fudaBoost・shipBoostSummary（E2 ゲージ3〔連合艦隊・難所〕に「米艦」×1.20 を足した定義）", () => {
    const usaDef = summer2026DefinitionWithUsaBoost;

    it("米艦（Iowa）を連合艦隊に置くと +60（(1.20 − 1) × 100 × 3）、効く段階は E2 ゲージ3 ×1.20、最大倍率 ×1.20", () => {
      const boost = fudaBoost(usaDef, "rengo", target("Iowa", "usa"));

      expect(boost).toEqual({
        fudaId: "rengo",
        score: 60,
        stages: [{ stageId: "E2-3", multiplier: expect.closeTo(1.2, 10) }],
        hasBoost: true,
        maxMultiplier: expect.closeTo(1.2, 10),
      });
    });

    it("米艦のまとめ：効くのは連合艦隊 +60 だけ、ほかの札は効かない札（定義の順）", () => {
      expect(compact(shipBoostSummary(usaDef, target("Samuel B.Roberts", "usa")))).toEqual({
        effective: [["rengo", 60, [["E2-3", 1.2]]]],
        ineffective: ["s31", "tago", "ulithi", "sixth"],
      });
    });

    it("英艦・国籍の分からない艦は、どの札でも特効なし", () => {
      for (const t of [target("Warspite", "uk"), target("謎の艦", "unknown")]) {
        expect(shipBoostSummary(usaDef, t)).toEqual({ effective: [], ineffectiveFudaIds: ALL_FUDAS });
      }
    });

    it("日本の艦の特効は、米艦のグループを足しても変わらない（初霜は連合艦隊 +81 のまま）", () => {
      expect(compact(shipBoostSummary(usaDef, jp("初霜")))).toEqual(compact(shipBoostSummary(def, jp("初霜"))));
      expect(fudaBoost(usaDef, "rengo", jp("初霜")).score).toBe(81);
    });
  });

  describe("countBoostedShipsByStage（マスタの国籍で数える）", () => {
    const master = createShipMaster([...summer2026MasterEntries, ...nationalityMasterEntries]);
    const ships: readonly OwnedShip[] = [...summer2026Ships, ...nationalityShips];

    it("連合艦隊に米艦 2 隻・英艦・国籍の分からない艦を足すと、E2 ゲージ3 だけ米艦 2 隻が増える（8 → 10）", () => {
      // 準備
      const assignments: AssignmentMap = {
        ...summer2026Assignments,
        iowa: "rengo",
        sbr: "rengo",
        warspite: "rengo",
        mystery: "rengo",
      };

      // 実行
      const counts = countBoostedShipsByStage(summer2026DefinitionWithUsaBoost, master, ships, assignments);

      // 検証：ほかの段階はモックの数のまま
      expect(counts).toEqual({
        "E1-1": 3,
        "E2-G": 3,
        "E2-1": 3,
        "E2-2": 6,
        "E2-3": 10,
        "E3-G": 0,
        "E3-1": 3,
        "E3-2": 3,
        "E3-3": 1,
        "E3-4": 3,
      });
    });

    it("米艦を米艦のグループのない札（多号作戦部隊）に置いても数えない", () => {
      const assignments: AssignmentMap = { iowa: "tago" };

      const counts = countBoostedShipsByStage(summer2026DefinitionWithUsaBoost, master, ships, assignments);

      expect(Object.values(counts).every((count) => count === 0)).toBe(true);
    });
  });

  describe("個体から（boostTargetOf でマスタの艦名と国籍を引いて）", () => {
    const master = createShipMaster([...summer2026MasterEntries, ...nationalityMasterEntries]);
    const shipOf = (uid: string): OwnedShip => {
      const found = nationalityShips.find((s) => s.uid === uid);
      if (found === undefined) throw new Error(`個体 ${uid} がありません`);
      return found;
    };

    it("Iowa改の個体を連合艦隊に置くと +60（マスタの国籍 アメリカ で当てはまる）", () => {
      const boost = fudaBoost(summer2026DefinitionWithUsaBoost, "rengo", boostTargetOf(master, shipOf("iowa").shipId));

      expect(boost.score).toBe(60);
    });

    it("国籍の分からない艦（謎の艦）の個体は、艦名のグループには当てはまる", () => {
      // 準備：E2 ゲージ3 に艦名「謎の艦」のグループを足した定義
      const named: PublicDefinition = {
        ...summer2026DefinitionWithUsaBoost,
        stages: summer2026DefinitionWithUsaBoost.stages.map((s) =>
          s.id === "E2-3" ? { ...s, boosts: [...s.boosts, group("named", 1.1, ["謎の艦"])] } : s,
        ),
      };

      // 実行
      const boost = fudaBoost(named, "rengo", boostTargetOf(master, shipOf("mystery").shipId));

      // 検証：「米艦」には当てはまらず、艦名のグループの ×1.1 だけ
      expect(boost.stages.map((s) => [s.stageId, round4(s.multiplier)])).toEqual([["E2-3", 1.1]]);
    });
  });
});

describe("国籍の条件を艦種で絞る（v1.1。shipTypes）", () => {
  /** 艦種の番号（api_stype） */
  const DD = 2; // 駆逐艦
  const CL = 3; // 軽巡洋艦
  const BB = 9; // 戦艦
  const FBB = 8; // 戦艦（艦種 8）

  /** 国籍と艦種の条件を持つ特効グループ */
  const typedGroup = (
    id: string,
    multiplier: number,
    shipNames: string[],
    nationalities: BoostNationality[],
    shipTypes: number[],
  ): BoostGroup => ({ id, name: id, multiplier, shipNames, nationalities, shipTypes });

  /** よく使う艦 */
  const johnston = target("Johnston", "usa", DD); // 米駆逐
  const sbr = target("Samuel B.Roberts", "usa", DD); // 米駆逐
  const iowa = target("Iowa", "usa", BB); // 米戦艦
  const atlanta = target("Atlanta", "usa", CL); // 米軽巡
  const shigure = target("時雨", "japan", DD); // 日本の駆逐
  const warspite = target("Warspite", "uk", BB); // 英戦艦

  describe("stageMultiplier", () => {
    it("「アメリカ・駆逐 ×1.2」は米駆逐艦にだけ効き、米戦艦・米軽巡・日本の駆逐艦・英戦艦には効かない", () => {
      // 準備
      const s = stage("S", "E1", "a", "normal", [typedGroup("usdd", 1.2, [], ["usa"], [DD])]);

      // 実行・検証
      expect(stageMultiplier(s, johnston)).toBeCloseTo(1.2, 10);
      expect(stageMultiplier(s, sbr)).toBeCloseTo(1.2, 10);
      expect(stageMultiplier(s, iowa)).toBe(1);
      expect(stageMultiplier(s, atlanta)).toBe(1);
      expect(stageMultiplier(s, shigure)).toBe(1);
      expect(stageMultiplier(s, warspite)).toBe(1);
    });

    it("艦種を複数持つグループは、そのどれかの艦種の艦に効く（アメリカ・軽巡と駆逐）", () => {
      const s = stage("S", "E1", "a", "normal", [typedGroup("us-light", 1.15, [], ["usa"], [CL, DD])]);

      expect(stageMultiplier(s, atlanta)).toBeCloseTo(1.15, 10);
      expect(stageMultiplier(s, johnston)).toBeCloseTo(1.15, 10);
      expect(stageMultiplier(s, iowa)).toBe(1);
    });

    it("戦艦の選択肢（艦種 8・9）を持つグループは、艦種 8 と 9 の両方の艦に効く", () => {
      const s = stage("S", "E1", "a", "normal", [typedGroup("bb", 1.3, [], ["usa", "germany"], [FBB, BB])]);

      expect(stageMultiplier(s, iowa)).toBeCloseTo(1.3, 10);
      expect(stageMultiplier(s, target("Bismarck", "germany", FBB))).toBeCloseTo(1.3, 10);
      expect(stageMultiplier(s, johnston)).toBe(1);
    });

    it("国籍を複数持つグループの艦種は、どの国籍にも同じように効く（アメリカ・イギリスの戦艦）", () => {
      const s = stage("S", "E1", "a", "normal", [typedGroup("allied-bb", 1.2, [], ["usa", "uk"], [FBB, BB])]);

      expect(stageMultiplier(s, iowa)).toBeCloseTo(1.2, 10);
      expect(stageMultiplier(s, warspite)).toBeCloseTo(1.2, 10);
      expect(stageMultiplier(s, johnston)).toBe(1);
      expect(stageMultiplier(s, target("大和", "japan", BB))).toBe(1);
    });

    it("艦種が空の配列のグループは、選んだ国籍のすべての艦種に効く（艦種で絞らない）", () => {
      const s = stage("S", "E1", "a", "normal", [typedGroup("us-all", 1.1, [], ["usa"], [])]);

      for (const t of [johnston, iowa, atlanta]) {
        expect(stageMultiplier(s, t), t.baseName).toBeCloseTo(1.1, 10);
      }
      expect(stageMultiplier(s, shigure)).toBe(1);
    });

    it("艦名の条件は艦種で絞らない（艦名「Iowa」・アメリカ・駆逐のグループは、艦名で Iowa〔戦艦〕にも効く）", () => {
      const s = stage("S", "E1", "a", "normal", [typedGroup("mixed", 1.2, ["Iowa"], ["usa"], [DD])]);

      expect(stageMultiplier(s, iowa)).toBeCloseTo(1.2, 10); // 艦名で
      expect(stageMultiplier(s, johnston)).toBeCloseTo(1.2, 10); // 国籍と艦種で
      expect(stageMultiplier(s, atlanta)).toBe(1); // どちらでもない
    });

    it("1 つのグループで艦名と（国籍・艦種）の両方に当てはまっても、倍率は 1 回だけ掛ける（×1.2 であって ×1.44 ではない）", () => {
      const s = stage("S", "E1", "a", "hard", [typedGroup("johnston", 1.2, ["Johnston"], ["usa"], [DD])]);

      expect(stageMultiplier(s, johnston)).toBeCloseTo(1.2, 10);
    });

    it("別のグループどうしは掛け合わせる（アメリカ全体 ×1.1・アメリカ駆逐 ×1.2・艦名 Johnston ×1.05。U12）", () => {
      const s = stage("S", "E1", "a", "hard", [
        nationalGroup("us", 1.1, [], ["usa"]),
        typedGroup("usdd", 1.2, [], ["usa"], [DD]),
        group("johnston", 1.05, ["Johnston"]),
      ]);

      expect(stageMultiplier(s, johnston)).toBeCloseTo(1.1 * 1.2 * 1.05, 10);
      expect(stageMultiplier(s, sbr)).toBeCloseTo(1.1 * 1.2, 10);
      expect(stageMultiplier(s, iowa)).toBeCloseTo(1.1, 10);
      expect(stageMultiplier(s, shigure)).toBe(1);
    });

    it("同じ国籍で艦種ごとに倍率を分けたグループ（アメリカ・駆逐 ×1.2、アメリカ・戦艦 ×1.3）は、それぞれの艦種の艦にだけ効く", () => {
      const s = stage("S", "E1", "a", "normal", [
        typedGroup("usdd", 1.2, [], ["usa"], [DD]),
        typedGroup("usbb", 1.3, [], ["usa"], [FBB, BB]),
      ]);

      expect(stageMultiplier(s, johnston)).toBeCloseTo(1.2, 10);
      expect(stageMultiplier(s, iowa)).toBeCloseTo(1.3, 10);
      expect(stageMultiplier(s, atlanta)).toBe(1);
    });

    it("国籍が unknown の艦は、艦種が合っていても国籍・艦種の条件には当てはまらない（艦名の条件には当てはまる）", () => {
      const s = stage("S", "E1", "a", "normal", [
        typedGroup("usdd", 1.2, [], ["usa"], [DD]),
        group("named", 1.1, ["謎の艦"]),
      ]);

      expect(stageMultiplier(s, target("謎の艦", "unknown", DD))).toBeCloseTo(1.1, 10);
      expect(stageMultiplier(s, target("別の謎の艦", "unknown", DD))).toBe(1);
    });

    it("検証を通さない、国籍がなく艦種だけのグループは、どの艦にも国籍・艦種では当てはまらない", () => {
      const s = stage("S", "E1", "a", "normal", [
        typedGroup("dd-only", 1.2, [], [], [DD]),
        { id: "dd-only-omitted", name: "dd-only-omitted", multiplier: 1.3, shipNames: [], shipTypes: [DD] } as BoostGroup,
      ]);

      for (const t of [johnston, shigure, target("謎の艦", "unknown", DD)]) {
        expect(stageMultiplier(s, t), t.baseName).toBe(1);
      }
    });

    it("1 つのグループに同じ艦種が重複して書かれていても、そのグループの倍率は 1 回だけ掛ける", () => {
      const s = stage("S", "E1", "a", "normal", [typedGroup("usdd", 1.2, [], ["usa"], [DD, DD])]);

      expect(stageMultiplier(s, johnston)).toBeCloseTo(1.2, 10);
    });

    it("同じ段階で、国籍・艦種の違う艦を続けて照合しても結果は変わらない（段階ごとの索引を使い回しても正しい）", () => {
      // 準備：同じ国籍で艦種の違う艦、同じ艦種で国籍の違う艦を混ぜる
      const s = stage("S", "E1", "a", "normal", [
        typedGroup("usdd", 1.2, [], ["usa"], [DD]),
        typedGroup("ukbb", 1.3, [], ["uk"], [FBB, BB]),
        group("shigure", 1.1, ["時雨"]),
      ]);
      const targets = [johnston, iowa, shigure, warspite, sbr, atlanta, target("Ark Royal", "uk", 11)];

      // 実行
      const first = targets.map((t) => stageMultiplier(s, t));
      const second = [...targets]
        .reverse()
        .map((t) => stageMultiplier(s, t))
        .reverse();

      // 検証
      expect(second).toEqual(first);
      expect(first.map(round4)).toEqual([1.2, 1, 1.1, 1.3, 1.2, 1, 1]);
    });
  });

  describe("fudaBoost・shipBoostSummary（E2 ゲージ3〔連合艦隊・難所〕に「米駆逐」×1.20 を足した定義）", () => {
    const ddDef = summer2026DefinitionWithUsaDestroyerBoost;

    it("米駆逐艦（Johnston）を連合艦隊に置くと +60（(1.20 − 1) × 100 × 3）、効く段階は E2 ゲージ3 ×1.20、最大倍率 ×1.20", () => {
      const boost = fudaBoost(ddDef, "rengo", johnston);

      expect(boost).toEqual({
        fudaId: "rengo",
        score: 60,
        stages: [{ stageId: "E2-3", multiplier: expect.closeTo(1.2, 10) }],
        hasBoost: true,
        maxMultiplier: expect.closeTo(1.2, 10),
      });
    });

    it("米駆逐艦のまとめ：効くのは連合艦隊 +60 だけ、ほかの札は効かない札（定義の順）", () => {
      expect(compact(shipBoostSummary(ddDef, sbr))).toEqual({
        effective: [["rengo", 60, [["E2-3", 1.2]]]],
        ineffective: ["s31", "tago", "ulithi", "sixth"],
      });
    });

    it("米戦艦（Iowa）・英戦艦・国籍の分からない駆逐艦は、どの札でも特効なし", () => {
      for (const t of [iowa, warspite, target("謎の艦", "unknown", DD)]) {
        expect(shipBoostSummary(ddDef, t), t.baseName).toEqual({ effective: [], ineffectiveFudaIds: ALL_FUDAS });
      }
    });

    it("日本の駆逐艦の特効は、米駆逐のグループを足しても変わらない（時雨は E2 ゲージ3 ×1.24 のまま）", () => {
      expect(compact(shipBoostSummary(ddDef, shigure))).toEqual(compact(shipBoostSummary(def, shigure)));
      const rengo = fudaBoost(ddDef, "rengo", shigure);
      expect(rengo.stages.find((s) => s.stageId === "E2-3")?.multiplier).toBeCloseTo(1.24, 10);
    });
  });

  describe("countBoostedShipsByStage（マスタの国籍と艦種で数える）", () => {
    const master = createShipMaster([...summer2026MasterEntries, ...nationalityMasterEntries, ...shipTypeMasterEntries]);
    const ships: readonly OwnedShip[] = [...summer2026Ships, ...nationalityShips, ...shipTypeShips];

    it("連合艦隊に米駆逐 2 隻・米戦艦・英艦・国籍の分からない駆逐艦を足すと、E2 ゲージ3 だけ米駆逐 2 隻が増える（8 → 10）", () => {
      // 準備
      const assignments: AssignmentMap = {
        ...summer2026Assignments,
        johnston: "rengo",
        sbr: "rengo",
        iowa: "rengo",
        warspite: "rengo",
        mystery: "rengo",
      };

      // 実行
      const counts = countBoostedShipsByStage(summer2026DefinitionWithUsaDestroyerBoost, master, ships, assignments);

      // 検証：ほかの段階はモックの数のまま
      expect(counts).toEqual({
        "E1-1": 3,
        "E2-G": 3,
        "E2-1": 3,
        "E2-2": 6,
        "E2-3": 10,
        "E3-G": 0,
        "E3-1": 3,
        "E3-2": 3,
        "E3-3": 1,
        "E3-4": 3,
      });
    });

    it("米戦艦（Iowa改）だけを連合艦隊に置いても数えない", () => {
      const counts = countBoostedShipsByStage(summer2026DefinitionWithUsaDestroyerBoost, master, ships, { iowa: "rengo" });

      expect(Object.values(counts).every((count) => count === 0)).toBe(true);
    });
  });

  describe("個体から（boostTargetOf でマスタの艦名・国籍・艦種を引いて）", () => {
    const master = createShipMaster([...summer2026MasterEntries, ...nationalityMasterEntries, ...shipTypeMasterEntries]);
    const shipOf = (uid: string): OwnedShip => {
      const found = [...nationalityShips, ...shipTypeShips].find((s) => s.uid === uid);
      if (found === undefined) throw new Error(`個体 ${uid} がありません`);
      return found;
    };

    it("Johnston改の個体を連合艦隊に置くと +60、Iowa改の個体は特効なし（マスタの艦種で絞る）", () => {
      const ddDef = summer2026DefinitionWithUsaDestroyerBoost;

      expect(fudaBoost(ddDef, "rengo", boostTargetOf(master, shipOf("johnston").shipId)).score).toBe(60);
      expect(fudaBoost(ddDef, "rengo", boostTargetOf(master, shipOf("iowa").shipId)).hasBoost).toBe(false);
    });
  });
});
