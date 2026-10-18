// テスト用データの追加分：国籍の特効を艦種で絞る（v1.1「国籍の特効を艦種で絞る」）のテスト用
//
// 既存のデータ（summer2026〜・extras・nationality）は、ほかのテストの期待値が隻数や札の数に依存しているため変えない。
// 艦種で絞った国籍の特効を確かめるテストだけが、ここの値を足して使う。
//
// - shipTypeMasterEntries：米駆逐艦 Johnston改（艦 ID は実際の api_start2 の値を借りた。艦型の番号 91〔Fletcher級〕は
//   SHIP_CLASS_NATIONALITIES の usa に合わせた。艦種 2＝駆逐艦。図鑑番号・運の初期値・改造状態はテスト用の値）
//   使い方：createShipMaster([...summer2026MasterEntries, ...nationalityMasterEntries, ...shipTypeMasterEntries])
//   （米戦艦 Iowa改〔艦種 9〕・米駆逐艦 Samuel B.Roberts改〔艦種 2〕は nationalityMasterEntries にある）
// - shipTypeShips：上の艦の個体（個体 ID・Lv は既存の所持艦・国籍の個体と重ならない）。
//   使い方：[...summer2026Ships, ...nationalityShips, ...shipTypeShips]
// - summer2026DefinitionWithUsaDestroyerBoost：2026夏イベの定義の E2 ゲージ3（連合艦隊・難所）に、
//   特効グループ「米駆逐」×1.20（艦名なし・国籍 アメリカ・艦種 駆逐〔shipTypes [2]〕）を最後に足したもの。
//   既存の海域・札・段階・グループはそのまま。
//   米駆逐艦（Johnston改・Samuel B.Roberts改）を連合艦隊に置くと E2 ゲージ3 で ×1.20、スコアは (1.20 − 1) × 100 × 3 = +60。
//   米戦艦（Iowa改）・英艦（Warspite改）・国籍の分からない駆逐艦（謎の艦）はどの札でも特効なし。
//   日本の駆逐艦（時雨改二など）の倍率は元の定義のまま（時雨は E2 ゲージ3 ×1.24 のまま。×1.20 は掛からない）
//
// e2e（Playwright）からも読むので、別名（@/…）は型だけを読み込む
import type { PublicDefinition } from "@/domain/definition/types";
import type { ShipMasterEntry } from "@/domain/master/types";
import type { OwnedShip } from "@/domain/ship/types";
import { deepFreeze } from "./freeze";
import { summer2026Definition } from "./summer2026Definition";

const entries: ShipMasterEntry[] = [
  {
    id: 689,
    name: "Johnston改",
    yomi: "じょんすとん",
    baseName: "Johnston",
    shipTypeId: 2,
    shipClassId: 91,
    shipClassName: "Fletcher級",
    nationality: "usa",
    remodelStage: "final",
    sortNo: 1201,
    luckBase: 12,
  },
];

/** 艦種で絞った国籍の特効のテスト用の艦（凍結済み）。艦 ID は既存の仮マスタ・追加の艦・国籍の艦と重ならない */
export const shipTypeMasterEntries: readonly ShipMasterEntry[] = deepFreeze(entries);

const ships: OwnedShip[] = [
  { uid: "johnston", shipId: 689, level: 127, luck: 52, sallyArea: 0 }, // Johnston改（米・駆逐）
];

/** 艦種で絞った国籍の特効のテスト用の個体（凍結済み）。個体 ID は既存の所持艦・国籍の個体と重ならない */
export const shipTypeShips: readonly OwnedShip[] = deepFreeze(ships);

/** 「米駆逐」グループの ID */
export const USA_DESTROYER_BOOST_GROUP_ID = "E2-3-USDD";

const definitionWithUsaDestroyerBoost: PublicDefinition = {
  ...summer2026Definition,
  stages: summer2026Definition.stages.map((stage) =>
    stage.id === "E2-3"
      ? {
          ...stage,
          boosts: [
            ...stage.boosts,
            {
              id: USA_DESTROYER_BOOST_GROUP_ID,
              name: "米駆逐",
              multiplier: 1.2,
              shipNames: [],
              nationalities: ["usa"],
              shipTypes: [2],
            },
          ],
        }
      : stage,
  ),
};

/**
 * 2026夏イベの定義の E2 ゲージ3 に、特効グループ「米駆逐」×1.20（艦名なし・国籍 アメリカ・艦種 駆逐）を足したもの（凍結済み）。
 * 既存の海域・札・段階・グループの値と順番はそのまま
 */
export const summer2026DefinitionWithUsaDestroyerBoost: PublicDefinition = deepFreeze(definitionWithUsaDestroyerBoost);
