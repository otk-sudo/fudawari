// 差分（計画と実際の札。要件 3.5、roadmap T2-11、U10・U17・U23）の判定と反映のテスト（PR-08 第 1 段）
//
// テスト用データ
// - 定義：summer2026Definition の札。札番号は s31（第三十一戦隊）=1、tago（多号作戦部隊）=2、rengo（連合艦隊）=3、
//   ulithi（ウルシー攻撃部隊）=4、sixth（第六艦隊）=5
// - 計画：summer2026Assignments（s31 4 隻、tago 3 隻、rengo 8 隻、ulithi 3 隻、sixth 1 隻。ほかは控え）
// - 実際の札：summer2026Ships（すべて札なし）を複製し、SCENARIO_AREAS の札番号を付ける（モック Drift.dc.html に近い例）
//
// 要件・決定事項に書かれていないため、このテストで決めたこと（報告して親の確認を受ける）
// - 対応が必要な一覧の各分類の中の並びは、取り込みデータの順
// - 札ごとの進み具合の「札付き」は、計画でその札に置いた艦のうち実際にその札が付いた隻数（計画にない艦に付いた札は数えない）
// - 割り当てにあっても取り込みデータにいない個体は数えない（進み具合の「計画」にも入れない）
// - 定義にない札 ID への割り当ては控えとして扱う（U17 に合わせる）
// - 「元に戻す」は直前の反映 1 回分で、反映で変えた艦だけを戻す（モックの undo が lastDone だけを戻すのに合わせる）
// - 定義にない札番号の扱い（末尾の describe「仮定（親の確認待ち）」に分けた）
import { describe, expect, it } from "vitest";
import type { Fuda } from "@/domain/definition/types";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import {
  cloneSummer2026Definition,
  shipByUid,
  summer2026Assignments,
  summer2026Definition,
  summer2026Ships,
  unknownShip,
} from "@/test/fixtures";
import { applyDriftEntries, computeDrift, undoDriftApply } from "./drift";
import type { DriftApplyResult, DriftEntry, DriftKind, DriftReport, DriftUndo } from "./types";

// ---- テスト用の値と補助 ----

const fudas: readonly Fuda[] = summer2026Definition.fudas;

/**
 * モックに近い例の実際の札（個体 ID → 札番号）。ここにない艦は札なし（0）
 * - 計画と違う札が付いた：長波改二（計画 連合艦隊 → 多号作戦部隊）、北上改二（計画 連合艦隊 → 第三十一戦隊）
 * - 計画にない艦に札が付いた：浜波改（→ 第三十一戦隊）、明石改（→ 多号作戦部隊）、伊168改（→ 第六艦隊）
 * - 計画どおり：初霜改二・冬月改（第三十一戦隊）、沖波改二（多号作戦部隊）、時雨改二・雪風改二（連合艦隊）、伊41改（第六艦隊）
 * - まだ出撃していない：計画にある残りの 11 隻
 */
const SCENARIO_AREAS: Readonly<Record<string, number>> = {
  naganami: 2,
  kitakami: 1,
  hamanami: 1,
  akashi: 2,
  i168: 5,
  hatsushimo: 1,
  fuyuzuki: 1,
  okinami: 2,
  shigure2: 3,
  yukikaze: 3,
  i41: 5,
};

/** モックの所持艦 31 隻を複製し、実際の札（札番号）を付ける。指定のない艦は札なし */
function shipsWithAreas(areas: Readonly<Record<string, number>>): OwnedShip[] {
  return summer2026Ships.map((s) => ({ ...s, sallyArea: areas[s.uid] ?? 0 }));
}

/** 個体 1 隻を複製し、実際の札を付ける */
function tagged(uid: string, sallyArea: number): OwnedShip {
  return { ...shipByUid(uid), sallyArea };
}

/** 件数のまとめを分類 → 件数の形にする */
function countsOf(report: DriftReport): Partial<Record<DriftKind, number>> {
  return Object.fromEntries(report.summary.map((item) => [item.kind, item.count]));
}

/** 個体 ID だけを取り出す */
function uidsOf(list: readonly { uid: string }[]): string[] {
  return list.map((item) => item.uid);
}

