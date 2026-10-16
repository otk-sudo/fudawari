// 3 方向マージ（同時編集の B 案。要件 3.7「同時編集」、roadmap T3-8 の単体部分）のテスト
//
// base はテスト用データ（2026夏イベ）。mine・theirs は base を複製して直接書き換えて作る
// （定義の編集の関数を使わず、マージだけを確かめるため）。入力はすべて凍結してあるので、
// マージが入力を書き換えると例外になる。
import { describe, expect, it } from "vitest";
import type { DefinitionDoc } from "@/domain/definition-edit/types";
import {
  areaIdsOf,
  editDoc,
  fudaIdsOf,
  fudaOf,
  groupOf,
  hasGroup,
  insertStageInto,
  makeStage,
  removeStageFrom,
  stageIdsOf,
  stageOf,
} from "@/domain/definition-edit/test-helpers";
import { type Mutable, summer2026Definition } from "@/test/fixtures";
import { mergeDefinitions, resolveMerge } from "./merge";
import type { ChangeLocation, ConflictChoice, MergeConflict, MergeInput, ResolveResult } from "./types";

const base = summer2026Definition;

// ---- テストの補助 ----

/** base・mine・theirs をまとめてマージする */
function run(mine: DefinitionDoc, theirs: DefinitionDoc, from: DefinitionDoc = base) {
  const input: MergeInput = { base: from, mine, theirs };
  return { input, result: mergeDefinitions(input) };
}

