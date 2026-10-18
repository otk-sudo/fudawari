// 保存の記録の文と、未公開の変更の一覧（要件 3.7「保存の記録」、roadmap T3-8・T3-10）のテスト
// before はテスト用データ（2026夏イベ）、after はそれを複製して直接書き換えて作る。
import { describe, expect, it } from "vitest";
import type { DefinitionDoc } from "@/domain/definition-edit/types";
import {
  editDoc,
  fudaOf,
  groupOf,
  insertStageInto,
  makeStage,
  removeStageFrom,
  stageOf,
} from "@/domain/definition-edit/test-helpers";
import { summer2026Definition } from "@/test/fixtures";
import { describeChanges, summarizeSave } from "./changes";

const before = summer2026Definition;

const importanceChanged = editDoc(before, (d) => {
  stageOf(d, "E2-3").importance = "important";
});

const IMPORTANCE_TEXT = "E2 ゲージ3 の大事さを「難所」→「重要」";

describe("describeChanges（変更ごとの文と海域）", () => {
  it("変更がなければ空", () => {
    expect(describeChanges(before, before)).toEqual([]);
  });

  it("段階の大事さ：「E2 ゲージ3 の大事さを「難所」→「重要」」、海域 E2", () => {
    expect(describeChanges(before, importanceChanged)).toEqual([
      {
        location: { kind: "stage", stageId: "E2-3", field: "importance" },
        change: "modified",
        text: IMPORTANCE_TEXT,
        areaIds: ["E2"],
      },
    ]);
  });

  it("段階の札：「E3 ゲージ3 の札を「第六艦隊」→「ウルシー攻撃部隊」」、海域 E3", () => {
    const after = editDoc(before, (d) => {
      stageOf(d, "E3-3").fudaId = "ulithi";
    });

    expect(describeChanges(before, after)).toEqual([
      {
        location: { kind: "stage", stageId: "E3-3", field: "fudaId" },
        change: "modified",
        text: "E3 ゲージ3 の札を「第六艦隊」→「ウルシー攻撃部隊」",
        areaIds: ["E3"],
      },
    ]);
  });

  it("段階名の変更：変更前と変更後の名前が入る", () => {
    const after = editDoc(before, (d) => {
      stageOf(d, "E2-1").name = "ゲージ1";
    });

    const changes = describeChanges(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      location: { kind: "stage", stageId: "E2-1", field: "name" },
      change: "modified",
      areaIds: ["E2"],
    });
    expect(changes[0]?.text).toContain("段階名");
    expect(changes[0]?.text).toContain("「ゲージ1 輸送」→「ゲージ1」");
  });

  it("段階の追加：「E3 の段階を追加（新しい段階）」", () => {
    const after = editDoc(before, (d) => {
      insertStageInto(d, makeStage({ id: "n-1", areaId: "E3", fudaId: "ulithi", name: "新しい段階" }), null);
    });

    expect(describeChanges(before, after)).toEqual([
      {
        location: { kind: "stage", stageId: "n-1", field: null },
        change: "added",
        text: "E3 の段階を追加（新しい段階）",
        areaIds: ["E3"],
      },
    ]);
  });

  it("段階の削除：海域と段階名が入る", () => {
    const after = editDoc(before, (d) => {
      removeStageFrom(d, "E3-G");
    });

    const changes = describeChanges(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      location: { kind: "stage", stageId: "E3-G", field: null },
      change: "deleted",
      areaIds: ["E3"],
    });
    expect(changes[0]?.text).toContain("E3");
    expect(changes[0]?.text).toContain("ギミック");
    expect(changes[0]?.text).toContain("削除");
  });

  it("特効グループの追加：「E3 ゲージ4 の特効を追加（第二十七駆逐隊 ×1.20）」", () => {
    const after = editDoc(before, (d) => {
      stageOf(d, "E3-4").boosts.push({ id: "E3-4-D", name: "第二十七駆逐隊", multiplier: 1.2, shipNames: ["白露"] });
    });

    expect(describeChanges(before, after)).toEqual([
      {
        location: { kind: "boostGroup", stageId: "E3-4", groupId: "E3-4-D", field: null },
        change: "added",
        text: "E3 ゲージ4 の特効を追加（第二十七駆逐隊 ×1.20）",
        areaIds: ["E3"],
      },
    ]);
  });

  it("特効グループの倍率の変更：グループ名と、変更前・変更後の倍率が入る", () => {
    const after = editDoc(before, (d) => {
      groupOf(d, "E2-3-C").multiplier = 1.3;
    });

    const changes = describeChanges(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      location: { kind: "boostGroup", stageId: "E2-3", groupId: "E2-3-C", field: "multiplier" },
      change: "modified",
      areaIds: ["E2"],
    });
    expect(changes[0]?.text).toContain("連合艦隊C");
    expect(changes[0]?.text).toContain("×1.27");
    expect(changes[0]?.text).toContain("×1.30");
  });

  it("特効グループの艦名の変更：足した艦名と外した艦名が入る", () => {
    const after = editDoc(before, (d) => {
      const group = groupOf(d, "E2-3-C");
      group.shipNames = [...group.shipNames.filter((n) => n !== "響"), "時雨"];
    });

    const changes = describeChanges(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      location: { kind: "boostGroup", stageId: "E2-3", groupId: "E2-3-C", field: "shipNames" },
      areaIds: ["E2"],
    });
    expect(changes[0]?.text).toContain("時雨");
    expect(changes[0]?.text).toContain("響");
  });

  it("段階の並び順：海域の名前と「並び順」が入り、海域はその海域", () => {
    const after = editDoc(before, (d) => {
      const e2 = d.stages.filter((s) => s.areaId === "E2");
      const others = d.stages.filter((s) => s.areaId !== "E2");
      const [g, one, two, three] = e2;
      if (!g || !one || !two || !three) throw new Error("E2 の段階が足りません");
      d.stages = [...others.slice(0, 1), g, three, one, two, ...others.slice(1)];
    });

    const changes = describeChanges(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ location: { kind: "stageOrder", areaId: "E2" }, areaIds: ["E2"] });
    expect(changes[0]?.text).toContain("E2");
    expect(changes[0]?.text).toContain("並び順");
  });

  it("別の海域への移動：海域は移す前と後の両方", () => {
    const after = editDoc(before, (d) => {
      stageOf(d, "E3-G").areaId = "E2";
    });

    const changes = describeChanges(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]?.location).toEqual({ kind: "stage", stageId: "E3-G", field: "areaId" });
    expect([...(changes[0]?.areaIds ?? [])].sort()).toEqual(["E2", "E3"]);
  });

  it("札の並び順：「札の並び順を変更」、海域なし", () => {
    const after = editDoc(before, (d) => {
      d.fudas = [...d.fudas.slice(1), ...d.fudas.slice(0, 1)];
    });

    expect(describeChanges(before, after)).toEqual([
      { location: { kind: "fudaOrder" }, change: "modified", text: "札の並び順を変更", areaIds: [] },
    ]);
  });

  it("札の追加：札名が入り、海域なし", () => {
    const after = editDoc(before, (d) => {
      d.fudas.push({ id: "kido", name: "機動部隊", color: "#3FB37F", gameNumber: 6 });
    });

    const changes = describeChanges(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      location: { kind: "fuda", fudaId: "kido", field: null },
      change: "added",
      areaIds: [],
    });
    expect(changes[0]?.text).toContain("機動部隊");
    expect(changes[0]?.text).toContain("追加");
  });

  it("札の名前の変更：変更前と変更後の名前が入り、海域なし", () => {
    const after = editDoc(before, (d) => {
      fudaOf(d, "rengo").name = "連合艦隊（後段）";
    });

    const changes = describeChanges(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ location: { kind: "fuda", fudaId: "rengo", field: "name" }, areaIds: [] });
    expect(changes[0]?.text).toContain("「連合艦隊」→「連合艦隊（後段）」");
  });

  it("海域の追加：海域はその海域", () => {
    const after = editDoc(before, (d) => {
      d.areas.push({ id: "E4", name: "E4" });
    });

    const changes = describeChanges(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ location: { kind: "area", areaId: "E4" }, change: "added", areaIds: ["E4"] });
    expect(changes[0]?.text).toContain("E4");
  });

  it("イベントの終了日時の変更：「終了日時」が入り、海域なし", () => {
    const after = editDoc(before, (d) => {
      d.event.endAt = "2026-10-20T11:00+09:00";
    });

    const changes = describeChanges(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ location: { kind: "event", field: "endAt" }, areaIds: [] });
    expect(changes[0]?.text).toContain("終了日時");
  });

  it("複数の変更は 1 件ずつ、それぞれの海域で返す", () => {
    const after = editDoc(importanceChanged, (d) => {
      stageOf(d, "E3-4").name = "ゲージ4 最終";
    });

    const changes = describeChanges(before, after);

    expect(changes).toHaveLength(2);
    expect(changes).toContainEqual(expect.objectContaining({ text: IMPORTANCE_TEXT, areaIds: ["E2"] }));
    expect(changes).toContainEqual(
      expect.objectContaining({ location: { kind: "stage", stageId: "E3-4", field: "name" }, areaIds: ["E3"] }),
    );
  });
});

