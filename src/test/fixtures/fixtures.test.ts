// 共通のテスト用データそのものの点検（データの書き間違いを見つける）。
// ドメインの関数は使わない（実装がなくても通る）。定義が検証を通ることは src/domain/definition/validate.test.ts で確かめる。
import { describe, expect, it } from "vitest";
import {
  cloneSummer2026Definition,
  createBulkShips,
  summer2026Assignments,
  summer2026Definition,
  summer2026MasterEntries,
  summer2026Ships,
  unknownShip,
} from "./index";

const masterIds = new Set(summer2026MasterEntries.map((e) => e.id));

describe("テスト用データの点検", () => {
  it("2026夏イベの定義：ID が重複せず、段階が参照する海域・札がある", () => {
    const d = summer2026Definition;
    const areaIds = d.areas.map((a) => a.id);
    const fudaIds = d.fudas.map((f) => f.id);
    const stageIds = d.stages.map((s) => s.id);
    const groupIds = d.stages.flatMap((s) => s.boosts.map((b) => b.id));

    for (const ids of [areaIds, fudaIds, stageIds, groupIds]) {
      expect(new Set(ids).size).toBe(ids.length);
    }
    for (const s of d.stages) {
      expect(areaIds).toContain(s.areaId);
      expect(fudaIds).toContain(s.fudaId);
    }
  });

  it("2026夏イベの定義：段階・札・大事さがモック（PlanEditor.dc.html）どおり", () => {
    expect(
      summer2026Definition.stages.map((s) => [s.areaId, s.name, s.fudaId, s.importance]),
    ).toEqual([
      ["E1", "ギミック〜ゲージ3", "s31", "normal"],
      ["E2", "ギミック", "s31", "normal"],
      ["E2", "ゲージ1 輸送", "tago", "normal"],
      ["E2", "ゲージ2", "rengo", "important"],
      ["E2", "ゲージ3", "rengo", "hard"],
      ["E3", "ギミック", "s31", "normal"],
      ["E3", "ゲージ1", "ulithi", "normal"],
      ["E3", "ゲージ2 輸送", "s31", "normal"],
      ["E3", "ゲージ3", "sixth", "important"],
      ["E3", "ゲージ4", "ulithi", "hard"],
    ]);
  });

  it("共有のデータは凍結されていて、複製は書き換えられる", () => {
    const copy = cloneSummer2026Definition();
    copy.stages[0].name = "書き換え";

    expect(Object.isFrozen(summer2026Definition.stages[0])).toBe(true);
    expect(summer2026Definition.stages[0].name).toBe("ギミック〜ゲージ3");
    expect(Object.isFrozen(summer2026Ships[0])).toBe(true);
  });

  it("定義の複製は、型（Mutable）でも実行時でも、入れ子の配列まで書き換えられる", () => {
    // 準備
    const copy = cloneSummer2026Definition();

    // 実行：公開定義の型は読み取り専用だが、複製は書き換えられる型なので型の誤りにならない
    copy.areas.push({ id: "E4", name: "E4" });
    copy.stages[0].boosts[0].shipNames.push("時雨");
    copy.stages[0].boosts[0].multiplier = 2;

    // 検証：複製だけが変わり、共有のデータは変わらない
    expect(copy.areas.map((a) => a.id)).toEqual(["E1", "E2", "E3", "E4"]);
    expect(copy.stages[0].boosts[0].shipNames).toContain("時雨");
    expect(copy.stages[0].boosts[0].multiplier).toBe(2);
    expect(summer2026Definition.areas).toHaveLength(3);
    expect(summer2026Definition.stages[0].boosts[0].shipNames).not.toContain("時雨");
  });

  it("仮マスタ：艦 ID が重複しない", () => {
    expect(masterIds.size).toBe(summer2026MasterEntries.length);
  });

  it("所持艦：個体 ID が重複せず、艦 ID はすべて仮マスタにある。同名艦（朝霜改二）が 2 隻いる", () => {
    const uids = summer2026Ships.map((s) => s.uid);

    expect(new Set(uids).size).toBe(uids.length);
    expect(summer2026Ships.every((s) => masterIds.has(s.shipId))).toBe(true);
    expect(summer2026Ships.filter((s) => s.shipId === 578)).toHaveLength(2);
    expect(masterIds.has(unknownShip.shipId)).toBe(false);
  });

  it("割り当て：所持艦の個体と、定義の札だけを参照する", () => {
    const uids = summer2026Ships.map((s) => s.uid);
    const fudaIds = summer2026Definition.fudas.map((f) => f.id);

    // 割り当ての値の型は「キーがないことがある」ため string | undefined になる。toContain なら絞り込まずに比べられる
    for (const [uid, fudaId] of Object.entries(summer2026Assignments)) {
      expect(uids).toContain(uid);
      expect(fudaIds).toContain(fudaId);
    }
  });

  it("createBulkShips：既定で 600 隻、個体 ID は重複せず、艦 ID は仮マスタにあり、毎回同じ内容", () => {
    const ships = createBulkShips();

    expect(ships).toHaveLength(600);
    expect(new Set(ships.map((s) => s.uid)).size).toBe(600);
    expect(ships.every((s) => masterIds.has(s.shipId))).toBe(true);
    expect(ships.every((s) => s.level >= 1 && s.level <= 185)).toBe(true);
    expect(createBulkShips()).toEqual(ships);
    expect(createBulkShips(1000)).toHaveLength(1000);
  });
});