/** 差分の件を作る（反映のテスト用。computeDrift の結果に頼らずに作る） */
function driftEntry(
  uid: string,
  kind: DriftKind,
  plannedFudaId: string | null,
  actualFudaId: string | null,
  actualGameNumber: number,
): DriftEntry {
  return { uid, shipId: shipByUid(uid).shipId, kind, plannedFudaId, actualFudaId, actualGameNumber };
}

/** 反映したときの元に戻す記録を取り出す（ないときは、その理由で失敗させる） */
function requireUndo(result: DriftApplyResult): DriftUndo {
  expect(result.undo, "反映したので元に戻す記録がある").not.toBeNull();
  return result.undo as DriftUndo;
}

// 反映のテストで使う件
const naganamiToTago = driftEntry("naganami", "differentFuda", "rengo", "tago", 2);
const kitakamiToS31 = driftEntry("kitakami", "differentFuda", "rengo", "s31", 1);
const hamanamiToS31 = driftEntry("hamanami", "unplanned", null, "s31", 1);
const i168ToSixth = driftEntry("i168", "unplanned", null, "sixth", 5);
const hatsushimoAsPlanned = driftEntry("hatsushimo", "asPlanned", "s31", "s31", 1);
const ushioNotSortied = driftEntry("ushio", "notSortied", "rengo", null, 0);

// ---- computeDrift ----

