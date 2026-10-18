// 割り振り画面の段階の倍率の行（boostLines）の内訳の文（note。v1.1「割り振りの特効の行に国籍・艦種の内訳を出す」§2）の単体テスト
//
// その段階で国籍（・艦種）の条件で効くグループ（艦名では当てはまらないもの）があれば、note に内訳の文を入れる。なければ null。
// - グループごとに「{グループ名}（{条件}）」、複数は「、」でつなぐ（段階の boosts の順）
// - 条件：国籍の表示名を「・」でつなぎ、艦種があれば続けて「・」＋艦種の表示名（shipTypeOptionLabelsOf の順）を「・」でつなぐ
// - グループ名が空なら条件だけ
// - その行の倍率とグループの倍率が違う（ほかのグループと掛け合わせている）ときだけ、グループ名の後に倍率「米艦 ×1.20（アメリカ）」
//
// 前提（仕様に書いていないため、このテストで置いた前提）
// - boostLines は 4 つ目の引数に照合の対象（BoostTarget | null。個体からは shipEntryOf の info を known のときだけ）を取る
//
// テスト用データ
// - 定義：2026夏イベの E2 ゲージ3（連合艦隊・難所）に「米駆逐」×1.20（国籍 アメリカ・艦種 駆逐）を足したもの（shipType.ts）、
//   「米艦」×1.20（国籍 アメリカ）を足したもの（nationality.ts）。掛け合わせなどはこのファイルの中でさらにグループを足す
// - マスタ：仮マスタ ＋ 国籍の艦（Iowa改〔米戦艦〕・Samuel B.Roberts改〔米駆逐〕など）＋ Johnston改（米駆逐）
import { describe, expect, it } from "vitest";
import type { BoostTarget } from "@/domain/boost/types";
import type { BoostGroup, PublicDefinition } from "@/domain/definition/types";
import { createShipMaster } from "@/domain/master";
import type { OwnedShip } from "@/domain/ship/types";
import {
  nationalityMasterEntries,
  nationalityShips,
  shipByUid,
  shipTypeMasterEntries,
  shipTypeShips,
  summer2026Definition,
  summer2026DefinitionWithUsaBoost,
  summer2026DefinitionWithUsaDestroyerBoost,
  summer2026MasterEntries,
} from "@/test/fixtures";
import { type BoostLine, boostLines, fudaMapOf, shipEntryOf } from "./ship-view";

// ---- テストの補助 ----

const master = createShipMaster([...summer2026MasterEntries, ...nationalityMasterEntries, ...shipTypeMasterEntries]);

/** 個体（モックの所持艦・国籍の艦・Johnston改） */
function shipOf(uid: string): OwnedShip {
  const found = [...nationalityShips, ...shipTypeShips].find((s) => s.uid === uid);
  return found ?? shipByUid(uid);
}

/** 段階に特効グループを足した定義（ほかの段階・グループはそのまま） */
function withGroups(definition: PublicDefinition, stageId: string, groups: BoostGroup[]): PublicDefinition {
  return {
    ...definition,
    stages: definition.stages.map((stage) =>
      stage.id === stageId ? { ...stage, boosts: [...stage.boosts, ...groups] } : stage,
    ),
  };
}

/** 個体の効く札すべての行（画面と同じく、照合の対象はマスタで引いた info を known のときだけ渡す） */
function linesOf(definition: PublicDefinition, uid: string): BoostLine[] {
  const entry = shipEntryOf(definition, master, shipOf(uid));
  const target: BoostTarget | null = entry.info.known ? entry.info : null;
  return boostLines(definition, fudaMapOf(definition), entry.boost.effective, target);
}

/** 行を [段階の表示名, 倍率（小数第 2 位）, 内訳の文] の形にして比べやすくする */
function compact(lines: readonly BoostLine[]): [string, number, string | null][] {
  return lines.map((line) => [line.label, Math.round(line.multiplier * 100) / 100, line.note]);
}

const ddDef = summer2026DefinitionWithUsaDestroyerBoost;

