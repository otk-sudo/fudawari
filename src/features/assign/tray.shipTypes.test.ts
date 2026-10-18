// 割り振り画面の控えの絞り込み・並び順（buildTray）で、艦種で絞った国籍の特効グループ（アメリカ・駆逐 ×1.20）が
// 「特効のある艦だけ」「特効が効く札」「特効の強さ」に入ることの単体テスト
// （v1.1「割り振りの特効の行に国籍・艦種の内訳を出す」§0・§4。判定は特効の計算〔@/domain/boost〕の結果を使う）
//
// テスト用データ
// - 定義：2026夏イベの E2 ゲージ3（連合艦隊・難所）に「米駆逐」×1.20（艦名なし・国籍 アメリカ・艦種 駆逐）を足したもの
// - マスタ：仮マスタ ＋ 国籍の艦（Iowa改〔米戦艦〕・Samuel B.Roberts改〔米駆逐〕・Warspite改〔英戦艦〕・謎の艦〔国籍不明の駆逐〕）
//   ＋ Johnston改（米駆逐）
// - 艦：モックの所持艦 31 隻 ＋ 国籍の 4 隻 ＋ Johnston改。割り当ては一覧の割り当て（国籍の艦と Johnston改 は控え）
// - 米駆逐艦（Johnston改・Samuel B.Roberts改）は連合艦隊 +60 だけ。米戦艦・英戦艦・謎の艦はどの札でも特効なし
import { describe, expect, it } from "vitest";
import type { PublicDefinition } from "@/domain/definition/types";
import { createShipMaster } from "@/domain/master";
import {
  nationalityMasterEntries,
  nationalityShips,
  shipTypeMasterEntries,
  shipTypeShips,
  summer2026Assignments,
  summer2026Definition,
  summer2026DefinitionWithUsaDestroyerBoost,
  summer2026MasterEntries,
  summer2026Ships,
} from "@/test/fixtures";
import { buildTray, type TrayOptions, type TrayResult } from "./tray";

// ---- テストの補助 ----

const master = createShipMaster([...summer2026MasterEntries, ...nationalityMasterEntries, ...shipTypeMasterEntries]);
const ships = [...summer2026Ships, ...nationalityShips, ...shipTypeShips];

/** 米駆逐艦 */
const US_DESTROYERS = ["johnston", "sbr"];
/** 米駆逐のグループに当てはまらない艦（米戦艦・英戦艦・国籍の分からない駆逐艦） */
const NOT_US_DESTROYERS = ["iowa", "warspite", "mystery"];

/** 条件をすべて外した状態（すべて表示・並び順は艦型） */
const NO_FILTER: TrayOptions = {
  query: "",
  tab: "all",
  remodelStages: { unremodeled: true, intermediate: true, final: true },
  boostOnly: false,
  fudaIds: [],
  sort: "class",
  view: "dense",
};

function tray(patch: Partial<TrayOptions>, definition: PublicDefinition = summer2026DefinitionWithUsaDestroyerBoost): TrayResult {
  return buildTray({ definition, master, ships, assignments: summer2026Assignments, options: { ...NO_FILTER, ...patch } });
}

function shownUids(result: TrayResult): string[] {
  return result.groups.flatMap((g) => g.entries.map((e) => e.ship.uid));
}

describe("控え：艦種で絞った国籍の特効グループ（アメリカ・駆逐 ×1.20）", () => {
  it("「特効のある艦だけ」に米駆逐艦は残り、米戦艦・英戦艦・国籍の分からない駆逐艦は外れる", () => {
    // 準備・実行
    const shown = shownUids(tray({ boostOnly: true }));

    // 検証
    expect(shown).toEqual(expect.arrayContaining(US_DESTROYERS));
    for (const uid of NOT_US_DESTROYERS) expect(shown, uid).not.toContain(uid);
  });

  it("米駆逐のグループのない定義では、米駆逐艦も「特効のある艦だけ」で外れる（グループの有無で決まる）", () => {
    const shown = shownUids(tray({ boostOnly: true }, summer2026Definition));

    for (const uid of [...US_DESTROYERS, ...NOT_US_DESTROYERS]) expect(shown, uid).not.toContain(uid);
  });

  it("「特効が効く札」で連合艦隊を選ぶと米駆逐艦は残り、米戦艦などは外れる", () => {
    const shown = shownUids(tray({ fudaIds: ["rengo"] }));

    expect(shown).toEqual(expect.arrayContaining(US_DESTROYERS));
    for (const uid of NOT_US_DESTROYERS) expect(shown, uid).not.toContain(uid);
  });

  it("「特効が効く札」で連合艦隊以外の札だけを選ぶと、米駆逐艦は外れる", () => {
    const shown = shownUids(tray({ fudaIds: ["s31", "tago", "ulithi", "sixth"] }));

    for (const uid of US_DESTROYERS) expect(shown, uid).not.toContain(uid);
  });

  it("並び順「特効の強さ」で、米駆逐艦は「連合艦隊で効く」に入り（スコアの順）、米戦艦などは最後の「特効なし」に入る", () => {
    // 準備・実行
    const result = tray({ sort: "boost" });

    // 検証：区切りの所属
    const rengo = result.groups.find((g) => g.title === "連合艦隊で効く");
    const none = result.groups.find((g) => g.title === "特効なし");
    expect(rengo?.entries.map((e) => e.ship.uid)).toEqual(expect.arrayContaining(US_DESTROYERS));
    expect(none?.entries.map((e) => e.ship.uid)).toEqual(expect.arrayContaining(NOT_US_DESTROYERS));
    expect(result.groups.at(-1)?.title).toBe("特効なし");

    // 検証：連合艦隊で効く艦はスコアの高い順で、米駆逐艦のスコアは +60
    const scores = rengo?.entries.map((e) => e.boost.effective[0]?.score ?? 0) ?? [];
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    for (const entry of rengo?.entries.filter((e) => US_DESTROYERS.includes(e.ship.uid)) ?? []) {
      expect(entry.boost.effective[0]?.score, entry.ship.uid).toBe(60);
    }

    // 検証：米駆逐艦は米戦艦より前
    const shown = shownUids(result);
    for (const uid of US_DESTROYERS) expect(shown.indexOf(uid), uid).toBeLessThan(shown.indexOf("iowa"));
  });
});