describe("computeDrift（計画と実際の札を比べる）", () => {
  describe("4 つの分類の判定（要件 3.5）", () => {
    it("計画した札と同じ札番号の札が付いている艦は「計画どおり」", () => {
      // 準備：初霜改二を第三十一戦隊（札番号 1）に置き、実際にも 1 が付いている
      const input = { ships: [tagged("hatsushimo", 1)], assignments: { hatsushimo: "s31" }, fudas };

      // 実行
      const report = computeDrift(input);

      // 検証
      expect(report.entries).toEqual([
        {
          uid: "hatsushimo",
          shipId: 419,
          kind: "asPlanned",
          plannedFudaId: "s31",
          actualFudaId: "s31",
          actualGameNumber: 1,
        },
      ]);
    });

    it("計画した札と違う札が付いている艦は「計画と違う札が付いた」で、実際の札を定義の札に対応付ける", () => {
      // 準備：長波改二を連合艦隊（3）に置いたが、多号作戦部隊（2）が付いている
      const input = { ships: [tagged("naganami", 2)], assignments: { naganami: "rengo" }, fudas };

      const report = computeDrift(input);

      expect(report.entries).toEqual([
        {
          uid: "naganami",
          shipId: 543,
          kind: "differentFuda",
          plannedFudaId: "rengo",
          actualFudaId: "tago",
          actualGameNumber: 2,
        },
      ]);
    });

    it("計画で札に置いたが札が付いていない（0）艦は「まだ出撃していない」", () => {
      const input = { ships: [tagged("ushio", 0)], assignments: { ushio: "rengo" }, fudas };

      const report = computeDrift(input);

      expect(report.entries).toEqual([
        {
          uid: "ushio",
          shipId: 407,
          kind: "notSortied",
          plannedFudaId: "rengo",
          actualFudaId: null,
          actualGameNumber: 0,
        },
      ]);
    });

    it("控えの艦に札が付いていたら「計画にない艦に札が付いた」で、計画の札は null", () => {
      const input = { ships: [tagged("hamanami", 1)], assignments: {}, fudas };

      const report = computeDrift(input);

      expect(report.entries).toEqual([
        {
          uid: "hamanami",
          shipId: 558,
          kind: "unplanned",
          plannedFudaId: null,
          actualFudaId: "s31",
          actualGameNumber: 1,
        },
      ]);
    });

    it("控えで札も付いていない艦は、どの分類にも対象外にも入らない", () => {
      // 準備：浜波改は控えで札なし、長波改二は計画どおり
      const input = {
        ships: [tagged("hamanami", 0), tagged("naganami", 3)],
        assignments: { naganami: "rengo" },
        fudas,
      };

      const report = computeDrift(input);

      expect(uidsOf(report.entries)).toEqual(["naganami"]);
      expect(report.excluded).toEqual([]);
      expect(countsOf(report)).toEqual({ differentFuda: 0, unplanned: 0, asPlanned: 1, notSortied: 0 });
    });

    it("同名艦は個体ごとに判定する（朝霜改二の 2 隻を別々に分類する）", () => {
      // 準備：asashimo は多号作戦部隊に置いて 2 が付いた、asashimo2 は控えで 2 が付いた
      const input = {
        ships: [tagged("asashimo", 2), tagged("asashimo2", 2)],
        assignments: { asashimo: "tago" },
        fudas,
      };

      const report = computeDrift(input);

      expect(report.entries.map((e) => [e.uid, e.kind])).toEqual([
        ["asashimo", "asPlanned"],
        ["asashimo2", "unplanned"],
      ]);
    });

    it("艦船マスタにない艦も、個体として同じように分類する（艦 ID はそのまま返す）", () => {
      // 準備：マスタにない艦 2 隻（控えに札、計画どおり）
      const stray: OwnedShip = { ...unknownShip, uid: "unknown", sallyArea: 1 };
      const placed: OwnedShip = { ...unknownShip, uid: "unknown2", sallyArea: 4 };
      const input = { ships: [stray, placed], assignments: { unknown2: "ulithi" }, fudas };

      const report = computeDrift(input);

      expect(report.entries).toEqual([
        {
          uid: "unknown",
          shipId: 99999,
          kind: "unplanned",
          plannedFudaId: null,
          actualFudaId: "s31",
          actualGameNumber: 1,
        },
        {
          uid: "unknown2",
          shipId: 99999,
          kind: "asPlanned",
          plannedFudaId: "ulithi",
          actualFudaId: "ulithi",
          actualGameNumber: 4,
        },
      ]);
    });
  });

  describe("件数のまとめと並び順", () => {
    const scenario = () =>
      computeDrift({ ships: shipsWithAreas(SCENARIO_AREAS), assignments: summer2026Assignments, fudas });

    it("件数のまとめは、要件 3.5 の順と用語で 4 つ並び、分類ごとの件数を持つ", () => {
      const report = scenario();

      expect(report.summary).toEqual([
        { kind: "differentFuda", label: "計画と違う札が付いた", count: 2 },
        { kind: "unplanned", label: "計画にない艦に札が付いた", count: 3 },
        { kind: "asPlanned", label: "計画どおり", count: 6 },
        { kind: "notSortied", label: "まだ出撃していない", count: 11 },
      ]);
    });

    it("対応が必要な一覧は「計画と違う札が付いた」が先、「計画にない艦に札が付いた」が後で、各分類の中は取り込みデータの順", () => {
      const report = scenario();

      expect(uidsOf(report.issues)).toEqual(["naganami", "kitakami", "hamanami", "akashi", "i168"]);
      expect(report.issues.map((e) => e.kind)).toEqual([
        "differentFuda",
        "differentFuda",
        "unplanned",
        "unplanned",
        "unplanned",
      ]);
    });

    it("一覧の全件（entries）は、4 つの分類に入った艦を取り込みデータの順で持ち、控えで札なしの艦は含まない", () => {
      const report = scenario();

      expect(uidsOf(report.entries)).toEqual([
        "shigure",
        "shigure2",
        "yukikaze",
        "naganami",
        "okinami",
        "asashimo",
        "hatsushimo",
        "ushio",
        "fuyuzuki",
        "shiranui",
        "kasumi",
        "hamanami",
        "suzukaze",
        "isuzu",
        "kitakami",
        "yahagi",
        "yamato",
        "nagato",
        "zuikaku",
        "akashi",
        "i41",
        "i168",
      ]);
      expect(report.excluded).toEqual([]);
    });

    it("札ごとの進み具合は定義の札の順で、計画の隻数と、そのうち実際にその札が付いた隻数を持つ（計画にない艦の札は数えない）", () => {
      const report = scenario();

      // 第三十一戦隊：計画 4 隻のうち 初霜改二・冬月改 の 2 隻（計画にない浜波改、連合艦隊の計画の北上改二は数えない）
      // 多号作戦部隊：計画 3 隻のうち 沖波改二（長波改二・明石改は数えない）
      // 連合艦隊：計画 8 隻のうち 時雨改二・雪風改二
      // ウルシー攻撃部隊：計画 3 隻、札付きなし
      // 第六艦隊：計画 1 隻のうち 伊41改（計画にない伊168改は数えない）
      expect(report.progress).toEqual([
        { fudaId: "s31", planned: 4, tagged: 2 },
        { fudaId: "tago", planned: 3, tagged: 1 },
        { fudaId: "rengo", planned: 8, tagged: 2 },
        { fudaId: "ulithi", planned: 3, tagged: 0 },
        { fudaId: "sixth", planned: 1, tagged: 1 },
      ]);
    });
  });

  describe("札番号が未入力の札（U10：差分の対象外として表示する）", () => {
    /** 連合艦隊の札番号を未入力にした定義の札 */
    const fudasWithoutRengoNumber = (): Fuda[] => {
      const definition = cloneSummer2026Definition();
      const rengo = definition.fudas.find((f) => f.id === "rengo");
      if (rengo) rengo.gameNumber = null;
      return definition.fudas;
    };

    it("札番号が未入力の札に置いた艦は分類せず、実際の札に関わらず対象外（理由：計画の札に札番号がない）に入れる", () => {
      // 準備：連合艦隊の札番号を消す。連合艦隊の計画 8 隻（時雨改二・雪風改二は 3、長波改二は 2、北上改二は 1 が付いている）
      const input = {
        ships: shipsWithAreas(SCENARIO_AREAS),
        assignments: summer2026Assignments,
        fudas: fudasWithoutRengoNumber(),
      };

      const report = computeDrift(input);

      expect(report.excluded.map((e) => [e.uid, e.reason, e.plannedFudaId, e.actualGameNumber])).toEqual([
        ["shigure2", "plannedFudaWithoutNumber", "rengo", 3],
        ["yukikaze", "plannedFudaWithoutNumber", "rengo", 3],
        ["naganami", "plannedFudaWithoutNumber", "rengo", 2],
        ["ushio", "plannedFudaWithoutNumber", "rengo", 0],
        ["kitakami", "plannedFudaWithoutNumber", "rengo", 1],
        ["yahagi", "plannedFudaWithoutNumber", "rengo", 0],
        ["nagato", "plannedFudaWithoutNumber", "rengo", 0],
        ["zuikaku", "plannedFudaWithoutNumber", "rengo", 0],
      ]);
      // 連合艦隊の 8 隻を除いて数える
      expect(countsOf(report)).toEqual({ differentFuda: 0, unplanned: 3, asPlanned: 4, notSortied: 7 });
      expect(uidsOf(report.issues)).toEqual(["hamanami", "akashi", "i168"]);
    });

    it("札番号が未入力の札の進み具合は、計画の隻数だけを数え、札付きは比べられないので null", () => {
      const input = {
        ships: shipsWithAreas(SCENARIO_AREAS),
        assignments: summer2026Assignments,
        fudas: fudasWithoutRengoNumber(),
      };

      const report = computeDrift(input);

      expect(report.progress.find((p) => p.fudaId === "rengo")).toEqual({
        fudaId: "rengo",
        planned: 8,
        tagged: null,
      });
      expect(report.progress.map((p) => p.fudaId)).toEqual(["s31", "tago", "rengo", "ulithi", "sixth"]);
    });
  });

  describe("定義にない札 ID の割り当て・取り込みデータにいない個体", () => {
    it("定義にない札 ID への割り当ては控えとして扱う（U17）：札が付いていれば「計画にない艦に札が付いた」、なければ何も出さない", () => {
      // 準備：消えた札 deleted に置いたままの 2 隻。長波改二には 1 が付いている、浜波改は札なし
      const input = {
        ships: [tagged("naganami", 1), tagged("hamanami", 0)],
        assignments: { naganami: "deleted", hamanami: "deleted" },
        fudas,
      };

      const report = computeDrift(input);

      expect(report.entries).toEqual([
        {
          uid: "naganami",
          shipId: 543,
          kind: "unplanned",
          plannedFudaId: null,
          actualFudaId: "s31",
          actualGameNumber: 1,
        },
      ]);
      expect(report.excluded).toEqual([]);
    });

    it("割り当てにあっても取り込みデータにいない個体は、分類にも進み具合の「計画」にも数えない", () => {
      // 準備：ghost は割り当てにだけいる（解体した艦など）
      const input = {
        ships: [tagged("hatsushimo", 1)],
        assignments: { hatsushimo: "s31", ghost: "s31" },
        fudas,
      };

      const report = computeDrift(input);

      expect(uidsOf(report.entries)).toEqual(["hatsushimo"]);
      expect(report.progress.find((p) => p.fudaId === "s31")).toEqual({ fudaId: "s31", planned: 1, tagged: 1 });
    });
  });

  describe("データがないときも止まらない", () => {
    it("取り込みデータがない（0 隻）ときは、件数がすべて 0、一覧と対象外は空、進み具合は札ごとに 0 ／ 0", () => {
      // 準備：計画はあるが、取り込んだ艦がいない（「取り込んだ艦娘データを削除」の後など）
      const input = { ships: [], assignments: summer2026Assignments, fudas };

      const report = computeDrift(input);

      expect(report.summary).toEqual([
        { kind: "differentFuda", label: "計画と違う札が付いた", count: 0 },
        { kind: "unplanned", label: "計画にない艦に札が付いた", count: 0 },
        { kind: "asPlanned", label: "計画どおり", count: 0 },
        { kind: "notSortied", label: "まだ出撃していない", count: 0 },
      ]);
      expect(report.issues).toEqual([]);
      expect(report.entries).toEqual([]);
      expect(report.excluded).toEqual([]);
      expect(report.progress).toEqual([
        { fudaId: "s31", planned: 0, tagged: 0 },
        { fudaId: "tago", planned: 0, tagged: 0 },
        { fudaId: "rengo", planned: 0, tagged: 0 },
        { fudaId: "ulithi", planned: 0, tagged: 0 },
        { fudaId: "sixth", planned: 0, tagged: 0 },
      ]);
    });

    it("定義の札が空のときは、割り当てをすべて控えとして扱い、札の付いていない艦は何も出さず、進み具合は空", () => {
      // 準備：札が 1 つもない定義。所持艦はすべて札なし
      const input = { ships: summer2026Ships, assignments: summer2026Assignments, fudas: [] };

      const report = computeDrift(input);

      expect(countsOf(report)).toEqual({ differentFuda: 0, unplanned: 0, asPlanned: 0, notSortied: 0 });
      expect(report.issues).toEqual([]);
      expect(report.entries).toEqual([]);
      expect(report.excluded).toEqual([]);
      expect(report.progress).toEqual([]);
    });
  });

  it("渡した艦・割り当て・札を書き換えない（凍結した値でも例外を投げない）", () => {
    // 準備：入力をすべて凍結する
    const ships = Object.freeze(shipsWithAreas(SCENARIO_AREAS).map((s) => Object.freeze(s)));
    const before = JSON.stringify({ ships, summer2026Assignments, fudas });

    // 実行
    const report = computeDrift({ ships, assignments: summer2026Assignments, fudas });

    // 検証：結果が出て、入力は変わらない
    expect(countsOf(report)).toEqual({ differentFuda: 2, unplanned: 3, asPlanned: 6, notSortied: 11 });
    expect(JSON.stringify({ ships, summer2026Assignments, fudas })).toBe(before);
  });
});

