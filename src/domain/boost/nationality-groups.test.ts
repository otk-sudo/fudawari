// 国籍（・艦種）の条件で効くグループの内訳（nationalityBoostGroups。v1.1「割り振りの特効の行に国籍・艦種の内訳を出す」§1）の単体テスト
//
// その段階で艦に国籍（・艦種）の条件で効くグループのうち、艦名の条件では当てはまらないものを、段階の boosts の順に返す。
// 艦名で当てはまるグループは内訳に出さない（今の表示のまま）。target が null・当てはまるものがなければ空。
// 割り振り画面の開いた艦カード・選んだ艦のパネルの行（boostLines の note）を作るときだけ呼ぶ。
import { describe, expect, it } from "vitest";
import { nationalityBoostGroups } from "@/domain/boost";
import type { BoostGroup, Stage } from "@/domain/definition/types";
import type { BoostNationality, Nationality } from "@/domain/nationality";
import { summer2026Definition, summer2026DefinitionWithUsaDestroyerBoost } from "@/test/fixtures";
import type { BoostTarget } from "./types";

// ---- テストの補助 ----

/** 艦種の番号（api_stype） */
const DD = 2; // 駆逐艦
const CL = 3; // 軽巡洋艦
const BB = 9; // 戦艦

const target = (baseName: string, nationality: Nationality, shipTypeId: number): BoostTarget => ({
  baseName,
  nationality,
  shipTypeId,
});

/** よく使う艦 */
const johnston = target("Johnston", "usa", DD); // 米駆逐
const iowa = target("Iowa", "usa", BB); // 米戦艦
const atlanta = target("Atlanta", "usa", CL); // 米軽巡
const shigure = target("時雨", "japan", DD); // 日本の駆逐
const mystery = target("謎の艦", "unknown", DD); // 国籍の分からない駆逐

/** 特効グループ（国籍・艦種は省略できる） */
const group = (
  id: string,
  multiplier: number,
  shipNames: string[],
  nationalities?: BoostNationality[],
  shipTypes?: number[],
): BoostGroup => ({
  id,
  name: id,
  multiplier,
  shipNames,
  ...(nationalities === undefined ? {} : { nationalities }),
  ...(shipTypes === undefined ? {} : { shipTypes }),
});

const stage = (boosts: BoostGroup[]): Stage => ({ id: "S", areaId: "E1", name: "S", fudaId: "a", importance: "normal", boosts });

/** 返したグループの ID（順のまま） */
const idsOf = (groups: readonly BoostGroup[]): string[] => groups.map((g) => g.id);

