// テスト用データの追加分：既存のデータ（summer2026〜）に足りない艦種・札（docs/plan-v1.md「後続の対応一覧」PR-02 レビュー 11）
//
// 既存のデータ（summer2026MasterEntries・summer2026Ships・summer2026Definition）は、ほかのテストの期待値が
// 隻数や札の数に依存しているため変えない。足りないものは、ここに別の値として持ち、必要なテストだけが足して使う。
//
// - extraMasterEntries：仮マスタに足りない艦種の艦（重巡・海防・装甲空母・潜水空母・練巡、艦種 8 の戦艦、
//   艦型が 2 つの艦種にまたがる例〔伊勢型：伊勢＝戦艦、既存の日向改二＝航空戦艦〕）。
//   艦 ID は実際の api_start2 の値を借りたが、艦種・艦型の番号・図鑑番号・運の初期値・改造状態はテスト用の値。
//   使い方：createShipMaster([...summer2026MasterEntries, ...extraMasterEntries])
// - extraShips：上の艦の個体（Lv は既存の控えの艦と重ならない値にした。並び順のテストで順番が決まるように）。
//   使い方：[...summer2026Ships, ...extraShips]
// - summer2026DefinitionWithExtraFudas：2026夏イベの定義に「どの段階にも使われない札」と
//   「ゲーム内の札番号のない札（E4 ゲージ1 で使う）」を足したもの。既存の札・段階はそのまま
//
// 特効（summer2026Definition で）
// - 妙高改二・鹿島改・榛名改二・伊勢：連合艦隊A に入っている（連合艦隊・ウルシー攻撃部隊で効く）
// - 占守改・大鳳改・伊401改：どの特効グループにも入っていない（特効なし）
import type { PublicDefinition } from "@/domain/definition/types";
import type { RemodelStage, ShipMasterEntry } from "@/domain/master/types";
import type { OwnedShip } from "@/domain/ship/types";
import { deepFreeze } from "./freeze";
import { summer2026Definition } from "./summer2026Definition";

interface ShipClass {
  shipClassId: number;
  shipClassName: string;
}

// 伊勢型は既存の仮マスタ（日向改二）と同じ番号・名前にする
const 伊勢型: ShipClass = { shipClassId: 2, shipClassName: "伊勢型" };
const 金剛型: ShipClass = { shipClassId: 6, shipClassName: "金剛型" };
const 妙高型: ShipClass = { shipClassId: 29, shipClassName: "妙高型" };
const 大鳳型: ShipClass = { shipClassId: 43, shipClassName: "大鳳型" };
const 香取型: ShipClass = { shipClassId: 56, shipClassName: "香取型" };
const 占守型: ShipClass = { shipClassId: 74, shipClassName: "占守型" };
const 巡潜甲型改二: ShipClass = { shipClassId: 44, shipClassName: "巡潜甲型改二" };

function entry(fields: {
  id: number;
  name: string;
  baseName: string;
  yomi: string;
  shipTypeId: number;
  shipClass: ShipClass;
  remodelStage: RemodelStage;
  sortNo: number;
  luckBase: number;
}): ShipMasterEntry {
  const { shipClass, ...rest } = fields;
  return { ...rest, ...shipClass };
}

const entries: ShipMasterEntry[] = [
  // 艦種の番号は api_mst_stype（5 重巡洋艦、1 海防艦、18 装甲空母、14 潜水空母、21 練習巡洋艦、8・9 戦艦）
  entry({ id: 319, name: "妙高改二", baseName: "妙高", yomi: "みょうこう", shipTypeId: 5, shipClass: 妙高型, remodelStage: "final", sortNo: 1038, luckBase: 10 }),
  entry({ id: 376, name: "占守改", baseName: "占守", yomi: "しむしゅ", shipTypeId: 1, shipClass: 占守型, remodelStage: "final", sortNo: 1039, luckBase: 40 }),
  entry({ id: 156, name: "大鳳改", baseName: "大鳳", yomi: "たいほう", shipTypeId: 18, shipClass: 大鳳型, remodelStage: "final", sortNo: 1040, luckBase: 4 }),
  entry({ id: 155, name: "伊401改", baseName: "伊401", yomi: "い401", shipTypeId: 14, shipClass: 巡潜甲型改二, remodelStage: "final", sortNo: 1041, luckBase: 20 }),
  entry({ id: 357, name: "鹿島改", baseName: "鹿島", yomi: "かしま", shipTypeId: 21, shipClass: 香取型, remodelStage: "final", sortNo: 1042, luckBase: 12 }),
  entry({ id: 151, name: "榛名改二", baseName: "榛名", yomi: "はるな", shipTypeId: 8, shipClass: 金剛型, remodelStage: "final", sortNo: 1043, luckBase: 15 }),
  entry({ id: 77, name: "伊勢", baseName: "伊勢", yomi: "いせ", shipTypeId: 9, shipClass: 伊勢型, remodelStage: "unremodeled", sortNo: 1044, luckBase: 30 }),
];

/** 仮マスタに足す艦（凍結済み）。艦 ID は summer2026MasterEntries と重ならない */
export const extraMasterEntries: readonly ShipMasterEntry[] = deepFreeze(entries);

function ship(uid: string, shipId: number, level: number, luck: number): OwnedShip {
  return { uid, shipId, level, luck, sallyArea: 0 };
}

const ships: OwnedShip[] = [
  ship("myoukou", 319, 147, 30), // 妙高改二（重巡）
  ship("shimushu", 376, 63, 45), // 占守改（海防）
  ship("taihou", 156, 121, 12), // 大鳳改（装甲空母）
  ship("i401", 155, 104, 28), // 伊401改（潜水空母）
  ship("kashima", 357, 76, 20), // 鹿島改（練巡）
  ship("haruna", 151, 158, 40), // 榛名改二（戦艦・艦種 8）
  ship("ise", 77, 133, 35), // 伊勢（戦艦・艦種 9。伊勢型）
];

/** 足りない艦種の個体（凍結済み）。個体 ID は summer2026Ships と重ならない。艦 ID はすべて extraMasterEntries にある */
export const extraShips: readonly OwnedShip[] = deepFreeze(ships);

const definitionWithExtraFudas: PublicDefinition = {
  ...summer2026Definition,
  areas: [...summer2026Definition.areas, { id: "E4", name: "E4" }],
  fudas: [
    ...summer2026Definition.fudas,
    // どの段階にも使われない札
    { id: "unused", name: "未使用の札", color: "#C9A227", gameNumber: 6 },
    // ゲーム内の札番号がない札（U10。差分の対象外）
    { id: "nonumber", name: "札番号なしの札", color: "#E07A5F", gameNumber: null },
  ],
  stages: [
    ...summer2026Definition.stages,
    { id: "E4-1", areaId: "E4", name: "ゲージ1", fudaId: "nonumber", importance: "normal", boosts: [] },
  ],
};

/**
 * 2026夏イベの定義に、未使用の札（unused）と札番号のない札（nonumber。E4 ゲージ1 で使う）を足したもの（凍結済み）。
 * 既存の海域・札・段階の値と順番はそのまま（末尾に足しただけ）
 */
export const summer2026DefinitionWithExtraFudas: PublicDefinition = deepFreeze(definitionWithExtraFudas);