// ---- applyDriftEntries ----

describe("applyDriftEntries（計画を実際に合わせる）", () => {
  const base: AssignmentMap = summer2026Assignments;

  it("1 件：「計画と違う札が付いた」艦を実際の札に置き換えた新しい割り当てを返し、元の割り当ては変えない", () => {
    // 実行：長波改二（計画 連合艦隊 → 実際 多号作戦部隊）を計画に反映する
    const result = applyDriftEntries(base, [naganamiToTago]);

    // 検証：長波改二だけが多号作戦部隊になり、連合艦隊の抜けた枠はほかの艦で埋めない
    expect(result.assignments).toStrictEqual({ ...base, naganami: "tago" });
    expect(result.applied).toEqual([naganamiToTago]);
    expect(base["naganami"]).toBe("rengo");
  });

  it("1 件：「計画にない艦に札が付いた」艦を、実際の札で計画に追加する（「計画に追加する」）", () => {
    const result = applyDriftEntries(base, [hamanamiToS31]);

    expect(result.assignments).toStrictEqual({ ...base, hamanami: "s31" });
    expect(result.applied).toEqual([hamanamiToS31]);
  });

  it("「計画どおり」「まだ出撃していない」の件は反映せず、割り当ても変えない（対応が必要な件だけを反映する）", () => {
    const result = applyDriftEntries(base, [hatsushimoAsPlanned, ushioNotSortied, naganamiToTago]);

    // 潮改二は「まだ出撃していない」でも計画（連合艦隊）から外さない
    expect(result.assignments).toStrictEqual({ ...base, naganami: "tago" });
    expect(result.applied).toEqual([naganamiToTago]);
  });

  it("反映するものがなければ、割り当ては同じ内容で、元に戻す記録は null", () => {
    const result = applyDriftEntries(base, []);

    expect(result.assignments).toStrictEqual({ ...base });
    expect(result.applied).toEqual([]);
    expect(result.undo).toBeNull();
  });

  it("まとめて：チェックした件だけを反映し、反映した件を渡した順に返す（「n 件を計画に反映しました（艦名・艦名）」に使う）", () => {
    // 準備：対応が必要な 4 件のうち、長波改二のチェックを外した
    const checked = [kitakamiToS31, hamanamiToS31, i168ToSixth];

    const result = applyDriftEntries(base, checked);

    expect(result.assignments).toStrictEqual({ ...base, kitakami: "s31", hamanami: "s31", i168: "sixth" });
    expect(uidsOf(result.applied)).toEqual(["kitakami", "hamanami", "i168"]);
  });

  it("まとめて：対応が必要な件をすべて反映して計算し直すと、対応が必要なものがなくなり、抜けた札の枠は空いたまま", () => {
    // 準備：モックに近い例で差分を求める
    const ships = shipsWithAreas(SCENARIO_AREAS);
    const first = computeDrift({ ships, assignments: base, fudas });
    expect(first.issues).toHaveLength(5);

    // 実行：対応が必要な 5 件をすべて反映して、計算し直す
    const result = applyDriftEntries(base, first.issues);
    const second = computeDrift({ ships, assignments: result.assignments, fudas });

    // 検証：5 件が計画どおりに移り、まだ出撃していない 11 隻はそのまま
    expect(second.issues).toEqual([]);
    expect(countsOf(second)).toEqual({ differentFuda: 0, unplanned: 0, asPlanned: 11, notSortied: 11 });
    // 連合艦隊は長波改二・北上改二が抜けて計画 6 隻（ほかの艦で埋めない）
    expect(second.progress.find((p) => p.fudaId === "rengo")).toEqual({ fudaId: "rengo", planned: 6, tagged: 2 });
  });

  it("凍結した割り当てを渡しても例外を投げず、渡した割り当ては変わらない", () => {
    const frozen: AssignmentMap = Object.freeze({ naganami: "rengo", ushio: "rengo" });

    const result = applyDriftEntries(frozen, [naganamiToTago, hamanamiToS31]);

    expect(result.assignments).toStrictEqual({ naganami: "tago", ushio: "rengo", hamanami: "s31" });
    expect(frozen).toStrictEqual({ naganami: "rengo", ushio: "rengo" });
  });
});