describe("nationalityBoostGroups（国籍・艦種の条件で効くグループの内訳）", () => {
  it("国籍・艦種の条件で効くグループを返す（Johnston に「アメリカ・駆逐」）", () => {
    // 準備
    const usdd = group("usdd", 1.2, [], ["usa"], [DD]);
    const s = stage([usdd]);

    // 実行
    const groups = nationalityBoostGroups(s, johnston);

    // 検証：グループの中身（名前・倍率・国籍・艦種）がそのまま分かる
    expect(groups).toEqual([usdd]);
  });

  it("国籍だけ（艦種の条件なし）のグループも返す", () => {
    const s = stage([group("us", 1.1, [], ["usa"])]);

    expect(idsOf(nationalityBoostGroups(s, iowa))).toEqual(["us"]);
    expect(idsOf(nationalityBoostGroups(s, johnston))).toEqual(["us"]);
  });

  it("艦種で外れるグループは入らない（米戦艦・米軽巡に「アメリカ・駆逐」は入らない）", () => {
    const s = stage([group("usdd", 1.2, [], ["usa"], [DD])]);

    expect(nationalityBoostGroups(s, iowa)).toEqual([]);
    expect(nationalityBoostGroups(s, atlanta)).toEqual([]);
  });

  it("国籍で外れるグループは入らない（日本の駆逐艦に「アメリカ・駆逐」は入らない）", () => {
    const s = stage([group("usdd", 1.2, [], ["usa"], [DD])]);

    expect(nationalityBoostGroups(s, shigure)).toEqual([]);
  });

  it("艦名で当てはまるグループは、国籍・艦種でも当てはまっても入らない（今の表示のまま）", () => {
    // 準備：艦名 Johnston と アメリカ・駆逐 の両方を持つグループ
    const s = stage([group("johnston", 1.2, ["Johnston"], ["usa"], [DD])]);

    // 実行・検証：Johnston は艦名で当てはまるので入らない。同じグループに国籍・艦種だけで当てはまる艦は入る
    expect(nationalityBoostGroups(s, johnston)).toEqual([]);
    expect(idsOf(nationalityBoostGroups(s, target("Samuel B.Roberts", "usa", DD)))).toEqual(["johnston"]);
  });

  it("艦名だけのグループは入らない（艦名で当てはまっても内訳には出さない）", () => {
    const s = stage([group("shigure", 1.1, ["時雨"])]);

    expect(nationalityBoostGroups(s, shigure)).toEqual([]);
  });

  it("複数当てはまるときは、段階の boosts の順に返す（艦名のグループ・当てはまらないグループは飛ばす）", () => {
    // 準備：艦種で絞ったグループ → 艦名のグループ → 国籍だけのグループ → 当てはまらないグループ → 艦種を複数持つグループ
    const s = stage([
      group("usdd", 1.2, [], ["usa"], [DD]),
      group("named", 1.05, ["Johnston"]),
      group("us", 1.1, [], ["usa"]),
      group("ukbb", 1.3, [], ["uk"], [BB]),
      group("us-light", 1.15, [], ["usa"], [CL, DD]),
    ]);

    // 実行・検証
    expect(idsOf(nationalityBoostGroups(s, johnston))).toEqual(["usdd", "us", "us-light"]);
    expect(idsOf(nationalityBoostGroups(s, atlanta))).toEqual(["us", "us-light"]);
    expect(idsOf(nationalityBoostGroups(s, iowa))).toEqual(["us"]);
  });

  it("国籍が unknown の艦には、艦種が合っていても入らない", () => {
    const s = stage([group("usdd", 1.2, [], ["usa"], [DD]), group("named", 1.1, ["謎の艦"])]);

    expect(nationalityBoostGroups(s, mystery)).toEqual([]);
  });

  it("target が null なら空", () => {
    const s = stage([group("us", 1.1, [], ["usa"])]);

    expect(nationalityBoostGroups(s, null)).toEqual([]);
  });

  it("特効が未入力の段階・当てはまるものがない段階では空", () => {
    expect(nationalityBoostGroups(stage([]), johnston)).toEqual([]);
    expect(nationalityBoostGroups(stage([group("uk", 1.2, [], ["uk"])]), johnston)).toEqual([]);
  });

  it("同じ段階で艦を変えて続けて呼んでも結果は変わらない（段階の索引を使い回しても正しい）", () => {
    // 準備
    const s = stage([group("usdd", 1.2, [], ["usa"], [DD]), group("us", 1.1, [], ["usa"]), group("jp", 1.1, [], ["japan"])]);
    const targets = [johnston, iowa, shigure, mystery, atlanta, johnston];

    // 実行
    const first = targets.map((t) => idsOf(nationalityBoostGroups(s, t)));
    const second = [...targets]
      .reverse()
      .map((t) => idsOf(nationalityBoostGroups(s, t)))
      .reverse();

    // 検証
    expect(second).toEqual(first);
    expect(first).toEqual([["usdd", "us"], ["us"], ["jp"], [], ["us"], ["usdd", "us"]]);
  });

  describe("テスト用の定義（E2 ゲージ3 に「米駆逐」×1.20 を足したもの）", () => {
    const stageOf = (stageId: string, definition = summer2026DefinitionWithUsaDestroyerBoost): Stage => {
      const found = definition.stages.find((s) => s.id === stageId);
      if (found === undefined) throw new Error(`段階 ${stageId} がありません`);
      return found;
    };

    it("Johnston の E2 ゲージ3 は「米駆逐」のグループ 1 つ（名前・倍率・国籍・艦種が定義のまま）", () => {
      const groups = nationalityBoostGroups(stageOf("E2-3"), johnston);

      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({ name: "米駆逐", multiplier: 1.2, nationalities: ["usa"], shipTypes: [DD] });
    });

    it("日本の駆逐艦（時雨）の E2 ゲージ3 は、艦名のグループで効くだけなので空", () => {
      expect(nationalityBoostGroups(stageOf("E2-3"), shigure)).toEqual([]);
    });

    it("国籍の条件を持たない v1 の定義では、どの段階も空", () => {
      for (const s of summer2026Definition.stages) {
        expect(nationalityBoostGroups(s, shigure), s.id).toEqual([]);
        expect(nationalityBoostGroups(s, johnston), s.id).toEqual([]);
      }
    });
  });
});