describe("summarizeSave（1 回の保存の記録の内容）", () => {
  it("変更が 1 件なら、その文と海域", () => {
    const summary = summarizeSave(before, importanceChanged);

    expect(summary.text).toBe(IMPORTANCE_TEXT);
    expect(summary.areaIds).toEqual(["E2"]);
    expect(summary.changes).toEqual(describeChanges(before, importanceChanged));
  });

  it("変更が 2 件以上なら「（最初の変更の文） ほか n 件」、海域は重複なしで海域の並び順", () => {
    const two = editDoc(importanceChanged, (d) => {
      stageOf(d, "E3-4").name = "ゲージ4 最終";
    });
    const three = editDoc(two, (d) => {
      stageOf(d, "E1-1").importance = "important";
    });

    const summaryTwo = summarizeSave(before, two);
    const summaryThree = summarizeSave(before, three);

    expect(summaryTwo.changes).toHaveLength(2);
    expect(summaryTwo.text).toBe(`${summaryTwo.changes[0]?.text} ほか 1 件`);
    expect(summaryTwo.areaIds).toEqual(["E2", "E3"]);
    expect(summaryThree.text).toBe(`${summaryThree.changes[0]?.text} ほか 2 件`);
    expect(summaryThree.areaIds).toEqual(["E1", "E2", "E3"]);
  });

  it("同じ海域の変更が複数あっても、海域は 1 つ", () => {
    const after = editDoc(importanceChanged, (d) => {
      stageOf(d, "E2-1").name = "ゲージ1";
    });

    expect(summarizeSave(before, after).areaIds).toEqual(["E2"]);
  });

  it("札だけの変更なら、海域は空", () => {
    const after = editDoc(before, (d) => {
      fudaOf(d, "rengo").name = "連合艦隊（後段）";
    });

    expect(summarizeSave(before, after).areaIds).toEqual([]);
  });

  it("変更がなければ「変更なし」", () => {
    expect(summarizeSave(before, before)).toEqual({ text: "変更なし", areaIds: [], changes: [] });
  });
});

