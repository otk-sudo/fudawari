// テスト用データの追加分：国籍の特効（v1.1「特効グループに国籍の条件を足す」）のテスト用
//
// 既存のデータ（summer2026〜・extras）は、ほかのテストの期待値が隻数や札の数に依存しているため変えない。
// 国籍の特効を確かめるテストだけが、ここの値を足して使う。
//
// - nationalityMasterEntries：海外艦と国籍の分からない艦。艦 ID は実際の api_start2 の値を借りたが、
//   艦種・艦型の番号・図鑑番号・運の初期値・改造状態はテスト用の値（艦型の番号は SHIP_CLASS_NATIONALITIES の対応に合わせた）。
//   - Iowa改（米・艦型 65）、Samuel B.Roberts改（米・艦型 87）、Warspite改（英・艦型 67）
//   - 謎の艦（国籍 unknown。艦名の条件には当てはまるが、国籍の条件には当てはまらない例）
//   使い方：createShipMaster([...summer2026MasterEntries, ...nationalityMasterEntries])
// - nationalityShips：上の艦の個体（個体 ID は既存の所持艦と重ならない。Lv は既存の艦と重ならない値）。
//   使い方：[...summer2026Ships, ...nationalityShips]
// - summer2026DefinitionWithUsaBoost：2026夏イベの定義の E2 ゲージ3（連合艦隊・難所）に、
//   特効グループ「米艦」×1.20（艦名なし・国籍 アメリカ）を最後に足したもの。既存の海域・札・段階・グループはそのまま。
//   米艦（Iowa改・Samuel B.Roberts改）を連合艦隊に置くと E2 ゲージ3 で ×1.20、スコアは (1.20 − 1) × 100 × 3 = +60。
//   英艦（Warspite改）・国籍の分からない艦（謎の艦）はどの札でも特効なし
//
// e2e（Playwright）からも読むので、別名（@/…）は型だけを読み込む
import type { PublicDefinition } from "@/domain/definition/types";
import type { RemodelStage, ShipMasterEntry } from "@/domain/master/types";
import type { Nationality } from "@/domain/nationality";
import type { OwnedShip } from "@/domain/ship/types";
import { deepFreeze } from "./freeze";
import { summer2026Definition } from "./summer2026Definition";

function entry(fields: {
  id: number;
  name: string;
  baseName: string;
  yomi: string;
  shipTypeId: number;
  shipClassId: number;
  shipClassName: string;
  nationality: Nationality;
  remodelStage: RemodelStage;
  sortNo: number;
  luckBase: number;
}): ShipMasterEntry {
  return { ...fields };
}

const entries: ShipMasterEntry[] = [
  entry({ id: 440, name: "Iowa改", baseName: "Iowa", yomi: "あいおわ", shipTypeId: 9, shipClassId: 65, shipClassName: "Iowa級", nationality: "usa", remodelStage: "final", sortNo: 1101, luckBase: 30 }),
  entry({ id: 681, name: "Samuel B.Roberts改", baseName: "Samuel B.Roberts", yomi: "さみゅえる・びー・ろばーつ", shipTypeId: 2, shipClassId: 87, shipClassName: "John C.Butler級", nationality: "usa", remodelStage: "intermediate", sortNo: 1102, luckBase: 40 }),
  entry({ id: 364, name: "Warspite改", baseName: "Warspite", yomi: "うぉーすぱいと", shipTypeId: 9, shipClassId: 67, shipClassName: "Queen Elizabeth級", nationality: "uk", remodelStage: "final", sortNo: 1103, luckBase: 10 }),
  entry({ id: 1499, name: "謎の艦", baseName: "謎の艦", yomi: "なぞのかん", shipTypeId: 2, shipClassId: 999, shipClassName: "謎の艦型", nationality: "unknown", remodelStage: "unremodeled", sortNo: 1104, luckBase: 10 }),
];

/** 国籍の特効のテスト用の艦（凍結済み）。艦 ID は summer2026MasterEntries・extraMasterEntries と重ならない */
export const nationalityMasterEntries: readonly ShipMasterEntry[] = deepFreeze(entries);

function ship(uid: string, shipId: number, level: number, luck: number): OwnedShip {
  return { uid, shipId, level, luck, sallyArea: 0 };
}

const ships: OwnedShip[] = [
  ship("iowa", 440, 161, 45), // Iowa改（米・戦艦）
  ship("sbr", 681, 117, 70), // Samuel B.Roberts改（米・駆逐）
  ship("warspite", 364, 141, 33), // Warspite改（英・戦艦）
  ship("mystery", 1499, 61, 11), // 謎の艦（国籍 unknown）
];

/** 国籍の特効のテスト用の個体（凍結済み）。個体 ID は summer2026Ships・extraShips と重ならない */
export const nationalityShips: readonly OwnedShip[] = deepFreeze(ships);

/** 「米艦」グループの ID */
export const USA_BOOST_GROUP_ID = "E2-3-US";

const definitionWithUsaBoost: PublicDefinition = {
  ...summer2026Definition,
  stages: summer2026Definition.stages.map((stage) =>
    stage.id === "E2-3"
      ? {
          ...stage,
          boosts: [
            ...stage.boosts,
            { id: USA_BOOST_GROUP_ID, name: "米艦", multiplier: 1.2, shipNames: [], nationalities: ["usa"] },
          ],
        }
      : stage,
  ),
};

/**
 * 2026夏イベの定義の E2 ゲージ3 に、特効グループ「米艦」×1.20（艦名なし・国籍 アメリカ）を足したもの（凍結済み）。
 * 既存の海域・札・段階・グループの値と順番はそのまま
 */
export const summer2026DefinitionWithUsaBoost: PublicDefinition = deepFreeze(definitionWithUsaBoost);