/** 場所が同じか（項目の並びの違いは気にしない） */
function sameLocation(a: ChangeLocation, b: ChangeLocation): boolean {
  const normalize = (l: ChangeLocation) =>
    JSON.stringify(Object.entries(l).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return normalize(a) === normalize(b);
}

/** 衝突を場所で探す（なければ失敗） */
function conflictAt(conflicts: MergeConflict[], location: ChangeLocation): MergeConflict {
  const found = conflicts.find((c) => sameLocation(c.location, location));
  if (!found) {
    throw new Error(`衝突が見つかりません：${JSON.stringify(location)}／${JSON.stringify(conflicts)}`);
  }
  return found;
}

/** すべての衝突に同じ側を選ぶ */
function chooseAll(conflicts: MergeConflict[], choice: ConflictChoice): Record<string, ConflictChoice> {
  return Object.fromEntries(conflicts.map((c) => [c.id, choice]));
}

/** 最終的な文書ができたことを確かめて返す */
function expectResolved(result: ResolveResult): DefinitionDoc {
  if (!result.ok) throw new Error(`選んでいない衝突があります：${result.unresolved.join("、")}`);
  return result.doc;
}

/** 合わせた文書の整合（ID が重ならず、段階の海域・札がすべてある） */
function expectConsistent(doc: DefinitionDoc): void {
  const areaIds = doc.areas.map((a) => a.id);
  const fudaIds = doc.fudas.map((f) => f.id);
  const stageIds = doc.stages.map((s) => s.id);
  const groupIds = doc.stages.flatMap((s) => s.boosts.map((g) => g.id));
  for (const ids of [areaIds, fudaIds, stageIds, groupIds]) {
    expect(new Set(ids).size).toBe(ids.length);
  }
  for (const stage of doc.stages) {
    expect(areaIds).toContain(stage.areaId);
    expect(fudaIds).toContain(stage.fudaId);
  }
}

/** テストの準備：海域の段階を、指定した順に並べ替える（draft を書き換える） */
function reorderArea(draft: Mutable<DefinitionDoc>, areaId: string, order: string[]): void {
  const queue = order.map((id) => {
    const stage = draft.stages.find((s) => s.id === id && s.areaId === areaId);
    if (!stage) throw new Error(`${areaId} に段階 ${id} がありません`);
    return stage;
  });
  draft.stages = draft.stages.map((s) => {
    if (s.areaId !== areaId) return s;
    const next = queue.shift();
    if (!next) throw new Error("並べ替えの数が合いません");
    return next;
  });
}

/** テストの準備：札を、指定した順に並べ替える（draft を書き換える） */
function reorderFudas(draft: Mutable<DefinitionDoc>, order: string[]): void {
  draft.fudas = order.map((id) => {
    const fuda = draft.fudas.find((f) => f.id === id);
    if (!fuda) throw new Error(`札 ${id} がありません`);
    return fuda;
  });
}

// ---- テスト ----

describe("mergeDefinitions：変更がない・片方だけが変えた", () => {
  it("どちらも変えていなければ base のまま（衝突も自動で合わせた所もない）", () => {
    const { result } = run(base, base);

    expect(result.merged).toEqual(base);
    expect(result.conflicts).toEqual([]);
    expect(result.autoMerged).toEqual([]);
  });

  it("自分だけが変えた所は自分の内容になり、自動で合わせた所には出さない", () => {
    const mine = editDoc(base, (d) => {
      stageOf(d, "E2-3").importance = "important";
    });

    const { result } = run(mine, base);

    expect(result.merged).toEqual(mine);
    expect(result.conflicts).toEqual([]);
    expect(result.autoMerged).toEqual([]);
  });

  it("相手だけが変えた所は相手の内容を取り込み、自動で合わせた所として返す（表示名と印を付ける段階）", () => {
    const theirs = editDoc(base, (d) => {
      stageOf(d, "E2-3").importance = "important";
    });

    const { result } = run(base, theirs);

    expect(result.merged).toEqual(theirs);
    expect(result.conflicts).toEqual([]);
    expect(result.autoMerged).toEqual([
      {
        location: { kind: "stage", stageId: "E2-3", field: "importance" },
        change: "modified",
        label: "E2 ゲージ3 の大事さ",
        stageId: "E2-3",
      },
    ]);
  });
});

describe("mergeDefinitions：違う所の変更は自動で合わせる", () => {
  it("違う段階の変更は両方を取り込む（自分：E2 ゲージ3 の大事さ、相手：E3 ゲージ4 の特効を追加）", () => {
    const newGroup = { id: "E3-4-D", name: "第二十七駆逐隊", multiplier: 1.2, shipNames: ["白露", "時雨"] };
    const mine = editDoc(base, (d) => {
      stageOf(d, "E2-3").importance = "important";
    });
    const theirs = editDoc(base, (d) => {
      stageOf(d, "E3-4").boosts.push(newGroup);
    });

    const { result } = run(mine, theirs);

    expect(result.merged).toEqual(
      editDoc(base, (d) => {
        stageOf(d, "E2-3").importance = "important";
        stageOf(d, "E3-4").boosts.push(newGroup);
      }),
    );
    expect(result.conflicts).toEqual([]);
    expect(result.autoMerged).toEqual([
      {
        location: { kind: "boostGroup", stageId: "E3-4", groupId: "E3-4-D", field: null },
        change: "added",
        label: expect.stringContaining("E3 ゲージ4"),
        stageId: "E3-4",
      },
    ]);
    expect(result.autoMerged[0]?.label).toContain("第二十七駆逐隊");
  });

  it("同じ段階の違う項目の変更は両方を取り込む（衝突にしない）", () => {
    const mine = editDoc(base, (d) => {
      stageOf(d, "E2-3").name = "ゲージ3 最終";
    });
    const theirs = editDoc(base, (d) => {
      stageOf(d, "E2-3").importance = "important";
    });

    const { result } = run(mine, theirs);

    expect(result.conflicts).toEqual([]);
    expect(stageOf(result.merged, "E2-3")).toEqual({
      ...stageOf(base, "E2-3"),
      name: "ゲージ3 最終",
      importance: "important",
    });
  });

  it("同じ項目を 2 人が同じ値に変えた場合は衝突にせず、自動で合わせた所にも出さない", () => {
    const changed = editDoc(base, (d) => {
      stageOf(d, "E2-3").importance = "important";
    });

    const { result } = run(changed, changed);

    expect(result.merged).toEqual(changed);
    expect(result.conflicts).toEqual([]);
    expect(result.autoMerged).toEqual([]);
  });

  it("特効グループの艦名は、2 人の追加と削除を合わせる（衝突にしない）", () => {
    const mine = editDoc(base, (d) => {
      const group = groupOf(d, "E2-3-C");
      group.shipNames = [...group.shipNames.filter((n) => n !== "響"), "雪風"];
    });
    const theirs = editDoc(base, (d) => {
      groupOf(d, "E2-3-C").shipNames.push("時雨");
    });

    const { result } = run(mine, theirs);

    expect(result.conflicts).toEqual([]);
    expect([...groupOf(result.merged, "E2-3-C").shipNames].sort()).toEqual(
      ["千歳", "千代田", "瑞鳳", "瑞鶴", "初霜", "潮", "雪風", "時雨"].sort(),
    );
    expect(result.autoMerged).toContainEqual(
      expect.objectContaining({
        location: { kind: "boostGroup", stageId: "E2-3", groupId: "E2-3-C", field: "shipNames" },
        change: "modified",
        stageId: "E2-3",
      }),
    );
  });

  it("札：相手が名前、自分が色を変えたら両方を取り込む", () => {
    const mine = editDoc(base, (d) => {
      fudaOf(d, "rengo").color = "#A97EF0";
    });
    const theirs = editDoc(base, (d) => {
      fudaOf(d, "rengo").name = "連合艦隊（後段）";
    });

    const { result } = run(mine, theirs);

    expect(result.conflicts).toEqual([]);
    expect(fudaOf(result.merged, "rengo")).toEqual({
      id: "rengo",
      name: "連合艦隊（後段）",
      color: "#A97EF0",
      gameNumber: 3,
    });
  });

  it("イベント：相手が終了日時を変え、自分が段階を変えたら両方を取り込む", () => {
    const mine = editDoc(base, (d) => {
      stageOf(d, "E2-3").importance = "important";
    });
    const theirs = editDoc(base, (d) => {
      d.event.endAt = "2026-10-20T11:00+09:00";
    });

    const { result } = run(mine, theirs);

    expect(result.conflicts).toEqual([]);
    expect(result.merged.event.endAt).toBe("2026-10-20T11:00+09:00");
    expect(stageOf(result.merged, "E2-3").importance).toBe("important");
    expect(result.autoMerged).toEqual([
      { location: { kind: "event", field: "endAt" }, change: "modified", label: "終了日時", stageId: null },
    ]);
  });
});

describe("mergeDefinitions：追加", () => {
  it("2 人が別々の段階を追加したら、両方をそれぞれ置いた位置に残す", () => {
    const theirs = editDoc(base, (d) => {
      insertStageInto(d, makeStage({ id: "t-1", areaId: "E2", fudaId: "tago", name: "新しい段階" }), "E2-2");
    });
    const mine = editDoc(base, (d) => {
      // E2 の最後（配列では E3 ギミックの直前）
      insertStageInto(d, makeStage({ id: "m-1", areaId: "E2", fudaId: "rengo", name: "新しい段階" }), "E3-G");
    });

    const { result } = run(mine, theirs);

    expect(result.conflicts).toEqual([]);
    expect(stageIdsOf(result.merged, "E2")).toEqual(["E2-G", "E2-1", "t-1", "E2-2", "E2-3", "m-1"]);
    expect(result.autoMerged).toContainEqual(
      expect.objectContaining({
        location: { kind: "stage", stageId: "t-1", field: null },
        change: "added",
        stageId: "t-1",
      }),
    );
    expect(result.autoMerged.some((c) => c.stageId === "m-1")).toBe(false);
  });

  it("相手が海域を追加したら取り込む", () => {
    const mine = editDoc(base, (d) => {
      stageOf(d, "E2-3").importance = "important";
    });
    const theirs = editDoc(base, (d) => {
      d.areas.push({ id: "E4", name: "E4" });
    });

    const { result } = run(mine, theirs);

    expect(areaIdsOf(result.merged)).toEqual(["E1", "E2", "E3", "E4"]);
    expect(result.autoMerged).toContainEqual(
      expect.objectContaining({ location: { kind: "area", areaId: "E4" }, change: "added" }),
    );
  });

  it("2 人とも同じ海域（E4）を追加したら 1 つにする（衝突にしない）", () => {
    const withE4 = editDoc(base, (d) => {
      d.areas.push({ id: "E4", name: "E4" });
    });

    const { result } = run(withE4, withE4);

    expect(areaIdsOf(result.merged)).toEqual(["E1", "E2", "E3", "E4"]);
    expect(result.conflicts).toEqual([]);
    expect(result.autoMerged).toEqual([]);
  });
});

describe("mergeDefinitions：同じ項目を 2 人が違う値に変えたら衝突", () => {
  const theirs = editDoc(base, (d) => {
    stageOf(d, "E2-3").importance = "important";
    stageOf(d, "E3-4").name = "ゲージ4 最終";
  });
  const mine = editDoc(base, (d) => {
    stageOf(d, "E2-3").importance = "normal";
  });

  it("衝突として、場所・表示名・相手の値・自分の値・光らせる段階を返す", () => {
    const { result } = run(mine, theirs);

    expect(result.conflicts).toEqual([
      {
        id: expect.any(String),
        location: { kind: "stage", stageId: "E2-3", field: "importance" },
        label: "E2 ゲージ3 の大事さ",
        theirsText: "重要",
        mineText: "普通",
        stageId: "E2-3",
      },
    ]);
    expect(result.conflicts[0]?.id).not.toBe("");
  });

  it("選んでいる間の文書は、衝突した所が自分の内容で、ほかは合わせた内容", () => {
    const { result } = run(mine, theirs);

    expect(stageOf(result.merged, "E2-3").importance).toBe("normal");
    expect(stageOf(result.merged, "E3-4").name).toBe("ゲージ4 最終");
    expect(result.autoMerged).toContainEqual(
      expect.objectContaining({ location: { kind: "stage", stageId: "E3-4", field: "name" }, change: "modified" }),
    );
  });

  it("同じ入力からは同じ衝突の ID になる", () => {
    const first = run(mine, theirs).result.conflicts.map((c) => c.id);
    const second = run(mine, theirs).result.conflicts.map((c) => c.id);

    expect(second).toEqual(first);
  });

  it("特効グループの倍率を 2 人が違う値に変えたら衝突（表示名に段階とグループ名、値は ×付き）", () => {
    const theirsMult = editDoc(base, (d) => {
      groupOf(d, "E2-3-C").multiplier = 1.3;
    });
    const mineMult = editDoc(base, (d) => {
      groupOf(d, "E2-3-C").multiplier = 1.25;
    });

    const { result } = run(mineMult, theirsMult);
    const conflict = conflictAt(result.conflicts, {
      kind: "boostGroup",
      stageId: "E2-3",
      groupId: "E2-3-C",
      field: "multiplier",
    });

    expect(result.conflicts).toHaveLength(1);
    expect(conflict).toMatchObject({ theirsText: "×1.30", mineText: "×1.25", stageId: "E2-3" });
    expect(conflict.label).toContain("E2 ゲージ3");
    expect(conflict.label).toContain("連合艦隊C");
    expect(conflict.label).toContain("倍率");
  });

  it("札の名前を 2 人が違う名前に変えたら衝突（段階の印はない）", () => {
    const theirsName = editDoc(base, (d) => {
      fudaOf(d, "rengo").name = "連合艦隊（後段）";
    });
    const mineName = editDoc(base, (d) => {
      fudaOf(d, "rengo").name = "連合";
    });

    const { result } = run(mineName, theirsName);
    const conflict = conflictAt(result.conflicts, { kind: "fuda", fudaId: "rengo", field: "name" });

    expect(conflict).toMatchObject({ theirsText: "連合艦隊（後段）", mineText: "連合", stageId: null });
    expect(conflict.label).toContain("連合艦隊");
    expect(conflict.label).toContain("名前");
  });

  it("イベントの終了日時を 2 人が違う値に変えたら衝突", () => {
    const theirsEnd = editDoc(base, (d) => {
      d.event.endAt = "2026-10-20T11:00+09:00";
    });
    const mineEnd = editDoc(base, (d) => {
      d.event.endAt = "2026-10-25T11:00+09:00";
    });

    const { result } = run(mineEnd, theirsEnd);
    const conflict = conflictAt(result.conflicts, { kind: "event", field: "endAt" });

    expect(conflict).toMatchObject({ label: "終了日時", stageId: null });
    expect(result.merged.event.endAt).toBe("2026-10-25T11:00+09:00");
  });

  it("2 人とも同じ段階を違う海域へ移したら衝突（値は海域名）", () => {
    const theirsMove = editDoc(base, (d) => {
      stageOf(d, "E3-G").areaId = "E2";
    });
    const mineMove = editDoc(base, (d) => {
      stageOf(d, "E3-G").areaId = "E1";
    });

    const { result } = run(mineMove, theirsMove);
    const conflict = conflictAt(result.conflicts, { kind: "stage", stageId: "E3-G", field: "areaId" });

    expect(conflict).toMatchObject({ theirsText: "E2", mineText: "E1", stageId: "E3-G" });
    expect(stageOf(result.merged, "E3-G").areaId).toBe("E1");
  });
});

describe("resolveMerge：衝突ごとの選択から最終的な文書を作る", () => {
  const theirs = editDoc(base, (d) => {
    stageOf(d, "E2-3").importance = "important";
    stageOf(d, "E3-4").name = "ゲージ4 最終";
  });
  const mine = editDoc(base, (d) => {
    stageOf(d, "E2-3").importance = "normal";
    stageOf(d, "E1-1").name = "ギミック〜ゲージ3（全体）";
  });

  it("相手の内容を選ぶと相手の値になり、自動で合わせた所と自分だけの変更は残る", () => {
    const { input, result } = run(mine, theirs);

    const doc = expectResolved(resolveMerge(input, chooseAll(result.conflicts, "theirs")));

    expect(stageOf(doc, "E2-3").importance).toBe("important");
    expect(stageOf(doc, "E3-4").name).toBe("ゲージ4 最終");
    expect(stageOf(doc, "E1-1").name).toBe("ギミック〜ゲージ3（全体）");
  });

  it("自分の内容を選ぶと自分の値になる（merged と同じ）", () => {
    const { input, result } = run(mine, theirs);

    const doc = expectResolved(resolveMerge(input, chooseAll(result.conflicts, "mine")));

    expect(stageOf(doc, "E2-3").importance).toBe("normal");
    expect(doc).toEqual(result.merged);
  });

  it("選んでいない衝突があると、最終的な文書を作らず、その衝突の ID を返す", () => {
    const { input, result } = run(mine, theirs);

    expect(resolveMerge(input, {})).toEqual({ ok: false, unresolved: result.conflicts.map((c) => c.id) });
  });

  it("衝突がなければ、選ばなくても最終的な文書を作れる（merged と同じ。関係ない ID は無視する）", () => {
    const onlyTheirs = editDoc(base, (d) => {
      stageOf(d, "E3-4").name = "ゲージ4 最終";
    });
    const { input, result } = run(base, onlyTheirs);

    expect(expectResolved(resolveMerge(input, {}))).toEqual(result.merged);
    expect(expectResolved(resolveMerge(input, { "no-such-conflict": "theirs" }))).toEqual(result.merged);
  });

  it("複数の衝突は、それぞれ選んだ側の値になる", () => {
    const theirs2 = editDoc(base, (d) => {
      stageOf(d, "E2-3").importance = "important";
      stageOf(d, "E3-4").name = "ゲージ4 最終";
    });
    const mine2 = editDoc(base, (d) => {
      stageOf(d, "E2-3").importance = "normal";
      stageOf(d, "E3-4").name = "ゲージ4 ラスダン";
    });
    const { input, result } = run(mine2, theirs2);
    const importance = conflictAt(result.conflicts, { kind: "stage", stageId: "E2-3", field: "importance" });
    const name = conflictAt(result.conflicts, { kind: "stage", stageId: "E3-4", field: "name" });

    const doc = expectResolved(resolveMerge(input, { [importance.id]: "theirs", [name.id]: "mine" }));

    expect(result.conflicts).toHaveLength(2);
    expect(stageOf(doc, "E2-3").importance).toBe("important");
    expect(stageOf(doc, "E3-4").name).toBe("ゲージ4 ラスダン");
  });
});

describe("mergeDefinitions・resolveMerge：削除", () => {
  it("相手が段階を削除し、自分がその段階を変えていなければ削除する（自動で合わせた所に出す）", () => {
    const mine = editDoc(base, (d) => {
      stageOf(d, "E2-3").importance = "important";
    });
    const theirs = editDoc(base, (d) => {
      removeStageFrom(d, "E3-G");
    });

    const { result } = run(mine, theirs);

    expect(result.conflicts).toEqual([]);
    expect(stageIdsOf(result.merged, "E3")).toEqual(["E3-1", "E3-2", "E3-3", "E3-4"]);
    expect(stageOf(result.merged, "E2-3").importance).toBe("important");
    expect(result.autoMerged).toEqual([
      {
        location: { kind: "stage", stageId: "E3-G", field: null },
        change: "deleted",
        label: "E3 ギミック",
        stageId: "E3-G",
      },
    ]);
  });

  it("2 人とも同じ段階を削除したら、削除する（衝突にしない）", () => {
    const deleted = editDoc(base, (d) => {
      removeStageFrom(d, "E3-G");
    });

    const { result } = run(deleted, deleted);

    expect(result.merged).toEqual(deleted);
    expect(result.conflicts).toEqual([]);
    expect(result.autoMerged).toEqual([]);
  });

  it("相手が削除し、自分が同じ段階を変えたら衝突（相手「削除」、自分「変更」）", () => {
    const mine = editDoc(base, (d) => {
      stageOf(d, "E3-G").name = "前段ギミック";
    });
    const theirs = editDoc(base, (d) => {
      removeStageFrom(d, "E3-G");
    });
    const { input, result } = run(mine, theirs);

    expect(result.conflicts).toEqual([
      {
        id: expect.any(String),
        location: { kind: "stage", stageId: "E3-G", field: null },
        label: "E3 ギミック",
        theirsText: "削除",
        mineText: "変更",
        stageId: "E3-G",
      },
    ]);
    // 選んでいる間は自分の内容（変えた段階が残る）
    expect(stageOf(result.merged, "E3-G").name).toBe("前段ギミック");

    const keptTheirs = expectResolved(resolveMerge(input, chooseAll(result.conflicts, "theirs")));
    const keptMine = expectResolved(resolveMerge(input, chooseAll(result.conflicts, "mine")));
    expect(stageIdsOf(keptTheirs, "E3")).toEqual(["E3-1", "E3-2", "E3-3", "E3-4"]);
    expect(stageIdsOf(keptMine, "E3")).toEqual(["E3-G", "E3-1", "E3-2", "E3-3", "E3-4"]);
    expect(stageOf(keptMine, "E3-G").name).toBe("前段ギミック");
  });

  it("自分が削除し、相手が同じ段階を変えたら衝突（相手の内容を選ぶと相手の変更が残る）", () => {
    const mine = editDoc(base, (d) => {
      removeStageFrom(d, "E3-G");
      stageOf(d, "E2-3").name = "ゲージ3 最終";
    });
    const theirs = editDoc(base, (d) => {
      stageOf(d, "E3-G").importance = "hard";
    });
    const { input, result } = run(mine, theirs);
    const conflict = conflictAt(result.conflicts, { kind: "stage", stageId: "E3-G", field: null });

    expect(conflict).toMatchObject({ theirsText: "変更", mineText: "削除", stageId: "E3-G" });
    // 選んでいる間は自分の内容（削除）
    expect(stageIdsOf(result.merged, "E3")).toEqual(["E3-1", "E3-2", "E3-3", "E3-4"]);

    const keptTheirs = expectResolved(resolveMerge(input, { [conflict.id]: "theirs" }));
    expect(stageIdsOf(keptTheirs, "E3")).toEqual(["E3-G", "E3-1", "E3-2", "E3-3", "E3-4"]);
    expect(stageOf(keptTheirs, "E3-G").importance).toBe("hard");
    expect(stageOf(keptTheirs, "E2-3").name).toBe("ゲージ3 最終");

    const keptMine = expectResolved(resolveMerge(input, { [conflict.id]: "mine" }));
    expect(stageIdsOf(keptMine, "E3")).toEqual(["E3-1", "E3-2", "E3-3", "E3-4"]);
  });

  it("自分が段階を削除し、相手がその段階の特効を変えた場合も、段階の衝突として返す", () => {
    const mine = editDoc(base, (d) => {
      removeStageFrom(d, "E2-3");
    });
    const theirs = editDoc(base, (d) => {
      groupOf(d, "E2-3-C").multiplier = 1.3;
    });
    const { input, result } = run(mine, theirs);

    expect(result.conflicts).toHaveLength(1);
    const conflict = conflictAt(result.conflicts, { kind: "stage", stageId: "E2-3", field: null });
    expect(conflict).toMatchObject({ theirsText: "変更", mineText: "削除" });

    const keptTheirs = expectResolved(resolveMerge(input, { [conflict.id]: "theirs" }));
    expect(stageIdsOf(keptTheirs, "E2")).toEqual(["E2-G", "E2-1", "E2-2", "E2-3"]);
    expect(groupOf(keptTheirs, "E2-3-C").multiplier).toBe(1.3);
    expect(stageOf(keptTheirs, "E2-3").boosts.map((g) => g.id)).toEqual(["E2-3-C", "E2-3-B", "E2-3-A"]);
  });

  it("特効グループ：自分が削除し、相手が倍率を変えたら衝突", () => {
    const mine = editDoc(base, (d) => {
      const stage = stageOf(d, "E2-3");
      stage.boosts = stage.boosts.filter((g) => g.id !== "E2-3-A");
    });
    const theirs = editDoc(base, (d) => {
      groupOf(d, "E2-3-A").multiplier = 1.2;
    });
    const { input, result } = run(mine, theirs);
    const conflict = conflictAt(result.conflicts, {
      kind: "boostGroup",
      stageId: "E2-3",
      groupId: "E2-3-A",
      field: null,
    });

    expect(conflict).toMatchObject({ theirsText: "変更", mineText: "削除", stageId: "E2-3" });
    expect(conflict.label).toContain("連合艦隊A");
    expect(hasGroup(result.merged, "E2-3-A")).toBe(false);

    const keptTheirs = expectResolved(resolveMerge(input, { [conflict.id]: "theirs" }));
    expect(groupOf(keptTheirs, "E2-3-A").multiplier).toBe(1.2);
  });

  it("相手が外した海域でも、自分がそこに段階を置いていれば海域を残す（参照の整合）", () => {
    const withE4 = editDoc(base, (d) => {
      d.areas.push({ id: "E4", name: "E4" });
    });
    const theirs = editDoc(withE4, (d) => {
      d.areas = d.areas.filter((a) => a.id !== "E4");
    });
    const mine = editDoc(withE4, (d) => {
      insertStageInto(d, makeStage({ id: "m-1", areaId: "E4", fudaId: "ulithi" }), null);
    });

    const { input, result } = run(mine, theirs, withE4);

    expect(result.conflicts).toEqual([]);
    expect(areaIdsOf(result.merged)).toEqual(["E1", "E2", "E3", "E4"]);
    expect(stageIdsOf(result.merged, "E4")).toEqual(["m-1"]);
    expectConsistent(result.merged);
    expectConsistent(expectResolved(resolveMerge(input, {})));
  });

  it("相手が削除した札でも、自分が段階で使っていれば札を残す（参照の整合）", () => {
    const withSpare = editDoc(base, (d) => {
      d.fudas.push({ id: "spare", name: "予備の札", color: "#3FB37F", gameNumber: 6 });
    });
    const theirs = editDoc(withSpare, (d) => {
      d.fudas = d.fudas.filter((f) => f.id !== "spare");
    });
    const mine = editDoc(withSpare, (d) => {
      insertStageInto(d, makeStage({ id: "m-1", areaId: "E3", fudaId: "spare" }), null);
    });

    const { result } = run(mine, theirs, withSpare);

    expect(result.conflicts).toEqual([]);
    expect(fudaOf(result.merged, "spare")).toEqual({ id: "spare", name: "予備の札", color: "#3FB37F", gameNumber: 6 });
    expect(stageOf(result.merged, "m-1").fudaId).toBe("spare");
    expectConsistent(result.merged);
  });

  it("相手が使われていない札を削除し、自分が触っていなければ削除する", () => {
    const withSpare = editDoc(base, (d) => {
      d.fudas.push({ id: "spare", name: "予備の札", color: "#3FB37F", gameNumber: 6 });
    });
    const theirs = editDoc(withSpare, (d) => {
      d.fudas = d.fudas.filter((f) => f.id !== "spare");
    });

    const { result } = run(withSpare, theirs, withSpare);

    expect(fudaIdsOf(result.merged)).toEqual(["s31", "tago", "rengo", "ulithi", "sixth"]);
    expect(result.autoMerged).toContainEqual(
      expect.objectContaining({ location: { kind: "fuda", fudaId: "spare", field: null }, change: "deleted" }),
    );
  });
});

describe("mergeDefinitions・resolveMerge：並び順", () => {
  it("相手だけが札を並べ替え、自分が札を追加したら、相手の順に自分の札を足す", () => {
    const theirs = editDoc(base, (d) => {
      reorderFudas(d, ["sixth", "s31", "tago", "rengo", "ulithi"]);
    });
    const mine = editDoc(base, (d) => {
      d.fudas.push({ id: "kido", name: "機動部隊", color: "#3FB37F", gameNumber: 6 });
    });

    const { result } = run(mine, theirs);

    expect(result.conflicts).toEqual([]);
    expect(fudaIdsOf(result.merged)).toEqual(["sixth", "s31", "tago", "rengo", "ulithi", "kido"]);
    expect(result.autoMerged).toContainEqual(
      expect.objectContaining({ location: { kind: "fudaOrder" }, change: "modified", stageId: null }),
    );
  });

  it("2 人が札を違う順に並べ替えたら衝突（札の並び順）", () => {
    const theirsOrder = ["sixth", "s31", "tago", "rengo", "ulithi"];
    const mineOrder = ["s31", "tago", "rengo", "sixth", "ulithi"];
    const theirs = editDoc(base, (d) => reorderFudas(d, theirsOrder));
    const mine = editDoc(base, (d) => reorderFudas(d, mineOrder));
    const { input, result } = run(mine, theirs);

    const conflict = conflictAt(result.conflicts, { kind: "fudaOrder" });
    expect(conflict).toMatchObject({ label: "札の並び順", stageId: null });

    expect(fudaIdsOf(expectResolved(resolveMerge(input, { [conflict.id]: "theirs" })))).toEqual(theirsOrder);
    expect(fudaIdsOf(expectResolved(resolveMerge(input, { [conflict.id]: "mine" })))).toEqual(mineOrder);
  });

  it("相手だけが海域の中の段階を並べ替えたら、その順を取り込む", () => {
    const theirs = editDoc(base, (d) => reorderArea(d, "E2", ["E2-G", "E2-3", "E2-1", "E2-2"]));
    const mine = editDoc(base, (d) => {
      stageOf(d, "E3-4").importance = "important";
    });

    const { result } = run(mine, theirs);

    expect(result.conflicts).toEqual([]);
    expect(stageIdsOf(result.merged, "E2")).toEqual(["E2-G", "E2-3", "E2-1", "E2-2"]);
    expect(stageOf(result.merged, "E3-4").importance).toBe("important");
    expect(result.autoMerged).toContainEqual(
      expect.objectContaining({ location: { kind: "stageOrder", areaId: "E2" }, change: "modified" }),
    );
  });

  it("2 人が同じ海域の段階を違う順に並べ替えたら衝突（E2 の段階の並び順）", () => {
    const theirsOrder = ["E2-G", "E2-3", "E2-1", "E2-2"];
    const mineOrder = ["E2-2", "E2-G", "E2-1", "E2-3"];
    const theirs = editDoc(base, (d) => reorderArea(d, "E2", theirsOrder));
    const mine = editDoc(base, (d) => reorderArea(d, "E2", mineOrder));
    const { input, result } = run(mine, theirs);

    const conflict = conflictAt(result.conflicts, { kind: "stageOrder", areaId: "E2" });
    expect(conflict).toMatchObject({ label: "E2 の段階の並び順", stageId: null });
    expect(stageIdsOf(result.merged, "E2")).toEqual(mineOrder);

    expect(stageIdsOf(expectResolved(resolveMerge(input, { [conflict.id]: "theirs" })), "E2")).toEqual(theirsOrder);
    expect(stageIdsOf(expectResolved(resolveMerge(input, { [conflict.id]: "mine" })), "E2")).toEqual(mineOrder);
  });

  it("2 人が違う海域の段階を並べ替えたら、両方を取り込む", () => {
    const theirs = editDoc(base, (d) => reorderArea(d, "E2", ["E2-G", "E2-3", "E2-1", "E2-2"]));
    const mine = editDoc(base, (d) => reorderArea(d, "E3", ["E3-4", "E3-G", "E3-1", "E3-2", "E3-3"]));

    const { result } = run(mine, theirs);

    expect(result.conflicts).toEqual([]);
    expect(stageIdsOf(result.merged, "E2")).toEqual(["E2-G", "E2-3", "E2-1", "E2-2"]);
    expect(stageIdsOf(result.merged, "E3")).toEqual(["E3-4", "E3-G", "E3-1", "E3-2", "E3-3"]);
  });

  it("相手が段階を別の海域へ移したら、相手が置いた位置に取り込む", () => {
    // E3 ギミックを E2 の最後へ（配列の位置は E2 ゲージ3 の後ろのまま、海域だけ変える）
    const theirs = editDoc(base, (d) => {
      stageOf(d, "E3-G").areaId = "E2";
    });
    const mine = editDoc(base, (d) => {
      stageOf(d, "E2-3").importance = "important";
    });

    const { result } = run(mine, theirs);

    expect(result.conflicts).toEqual([]);
    expect(stageIdsOf(result.merged, "E2")).toEqual(["E2-G", "E2-1", "E2-2", "E2-3", "E3-G"]);
    expect(stageIdsOf(result.merged, "E3")).toEqual(["E3-1", "E3-2", "E3-3", "E3-4"]);
    expect(stageOf(result.merged, "E2-3").importance).toBe("important");
    expect(result.autoMerged).toContainEqual(
      expect.objectContaining({ location: { kind: "stage", stageId: "E3-G", field: "areaId" }, change: "modified" }),
    );
  });
});
