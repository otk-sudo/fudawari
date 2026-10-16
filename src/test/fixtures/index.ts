// 共通のテスト用データの入口（割り振り・一覧・定義の編集など、全レーンで使う）
//
// import { summer2026Definition, summer2026MasterEntries, summer2026Ships } from "@/test/fixtures";
//
// - summer2026Definition／cloneSummer2026Definition()：2026夏イベ（E1〜E3）の公開定義（summer2026Definition.ts）
// - summer2026MasterEntries：仮の艦船マスタの行。createShipMaster(summer2026MasterEntries) で索引にする（shipMaster.ts）
// - summer2026Ships／summer2026Assignments／unknownShip／shipByUid()／createBulkShips()：
//   モックの所持艦 31 隻、一覧の割り当て、マスタにない艦、600 隻以上の個体（ships.ts）
//
// - Mutable<T>：読み取り専用の型を入れ子まで書き換えられる型にする（mutable.ts）。
//   cloneSummer2026Definition() の戻り値の型で、壊した例を作る補助の引数の型にも使う
//
// 共有のデータは凍結してある。書き換えたいテストは複製（clone〜、createBulkShips の戻り値、スプレッド）を使う。
export type { Mutable } from "./mutable";
export { cloneSummer2026Definition, summer2026Definition } from "./summer2026Definition";
export { summer2026MasterEntries } from "./shipMaster";
export {
  createBulkShips,
  shipByUid,
  summer2026Assignments,
  summer2026Ships,
  unknownShip,
} from "./ships";