describe("特効グループの国籍の変更の文（v1.1）", () => {
  /** E2 ゲージ3 の連合艦隊C の国籍を変えた文書（undefined なら項目を消す） */
  function withNationalities(from: DefinitionDoc, nationalities: string[] | undefined): DefinitionDoc {
    return editDoc(from, (d) => {
      const group = groupOf(d, "E2-3-C") as unknown as Record<string, unknown>;
      if (nationalities === undefined) {
        delete group.nationalities;
      } else {
        group.nationalities = nationalities;
      }
    });
  }

  it("国籍の追加と削除：「E2 ゲージ3 の特効「連合艦隊C」の国籍を変更（追加：アメリカ／削除：イギリス）」、海域 E2", () => {
    // 準備
    const from = withNationalities(before, ["uk"]);
    const after = withNationalities(before, ["usa"]);

    // 実行
    const changes = describeChanges(from, after);

    // 検証
    expect(changes).toEqual([
      {
        location: { kind: "boostGroup", stageId: "E2-3", groupId: "E2-3-C", field: "nationalities" },
        change: "modified",
        text: "E2 ゲージ3 の特効「連合艦隊C」の国籍を変更（追加：アメリカ／削除：イギリス）",
        areaIds: ["E2"],
      },
    ]);
  });

  it("国籍を足しただけ：「…の国籍を変更（追加：アメリカ、イギリス）」（国籍のなかったグループに）", () => {
    const after = withNationalities(before, ["usa", "uk"]);

    const changes = describeChanges(before, after);

    expect(changes.map((c) => c.text)).toEqual(["E2 ゲージ3 の特効「連合艦隊C」の国籍を変更（追加：アメリカ、イギリス）"]);
  });

  it("国籍を外しただけ：「…の国籍を変更（削除：ドイツ）」（最後の国籍を外して項目がなくなった）", () => {
    const from = withNationalities(before, ["germany"]);
    const after = withNationalities(before, undefined);

    const changes = describeChanges(from, after);

    expect(changes.map((c) => c.text)).toEqual(["E2 ゲージ3 の特効「連合艦隊C」の国籍を変更（削除：ドイツ）"]);
  });

  it("省略と空の配列は同じ（変更なし）", () => {
    expect(describeChanges(before, withNationalities(before, []))).toEqual([]);
    expect(describeChanges(withNationalities(before, []), before)).toEqual([]);
  });

  it("国籍は集合として比べる（並びだけが変わっても変更にしない）", () => {
    const from = withNationalities(before, ["usa", "uk"]);
    const after = withNationalities(before, ["uk", "usa"]);

    expect(describeChanges(from, after)).toEqual([]);
  });

  it("艦名と国籍を両方変えたら、艦名の文と国籍の文の 2 件になる", () => {
    const after = editDoc(withNationalities(before, ["usa"]), (d) => {
      groupOf(d, "E2-3-C").shipNames.push("時雨");
    });

    const changes = describeChanges(before, after);

    expect(changes.map((c) => c.location)).toEqual([
      { kind: "boostGroup", stageId: "E2-3", groupId: "E2-3-C", field: "shipNames" },
      { kind: "boostGroup", stageId: "E2-3", groupId: "E2-3-C", field: "nationalities" },
    ]);
  });

  it("保存の記録の内容（summarizeSave）にも、国籍の変更の文が入る", () => {
    const after = withNationalities(before, ["usa"]);

    expect(summarizeSave(before, after)).toEqual({
      text: "E2 ゲージ3 の特効「連合艦隊C」の国籍を変更（追加：アメリカ）",
      areaIds: ["E2"],
      changes: describeChanges(before, after),
    });
  });
});