describe("段階の倍率の行の内訳の文（boostLines の note）", () => {
  it("国籍・艦種のグループ 1 つだけで効く行は「米駆逐（アメリカ・駆逐）」（倍率は付けない）", () => {
    // 準備・実行：Johnston改 は E2 ゲージ3 で「米駆逐」×1.20 だけが効く
    const lines = linesOf(ddDef, "johnston");

    // 検証
    expect(compact(lines)).toEqual([["E2 ゲージ3", 1.2, "米駆逐（アメリカ・駆逐）"]]);
  });

  it("国籍だけのグループで効く行は「米艦（アメリカ）」", () => {
    // 準備・実行：Iowa改 は E2 ゲージ3 で「米艦」×1.20（国籍 アメリカ・艦種の条件なし）が効く
    const lines = linesOf(summer2026DefinitionWithUsaBoost, "iowa");

    // 検証
    expect(compact(lines)).toEqual([["E2 ゲージ3", 1.2, "米艦（アメリカ）"]]);
  });

  it("グループ名が空なら、条件だけ「アメリカ・駆逐」（「（名前なし）」とは書かない）", () => {
    // 準備
    const def = withGroups(summer2026Definition, "E2-3", [
      { id: "nameless", name: "", multiplier: 1.2, shipNames: [], nationalities: ["usa"], shipTypes: [2] },
    ]);

    // 実行
    const lines = linesOf(def, "johnston");

    // 検証
    expect(compact(lines)).toEqual([["E2 ゲージ3", 1.2, "アメリカ・駆逐"]]);
  });

  it("国籍・艦種を複数持つグループの条件は、国籍の表示名のあとに艦種の表示名（選択肢の順）を「・」でつなぐ", () => {
    // 準備：国籍 アメリカ・イギリス、艦種 駆逐〔2〕・軽巡〔3〕。艦種の表示名は shipTypeOptionLabelsOf の順（軽巡 → 駆逐）
    const def = withGroups(summer2026Definition, "E2-3", [
      { id: "allied", name: "連合国", multiplier: 1.2, shipNames: [], nationalities: ["usa", "uk"], shipTypes: [2, 3] },
    ]);

    // 実行
    const lines = linesOf(def, "johnston");

    // 検証
    expect(compact(lines)).toEqual([["E2 ゲージ3", 1.2, "連合国（アメリカ・イギリス・軽巡・駆逐）"]]);
  });

  it("国籍・艦種のグループを 2 つ掛け合わせた行は、どちらにもグループの倍率を付けて「、」でつなぐ（段階の boosts の順）", () => {
    // 準備：E2 ゲージ3 に「米駆逐」×1.20 に続けて「米艦」×1.10（国籍 アメリカ）を足す
    const def = withGroups(ddDef, "E2-3", [
      { id: "us", name: "米艦", multiplier: 1.1, shipNames: [], nationalities: ["usa"] },
    ]);

    // 実行
    const johnston = linesOf(def, "johnston");
    const iowa = linesOf(def, "iowa");

    // 検証：Johnston改 は ×1.20 × ×1.10 ＝ ×1.32。Iowa改（戦艦）は「米艦」だけなので倍率を付けない
    expect(compact(johnston)).toEqual([["E2 ゲージ3", 1.32, "米駆逐 ×1.20（アメリカ・駆逐）、米艦 ×1.10（アメリカ）"]]);
    expect(compact(iowa)).toEqual([["E2 ゲージ3", 1.1, "米艦（アメリカ）"]]);
  });

  it("艦名のグループと掛け合わせた行は、国籍・艦種のグループにだけ倍率を付ける（艦名のグループは内訳に出さない）", () => {
    // 準備：E2 ゲージ3 に艦名「Johnston」×1.05 を足す
    const def = withGroups(ddDef, "E2-3", [{ id: "named", name: "フレッチャー級", multiplier: 1.05, shipNames: ["Johnston"] }]);

    // 実行
    const johnston = linesOf(def, "johnston");
    const sbr = linesOf(def, "sbr");

    // 検証：Johnston改 は ×1.20 × ×1.05 ＝ ×1.26。Samuel B.Roberts改 は艦名で当てはまらないので「米駆逐」だけ
    expect(compact(johnston)).toEqual([["E2 ゲージ3", 1.26, "米駆逐 ×1.20（アメリカ・駆逐）"]]);
    expect(compact(sbr)).toEqual([["E2 ゲージ3", 1.2, "米駆逐（アメリカ・駆逐）"]]);
  });

  it("艦名だけで効く行は null（日本の駆逐艦〔時雨改二〕は米駆逐のグループを足した定義でも、どの行も null）", () => {
    // 準備・実行
    const lines = linesOf(ddDef, "shigure2");

    // 検証：行はあるが、どれも内訳なし
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.map((line) => line.note)).toEqual(lines.map(() => null));
  });

  it("同じ艦でも、行ごとに決める（艦名だけで効く E2 ゲージ2 は null、米駆逐の E2 ゲージ3 は内訳）", () => {
    // 準備：E2 ゲージ2（連合艦隊）に艦名「Johnston」×1.10 を足す
    const def = withGroups(ddDef, "E2-2", [{ id: "named", name: "フレッチャー級", multiplier: 1.1, shipNames: ["Johnston"] }]);

    // 実行
    const lines = linesOf(def, "johnston");

    // 検証
    expect(compact(lines)).toEqual([
      ["E2 ゲージ2", 1.1, null],
      ["E2 ゲージ3", 1.2, "米駆逐（アメリカ・駆逐）"],
    ]);
  });

  it("1 つのグループで艦名と国籍・艦種の両方に当てはまる艦は、艦名で効くので null", () => {
    // 準備：E2 ゲージ3 の「米駆逐」の代わりに、艦名「Johnston」も持つ「米駆逐」を足す
    const def = withGroups(summer2026Definition, "E2-3", [
      { id: "usdd", name: "米駆逐", multiplier: 1.2, shipNames: ["Johnston"], nationalities: ["usa"], shipTypes: [2] },
    ]);

    // 実行・検証：Johnston改 は艦名で当てはまるので null、Samuel B.Roberts改 は国籍・艦種で当てはまるので内訳
    expect(compact(linesOf(def, "johnston"))).toEqual([["E2 ゲージ3", 1.2, null]]);
    expect(compact(linesOf(def, "sbr"))).toEqual([["E2 ゲージ3", 1.2, "米駆逐（アメリカ・駆逐）"]]);
  });

  it("照合の対象が null なら、どの行も null", () => {
    // 準備：Johnston改 の特効のまとめ
    const entry = shipEntryOf(ddDef, master, shipOf("johnston"));

    // 実行
    const lines = boostLines(ddDef, fudaMapOf(ddDef), entry.boost.effective, null);

    // 検証
    expect(compact(lines)).toEqual([["E2 ゲージ3", 1.2, null]]);
  });
});
