// 公開定義の型が深く読み取り専用であることのテスト（PR-02b）
//
// 特効の計算（boost.ts）は、定義・段階のオブジェクトをキーに索引を WeakMap に覚えている。
// 定義をその場で書き換えると古い索引が使われ、誤ったスコア・ラベル・隻数を返す。
// そのため公開定義は、型で書き換えを禁じ（readonly・readonly T[]）、検証後の値は実行時にも凍結する。
//
// 確かめ方
// - 型：各書き換えの直前の `// @ts-expect-error` が、その行が型の誤りであることを確かめる（npm run typecheck）。
//   型が書き換えられるままだと、この指示が「不要」（TS2578）として typecheck が失敗する。
// - 実行時：検証を通った定義（validatePublicDefinition の値）に同じ書き換えをすると、
//   凍結しているので TypeError になり（テストのファイルは strict モード）、値は変わらない。
import { describe, expect, it } from "vitest";
import { cloneSummer2026Definition, summer2026Definition } from "@/test/fixtures";
import type { Area, BoostGroup, EventInfo, Fuda, PublicDefinition, Stage } from "./types";
import { validatePublicDefinition } from "./validate";

/** テスト用の定義を検証して、検証後の値を返す */
function validatedDefinition(): PublicDefinition {
  const result = validatePublicDefinition(cloneSummer2026Definition());
  if (!result.ok) throw new Error("テスト用の定義が検証を通りません");
  return result.value;
}

describe("公開定義の型は深く読み取り専用（書き換えは型の誤りで、検証後の値は実行時も書き換えられない）", () => {
  it.each<[string, (def: PublicDefinition) => void]>([
    // ---- 定義（PublicDefinition）の項目と配列 ----
    [
      "形式の版を書き換える",
      (def) => {
        // @ts-expect-error schemaVersion は readonly
        def.schemaVersion = 1;
      },
    ],
    [
      "イベント情報を差し替える",
      (def) => {
        // @ts-expect-error event は readonly
        def.event = { ...def.event };
      },
    ],
    [
      "段階の配列を差し替える",
      (def) => {
        // @ts-expect-error stages は readonly
        def.stages = [];
      },
    ],
    [
      "段階の配列に段階を足す",
      (def) => {
        // @ts-expect-error 段階の配列は readonly Stage[] なので push がない
        def.stages.push({ ...def.stages[0], id: "extra" });
      },
    ],
    [
      "海域の配列の要素を差し替える",
      (def) => {
        // @ts-expect-error 海域の配列は readonly Area[] なので要素に代入できない
        def.areas[0] = { id: "E9", name: "E9" };
      },
    ],
    [
      "札の配列をその場で並べ替える",
      (def) => {
        // @ts-expect-error 札の配列は readonly Fuda[] なので reverse がない
        def.fudas.reverse();
      },
    ],
    // ---- 定義からたどった入れ子の項目と配列 ----
    [
      "イベント名を書き換える（def.event.name）",
      (def) => {
        // @ts-expect-error EventInfo の name は readonly
        def.event.name = "書き換え";
      },
    ],
    [
      "海域名を書き換える（def.areas[0].name）",
      (def) => {
        // @ts-expect-error Area の name は readonly
        def.areas[0].name = "書き換え";
      },
    ],
    [
      "札の色を書き換える（def.fudas[0].color）",
      (def) => {
        // @ts-expect-error Fuda の color は readonly
        def.fudas[0].color = "#000000";
      },
    ],
    [
      "段階名を書き換える（def.stages[0].name）",
      (def) => {
        // @ts-expect-error Stage の name は readonly
        def.stages[0].name = "書き換え";
      },
    ],
    [
      "段階の札を書き換える（def.stages[0].fudaId）",
      (def) => {
        // @ts-expect-error Stage の fudaId は readonly
        def.stages[0].fudaId = "rengo";
      },
    ],
    [
      "段階に特効グループを足す（def.stages[0].boosts.push）",
      (def) => {
        // @ts-expect-error 特効グループの配列は readonly BoostGroup[] なので push がない
        def.stages[0].boosts.push({ ...def.stages[0].boosts[0], id: "extra" });
      },
    ],
    [
      "倍率を書き換える（def.stages[0].boosts[0].multiplier）",
      (def) => {
        // @ts-expect-error BoostGroup の multiplier は readonly
        def.stages[0].boosts[0].multiplier = 2;
      },
    ],
    [
      "艦名を足す（def.stages[0].boosts[0].shipNames.push）",
      (def) => {
        // @ts-expect-error 艦名の配列は readonly string[] なので push がない
        def.stages[0].boosts[0].shipNames.push("時雨");
      },
    ],
    [
      "艦名の要素を書き換える（def.stages[0].boosts[0].shipNames[0]）",
      (def) => {
        // @ts-expect-error 艦名の配列は readonly string[] なので要素に代入できない
        def.stages[0].boosts[0].shipNames[0] = "時雨";
      },
    ],
    // ---- 型の名前で受け取った値（段階や特効グループだけを受け取る関数でも書き換えられない） ----
    [
      "EventInfo として受け取った終了日時を書き換える",
      (def) => {
        const event: EventInfo = def.event;
        // @ts-expect-error EventInfo の endAt は readonly
        event.endAt = "2026-10-31T11:00:00+09:00";
      },
    ],
    [
      "Area として受け取った ID を書き換える",
      (def) => {
        const area: Area = def.areas[0];
        // @ts-expect-error Area の id は readonly
        area.id = "E9";
      },
    ],
    [
      "Fuda として受け取ったゲーム内の札番号を書き換える",
      (def) => {
        const fuda: Fuda = def.fudas[0];
        // @ts-expect-error Fuda の gameNumber は readonly
        fuda.gameNumber = 9;
      },
    ],
    [
      "Stage として受け取った大事さを書き換える",
      (def) => {
        const stage: Stage = def.stages[0];
        // @ts-expect-error Stage の importance は readonly
        stage.importance = "hard";
      },
    ],
    [
      "Stage として受け取った特効グループの配列を差し替える",
      (def) => {
        const stage: Stage = def.stages[0];
        // @ts-expect-error Stage の boosts は readonly
        stage.boosts = [];
      },
    ],
    [
      "BoostGroup として受け取った艦名の配列に足す",
      (def) => {
        const group: BoostGroup = def.stages[0].boosts[0];
        // @ts-expect-error BoostGroup の shipNames は readonly string[] なので push がない
        group.shipNames.push("時雨");
      },
    ],
  ])("%s：型の誤りになり、検証後の定義では TypeError で値も変わらない", (_label, mutate) => {
    // 準備
    const def = validatedDefinition();

    // 実行・検証
    expect(() => mutate(def)).toThrow(TypeError);
    expect(def).toEqual(summer2026Definition);
  });
});