describe("特効グループの艦種の変更の文（v1.1。国籍の条件を絞る shipTypes）", () => {
  /** 艦種の場所（E2 ゲージ3 の連合艦隊C） */
  const SHIP_TYPES_AT = { kind: "boostGroup", stageId: "E2-3", groupId: "E2-3-C", field: "shipTypes" } as const;

  /** E2 ゲージ3 の連合艦隊C を国籍 アメリカ にし、艦種を変えた文書（undefined なら艦種の項目を持たない） */
  function withShipTypes(shipTypes: number[] | undefined): DefinitionDoc {
    return editDoc(before, (d) => {
      const group = groupOf(d, "E2-3-C") as unknown as Record<string, unknown>;
      group.nationalities = ["usa"];
      if (shipTypes !== undefined) group.shipTypes = shipTypes;
    });
  }

  it("艦種の追加と削除：「E2 ゲージ3 の特効「連合艦隊C」の艦種を変更（追加：駆逐／削除：軽巡）」、海域 E2", () => {
    // 準備
    const from = withShipTypes([3]);
    const after = withShipTypes([2]);

    // 実行
    const changes = describeChanges(from, after);

    // 検証
    expect(changes).toEqual([
      {
        location: SHIP_TYPES_AT,
        change: "modified",
        text: "E2 ゲージ3 の特効「連合艦隊C」の艦種を変更（追加：駆逐／削除：軽巡）",
        areaIds: ["E2"],
      },
    ]);
  });

  it("艦種を足しただけ：「…の艦種を変更（追加：軽巡、駆逐）」（表示名は選択肢の順）", () => {
    const changes = describeChanges(withShipTypes(undefined), withShipTypes([2, 3]));

    expect(changes.map((c) => c.text)).toEqual(["E2 ゲージ3 の特効「連合艦隊C」の艦種を変更（追加：軽巡、駆逐）"]);
  });

  it("艦種を外しただけ：「…の艦種を変更（削除：戦艦）」（艦種 8・9 は表示名「戦艦」1 つ。最後の艦種を外して項目がなくなった）", () => {
    const changes = describeChanges(withShipTypes([8, 9]), withShipTypes(undefined));

    expect(changes.map((c) => c.text)).toEqual(["E2 ゲージ3 の特効「連合艦隊C」の艦種を変更（削除：戦艦）"]);
  });

  it("省略と空の配列は同じ（変更なし）", () => {
    expect(describeChanges(withShipTypes(undefined), withShipTypes([]))).toEqual([]);
    expect(describeChanges(withShipTypes([]), withShipTypes(undefined))).toEqual([]);
  });

  it("艦種は集合として比べる（並びだけが変わっても変更にしない）", () => {
    expect(describeChanges(withShipTypes([2, 3]), withShipTypes([3, 2]))).toEqual([]);
  });

  it("国籍と艦種を両方変えたら、国籍の文と艦種の文の 2 件になる（国籍が先）", () => {
    // 準備：国籍も艦種もないグループに、国籍 アメリカと艦種 駆逐を入れる
    const after = withShipTypes([2]);

    // 実行
    const changes = describeChanges(before, after);

    // 検証
    expect(changes.map((c) => c.location)).toEqual([
      { kind: "boostGroup", stageId: "E2-3", groupId: "E2-3-C", field: "nationalities" },
      SHIP_TYPES_AT,
    ]);
    expect(changes.map((c) => c.text)).toEqual([
      "E2 ゲージ3 の特効「連合艦隊C」の国籍を変更（追加：アメリカ）",
      "E2 ゲージ3 の特効「連合艦隊C」の艦種を変更（追加：駆逐）",
    ]);
  });

  it("保存の記録の内容（summarizeSave）にも、艦種の変更の文が入る", () => {
    const from = withShipTypes(undefined);
    const after = withShipTypes([2]);

    expect(summarizeSave(from, after)).toEqual({
      text: "E2 ゲージ3 の特効「連合艦隊C」の艦種を変更（追加：駆逐）",
      areaIds: ["E2"],
      changes: describeChanges(from, after),
    });
  });
});