// ---- undoDriftApply ----

describe("undoDriftApply（反映を元に戻す。直前の反映 1 回分）", () => {
  const base: AssignmentMap = summer2026Assignments;

  it("1 件の反映を戻すと、反映前の割り当てに戻る（渡した割り当ては書き換えない）", () => {
    const applied = applyDriftEntries(base, [naganamiToTago]);
    const afterApply = Object.freeze({ ...applied.assignments });

    const restored = undoDriftApply(afterApply, requireUndo(applied));

    expect(restored).toStrictEqual({ ...base });
    expect(afterApply["naganami"]).toBe("tago");
  });

  it("計画に追加した艦を戻すと控えに戻る（割り当てのキーがなくなる）", () => {
    const applied = applyDriftEntries(base, [hamanamiToS31]);

    const restored = undoDriftApply(applied.assignments, requireUndo(applied));

    expect(restored).toStrictEqual({ ...base });
    expect(Object.hasOwn(restored, "hamanami")).toBe(false);
  });

  it("まとめての反映を戻すと、その反映で変えた艦がすべて戻る", () => {
    const applied = applyDriftEntries(base, [naganamiToTago, kitakamiToS31, hamanamiToS31, i168ToSixth]);

    const restored = undoDriftApply(applied.assignments, requireUndo(applied));

    expect(restored).toStrictEqual({ ...base });
  });

  it("2 回反映した後に直前（2 回目）の記録で戻すと、2 回目の分だけが戻り、1 回目の反映は残る", () => {
    // 準備：1 回目に長波改二、2 回目に浜波改を反映する
    const first = applyDriftEntries(base, [naganamiToTago]);
    const second = applyDriftEntries(first.assignments, [hamanamiToS31]);

    // 実行：直前の記録（2 回目）で戻す
    const restored = undoDriftApply(second.assignments, requireUndo(second));

    // 検証
    expect(restored).toStrictEqual({ ...base, naganami: "tago" });
  });

  it("戻すのは反映で変えた艦だけで、反映の後に変わったほかの艦の割り当ては今の値のまま", () => {
    // 準備：長波改二を反映した後、潮改二の割り当てが別に変わった
    const applied = applyDriftEntries(base, [naganamiToTago]);
    const changedAfter: AssignmentMap = { ...applied.assignments, ushio: "tago" };

    const restored = undoDriftApply(changedAfter, requireUndo(applied));

    expect(restored).toStrictEqual({ ...base, ushio: "tago" });
  });
});

