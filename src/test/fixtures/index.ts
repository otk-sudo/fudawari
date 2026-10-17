// 共通のテスト用データの入口（割り振り・一覧・定義の編集など、全レーンで使う）
//
// import { summer2026Definition, summer2026MasterEntries, summer2026Ships } from "@/test/fixtures";
//
// - summer2026Definition／cloneSummer2026Definition()：2026夏イベ（E1〜E3）の公開定義（summer2026Definition.ts）
// - summer2026MasterEntries：仮の艦船マスタの行。createShipMaster(summer2026MasterEntries) で索引にする（shipMaster.ts）
// - summer2026Ships／summer2026Assignments／unknownShip／shipByUid()／createBulkShips()：
//   モックの所持艦 31 隻、一覧の割り当て、マスタにない艦、600 隻以上の個体（ships.ts）
//
// - extraMasterEntries／extraShips／summer2026DefinitionWithExtraFudas：既存のデータに足りない艦種・札の追加分
//   （重巡・海防・装甲空母・潜水空母・練巡・艦種 8 の戦艦・伊勢型の戦艦、未使用の札、札番号のない札）。
//   既存のデータには混ぜていないので、必要なテストだけが足して使う（extras.ts）
//
// - nationalityMasterEntries／nationalityShips／summer2026DefinitionWithUsaBoost／USA_BOOST_GROUP_ID：国籍の特効（v1.1）の
//   テスト用の海外艦・国籍の分からない艦と、E2 ゲージ3 に「米艦」×1.20（国籍 アメリカ）を足した定義（nationality.ts）。
//   既存のデータには混ぜていない
//
// - shipTypeMasterEntries／shipTypeShips／summer2026DefinitionWithUsaDestroyerBoost／USA_DESTROYER_BOOST_GROUP_ID：
//   国籍の特効を艦種で絞る（v1.1）のテスト用の米駆逐艦 Johnston改と、E2 ゲージ3 に「米駆逐」×1.20
//   （国籍 アメリカ・艦種 駆逐）を足した定義（shipType.ts）。既存のデータには混ぜていない
//
// - Mutable<T>：読み取り専用の型を入れ子まで書き換えられる型にする（mutable.ts）。
//   cloneSummer2026Definition() の戻り値の型で、壊した例を作る補助の引数の型にも使う
//
// 共有のデータは凍結してある。書き換えたいテストは複製（clone〜、createBulkShips の戻り値、スプレッド）を使う。
export type { Mutable } from "./mutable";
export { cloneSummer2026Definition, summer2026Definition } from "./summer2026Definition";
export { summer2026MasterEntries } from "./shipMaster";
export { extraMasterEntries, extraShips, summer2026DefinitionWithExtraFudas } from "./extras";
export {
  nationalityMasterEntries,
  nationalityShips,
  summer2026DefinitionWithUsaBoost,
  USA_BOOST_GROUP_ID,
} from "./nationality";
export {
  shipTypeMasterEntries,
  shipTypeShips,
  summer2026DefinitionWithUsaDestroyerBoost,
  USA_DESTROYER_BOOST_GROUP_ID,
} from "./shipType";
export {
  createBulkShips,
  shipByUid,
  summer2026Assignments,
  summer2026Ships,
  unknownShip,
} from "./ships";
