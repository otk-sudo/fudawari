import { describe, expect, it } from "vitest";
import type { BoostGroup, Fuda, Importance, PublicDefinition, Stage } from "@/domain/definition/types";
import { baseNameOf, createShipMaster } from "@/domain/master/master";
import type { AssignmentMap } from "@/domain/plan/types";
import {
  shipByUid,
  summer2026Assignments,
  summer2026Definition,
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
import type { ShipBoostSummary } from "./types";

// ---- テストの補助 ----

const def = summer2026Definition;
const ALL_FUDAS = ["s31", "tago", "rengo", "ulithi", "sixth"];

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
    expect(stageMultiplier(e2g3, baseName)).toBeCloseTo(expected, 10);
  });

  it("どのグループにも当てはまらない艦は 1", () => {
    expect(stageMultiplier(stageOf("E2-3"), "あきつ丸")).toBe(1);
  });

  it("特効が未入力の段階では 1", () => {
    expect(stageMultiplier(stageOf("E3-G"), "初霜")).toBe(1);
  });

  it("艦名が分からない艦（null）は 1", () => {
    expect(stageMultiplier(stageOf("E2-3"), null)).toBe(1);
  });

  it("艦名は完全に一致したときだけ当てはまる（「松」のグループは「松風」に効かない）", () => {
    const e2g3 = stageOf("E2-3");

    expect(stageMultiplier(e2g3, "松")).toBeCloseTo(1.24, 10);
    expect(stageMultiplier(e2g3, "松風")).toBe(1);
  });

  it("同じ段階で複数のグループに当てはまると、倍率を掛け合わせる（U12）", () => {
    // 準備：初霜は 2 つのグループに、雪風は 1 つに入っている
    const s = stage("S", "E1", "a", "hard", [
      group("g1", 1.27, ["初霜"]),
      group("g2", 1.1, ["初霜", "雪風"]),
    ]);

    // 実行・検証
    expect(stageMultiplier(s, "初霜")).toBeCloseTo(1.27 * 1.1, 10);
    expect(stageMultiplier(s, "雪風")).toBeCloseTo(1.1, 10);
    expect(stageMultiplier(s, "長波")).toBe(1);
  });

  it("3 つのグループに当てはまると 3 つとも掛け合わせる", () => {
    const s = stage("S", "E1", "a", "normal", [
      group("g1", 1.1, ["時雨"]),
      group("g2", 1.2, ["時雨"]),
      group("g3", 1.05, ["時雨"]),
    ]);

    expect(stageMultiplier(s, "時雨")).toBeCloseTo(1.1 * 1.2 * 1.05, 10);
  });
});

describe("fudaBoost（艦 × 札のスコア・特効の有無・最大倍率）", () => {
  it("初霜を連合艦隊に置くと +81（E2 ゲージ3〔難所〕の ×1.27 だけが効く：(1.27 − 1) × 100 × 3）", () => {
    // 実行
    const boost = fudaBoost(def, "rengo", "初霜");

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
    expect(fudaBoost(def, fudaId, baseName).score).toBe(expected);
  });

  it("効く段階は定義の順に並び、効かない段階は入らない", () => {
    // 北上は第三十一戦隊の E1・E2 ギミック・E3 ゲージ2 輸送で効く（E3 ギミックは特効が未入力）
    const boost = fudaBoost(def, "s31", "北上");

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
    const boost = fudaBoost(mini, "a", "時雨");

    // 検証
    expect(boost.stages.map((s) => s.stageId)).toEqual(["x1a", "x1b", "x2"]);
  });

  it("特効がない札は スコア 0・効く段階なし・特効なし・最大倍率 1（一覧のバッジは「–」）", () => {
    expect(fudaBoost(def, "s31", "涼風")).toEqual({
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
    const boost = fudaBoost(def, fudaId, baseName);

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
    const boost = fudaBoost(mini, "a", "初霜");

    // 検証：(1.27 × 1.1 − 1) × 100 × 3 = 119.1 → 119
    expect(boost.score).toBe(119);
    expect(boost.maxMultiplier).toBeCloseTo(1.397, 10);
  });

  it("定義にない札 ID なら特効なし（例外を投げない）", () => {
    expect(fudaBoost(def, "no-such-fuda", "初霜")).toEqual({
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
    const summary = shipBoostSummary(def, "初霜");

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
    expect(compact(shipBoostSummary(def, "北上"))).toEqual({
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
    const summary = shipBoostSummary(def, "長波");

    expect(summary.effective.map((f) => [f.fudaId, f.score])).toEqual([
      ["rengo", 110],
      ["ulithi", 56],
      ["s31", 29],
      ["tago", 24],
    ]);
    expect(summary.ineffectiveFudaIds).toEqual(["sixth"]);
  });

  it("特効がない艦は、効く札なし・すべての札が定義の順で効かない札", () => {
    expect(shipBoostSummary(def, "あきつ丸")).toEqual({ effective: [], ineffectiveFudaIds: ALL_FUDAS });
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
    const summary = shipBoostSummary(mini, "テスト艦");

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
});

describe("個体から（艦船マスタの改装段階を問わない艦名を通して）", () => {
  it("初霜改二の個体を連合艦隊に置くと +81", () => {
    // 準備
    const master = createShipMaster(summer2026MasterEntries);
    const hatsushimo = shipByUid("hatsushimo");

    // 実行
    const boost = fudaBoost(def, "rengo", baseNameOf(master, hatsushimo.shipId));

    // 検証
    expect(boost.score).toBe(81);
  });

  it("艦名は改装段階を問わず一致する（時雨改二・時雨改三 は「時雨」のグループで ×1.24）", () => {
    const master = createShipMaster(summer2026MasterEntries);
    const e2g3 = stageOf("E2-3");

    for (const uid of ["shigure", "shigure2"]) {
      const ship = shipByUid(uid);
      expect(stageMultiplier(e2g3, baseNameOf(master, ship.shipId))).toBeCloseTo(1.24, 10);
    }
  });

  it("マスタにない艦（名前が分からない艦）は、どの札でも特効なし", () => {
    const master = createShipMaster(summer2026MasterEntries);

    const summary = shipBoostSummary(def, baseNameOf(master, unknownShip.shipId));

    expect(summary).toEqual({ effective: [], ineffectiveFudaIds: ALL_FUDAS });
  });

  it("割り振り画面のパネル（Assign.dc.html）の初霜改二：効く札の順と、効く段階の表示名", () => {
    // 準備
    const master = createShipMaster(summer2026MasterEntries);
    const summary = shipBoostSummary(def, baseNameOf(master, shipByUid("hatsushimo").shipId));
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
      const boosts = members.map((s) => fudaBoost(def, f.id, baseNameOf(master, s.shipId)));
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