// ---- 仮定（親の確認待ち）：定義のどの札番号にも当たらない札 ----
//
// 要件 3.5・U10 に定めがないため、次のように仮定した。親が別の扱いに決めたら、この describe だけを直す。
// - 計画した札（札番号あり）と違う番号が付いているのは確かなので、要件 3.5 の文言どおり「計画と違う札が付いた」にする。
//   実際の札 ID は null。反映すると控えに戻す（実際の札が正しいものとして、計画の札から外す。札が抜けた枠は空いたまま）
// - 控えの艦の場合は計画に追加できないため、対象外（理由：定義にない札番号）にする（多くは札番号が未入力の札と考えられる）
describe("仮定（親の確認待ち）：定義のどの札番号にも当たらない札", () => {
  it("計画した札（札番号あり）と違う、定義にない番号の札が付いた艦は「計画と違う札が付いた」で、実際の札 ID は null", () => {
    const input = { ships: [tagged("naganami", 9)], assignments: { naganami: "rengo" }, fudas };

    const report = computeDrift(input);

    expect(report.entries).toEqual([
      {
        uid: "naganami",
        shipId: 543,
        kind: "differentFuda",
        plannedFudaId: "rengo",
        actualFudaId: null,
        actualGameNumber: 9,
      },
    ]);
    expect(uidsOf(report.issues)).toEqual(["naganami"]);
  });

  it("控えの艦に定義にない番号の札が付いていたら、分類せず対象外（理由：定義にない札番号）に入れる", () => {
    const input = { ships: [tagged("hamanami", 9)], assignments: {}, fudas };

    const report = computeDrift(input);

    expect(report.entries).toEqual([]);
    expect(report.excluded).toEqual([
      { uid: "hamanami", shipId: 558, reason: "unknownGameNumber", plannedFudaId: null, actualGameNumber: 9 },
    ]);
  });

  it("定義にない番号の「計画と違う札が付いた」を反映すると控えに戻り、元に戻すと計画の札に戻る", () => {
    const entry = driftEntry("naganami", "differentFuda", "rengo", null, 9);

    const applied = applyDriftEntries(summer2026Assignments, [entry]);
    const restored = undoDriftApply(applied.assignments, requireUndo(applied));

    const { naganami: removed, ...withoutNaganami } = summer2026Assignments;
    expect(removed).toBe("rengo");
    expect(applied.assignments).toStrictEqual(withoutNaganami);
    expect(restored).toStrictEqual({ ...summer2026Assignments });
  });
});
