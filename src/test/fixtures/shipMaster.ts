// テスト用の艦船マスタ（仮マスタ）：テスト用データに出てくる艦の分だけ
//
// - 実マスタ（Tibowl/api_start2 から生成）は PR-04 で作る。それまでの間と、単体テストではこれを使う。
// - 時雨系（時雨 43 → 時雨改 243 → 時雨改二 145 → 時雨改三 961、艦型の番号 23、読み「しぐれ」）は
//   実際の api_start2 と同じ（docs/research/import-and-master.md で確認済み）。
//   ほかの艦の ID・艦型の番号・図鑑番号・運の初期値はテスト用の値で、実際のマスタとは一致しない場合がある。
// - 改造状態・改装段階を問わない艦名は、改造の連鎖の考え方（remodel.ts）に合わせて手で入れた。
// - 艦種の番号は api_mst_stype（2 駆逐艦、3 軽巡洋艦、4 重雷装巡洋艦、6 航空巡洋艦、7 軽空母、9 戦艦、
//   10 航空戦艦、11 正規空母、13 潜水艦、16 水上機母艦、17 揚陸艦、19 工作艦、20 潜水母艦、22 補給艦）。
//   瑞鶴改二甲はモックの表示（正空）に合わせて 11 にした。
// - 名前が分からない艦のテストには、ships.ts の unknownShip（艦 ID 99999。このマスタにない）を使う。
//
// 使い方：createShipMaster(summer2026MasterEntries)（@/domain/master）で索引を作って引く
import type { RemodelStage, ShipMasterEntry } from "@/domain/master/types";
import { deepFreeze } from "./freeze";

interface ShipClass {
  shipClassId: number;
  shipClassName: string;
}

const 白露型: ShipClass = { shipClassId: 23, shipClassName: "白露型" };
const 陽炎型: ShipClass = { shipClassId: 30, shipClassName: "陽炎型" };
const 夕雲型: ShipClass = { shipClassId: 38, shipClassName: "夕雲型" };
const 初春型: ShipClass = { shipClassId: 10, shipClassName: "初春型" };
const 綾波型: ShipClass = { shipClassId: 1, shipClassName: "綾波型" };
const 秋月型: ShipClass = { shipClassId: 54, shipClassName: "秋月型" };
const 朝潮型: ShipClass = { shipClassId: 18, shipClassName: "朝潮型" };
const 長良型: ShipClass = { shipClassId: 20, shipClassName: "長良型" };
const 球磨型: ShipClass = { shipClassId: 4, shipClassName: "球磨型" };
const 阿賀野型: ShipClass = { shipClassId: 41, shipClassName: "阿賀野型" };
const 利根型: ShipClass = { shipClassId: 31, shipClassName: "利根型" };
const 大和型: ShipClass = { shipClassId: 37, shipClassName: "大和型" };
const 長門型: ShipClass = { shipClassId: 19, shipClassName: "長門型" };
const 伊勢型: ShipClass = { shipClassId: 2, shipClassName: "伊勢型" };
const 翔鶴型: ShipClass = { shipClassId: 33, shipClassName: "翔鶴型" };
const 祥鳳型: ShipClass = { shipClassId: 11, shipClassName: "祥鳳型" };
const 秋津洲型: ShipClass = { shipClassId: 45, shipClassName: "秋津洲型" };
const 大鯨型: ShipClass = { shipClassId: 50, shipClassName: "大鯨型" };
const 速吸型: ShipClass = { shipClassId: 60, shipClassName: "速吸型" };
const 明石型: ShipClass = { shipClassId: 49, shipClassName: "明石型" };
const 特種船丙型: ShipClass = { shipClassId: 52, shipClassName: "特種船丙型" };
const 巡潜乙型改二: ShipClass = { shipClassId: 108, shipClassName: "巡潜乙型改二" };
const 海大VI型: ShipClass = { shipClassId: 35, shipClassName: "海大VI型" };

/** マスタの 1 行を作る（引数が多いので、名前つきで渡す） */
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
  // 時雨系（実際の api_start2 と同じ ID の連鎖）
  entry({ id: 43, name: "時雨", baseName: "時雨", yomi: "しぐれ", shipTypeId: 2, shipClass: 白露型, remodelStage: "unremodeled", sortNo: 1001, luckBase: 10 }),
  entry({ id: 243, name: "時雨改", baseName: "時雨", yomi: "しぐれ", shipTypeId: 2, shipClass: 白露型, remodelStage: "intermediate", sortNo: 1002, luckBase: 10 }),
  entry({ id: 145, name: "時雨改二", baseName: "時雨", yomi: "しぐれ", shipTypeId: 2, shipClass: 白露型, remodelStage: "intermediate", sortNo: 1003, luckBase: 15 }),
  entry({ id: 961, name: "時雨改三", baseName: "時雨", yomi: "しぐれ", shipTypeId: 2, shipClass: 白露型, remodelStage: "final", sortNo: 1004, luckBase: 20 }),
  // 雪風系
  entry({ id: 20, name: "雪風", baseName: "雪風", yomi: "ゆきかぜ", shipTypeId: 2, shipClass: 陽炎型, remodelStage: "unremodeled", sortNo: 1005, luckBase: 50 }),
  entry({ id: 228, name: "雪風改", baseName: "雪風", yomi: "ゆきかぜ", shipTypeId: 2, shipClass: 陽炎型, remodelStage: "intermediate", sortNo: 1006, luckBase: 50 }),
  entry({ id: 656, name: "雪風改二", baseName: "雪風", yomi: "ゆきかぜ", shipTypeId: 2, shipClass: 陽炎型, remodelStage: "final", sortNo: 1007, luckBase: 52 }),
  // 初霜系
  entry({ id: 41, name: "初霜", baseName: "初霜", yomi: "はつしも", shipTypeId: 2, shipClass: 初春型, remodelStage: "unremodeled", sortNo: 1008, luckBase: 15 }),
  entry({ id: 241, name: "初霜改", baseName: "初霜", yomi: "はつしも", shipTypeId: 2, shipClass: 初春型, remodelStage: "intermediate", sortNo: 1009, luckBase: 15 }),
  entry({ id: 419, name: "初霜改二", baseName: "初霜", yomi: "はつしも", shipTypeId: 2, shipClass: 初春型, remodelStage: "final", sortNo: 1010, luckBase: 20 }),
  // 長波系
  entry({ id: 135, name: "長波", baseName: "長波", yomi: "ながなみ", shipTypeId: 2, shipClass: 夕雲型, remodelStage: "unremodeled", sortNo: 1011, luckBase: 12 }),
  entry({ id: 304, name: "長波改", baseName: "長波", yomi: "ながなみ", shipTypeId: 2, shipClass: 夕雲型, remodelStage: "intermediate", sortNo: 1012, luckBase: 12 }),
  entry({ id: 543, name: "長波改二", baseName: "長波", yomi: "ながなみ", shipTypeId: 2, shipClass: 夕雲型, remodelStage: "final", sortNo: 1013, luckBase: 15 }),
  // そのほか（モックに出てくる形だけ）
  entry({ id: 569, name: "沖波改二", baseName: "沖波", yomi: "おきなみ", shipTypeId: 2, shipClass: 夕雲型, remodelStage: "final", sortNo: 1014, luckBase: 12 }),
  entry({ id: 578, name: "朝霜改二", baseName: "朝霜", yomi: "あさしも", shipTypeId: 2, shipClass: 夕雲型, remodelStage: "final", sortNo: 1015, luckBase: 14 }),
  entry({ id: 558, name: "浜波改", baseName: "浜波", yomi: "はまなみ", shipTypeId: 2, shipClass: 夕雲型, remodelStage: "final", sortNo: 1016, luckBase: 10 }),
  entry({ id: 407, name: "潮改二", baseName: "潮", yomi: "うしお", shipTypeId: 2, shipClass: 綾波型, remodelStage: "final", sortNo: 1017, luckBase: 12 }),
  entry({ id: 538, name: "冬月改", baseName: "冬月", yomi: "ふゆづき", shipTypeId: 2, shipClass: 秋月型, remodelStage: "final", sortNo: 1018, luckBase: 10 }),
  entry({ id: 567, name: "不知火改二", baseName: "不知火", yomi: "しらぬい", shipTypeId: 2, shipClass: 陽炎型, remodelStage: "final", sortNo: 1019, luckBase: 10 }),
  entry({ id: 470, name: "霞改二乙", baseName: "霞", yomi: "かすみ", shipTypeId: 2, shipClass: 朝潮型, remodelStage: "final", sortNo: 1020, luckBase: 12 }),
  entry({ id: 978, name: "涼風改二", baseName: "涼風", yomi: "すずかぜ", shipTypeId: 2, shipClass: 白露型, remodelStage: "final", sortNo: 1021, luckBase: 12 }),
  entry({ id: 141, name: "五十鈴改二", baseName: "五十鈴", yomi: "いすず", shipTypeId: 3, shipClass: 長良型, remodelStage: "final", sortNo: 1022, luckBase: 12 }),
  entry({ id: 119, name: "北上改二", baseName: "北上", yomi: "きたかみ", shipTypeId: 4, shipClass: 球磨型, remodelStage: "final", sortNo: 1023, luckBase: 15 }),
  entry({ id: 668, name: "矢矧改二乙", baseName: "矢矧", yomi: "やはぎ", shipTypeId: 3, shipClass: 阿賀野型, remodelStage: "final", sortNo: 1024, luckBase: 15 }),
  entry({ id: 188, name: "利根改二", baseName: "利根", yomi: "とね", shipTypeId: 6, shipClass: 利根型, remodelStage: "final", sortNo: 1025, luckBase: 15 }),
  entry({ id: 916, name: "大和改二重", baseName: "大和", yomi: "やまと", shipTypeId: 9, shipClass: 大和型, remodelStage: "final", sortNo: 1026, luckBase: 15 }),
  entry({ id: 541, name: "長門改二", baseName: "長門", yomi: "ながと", shipTypeId: 9, shipClass: 長門型, remodelStage: "final", sortNo: 1027, luckBase: 20 }),
  entry({ id: 554, name: "日向改二", baseName: "日向", yomi: "ひゅうが", shipTypeId: 10, shipClass: 伊勢型, remodelStage: "final", sortNo: 1028, luckBase: 30 }),
  entry({ id: 468, name: "瑞鶴改二甲", baseName: "瑞鶴", yomi: "ずいかく", shipTypeId: 11, shipClass: 翔鶴型, remodelStage: "final", sortNo: 1029, luckBase: 50 }),
  entry({ id: 560, name: "瑞鳳改二乙", baseName: "瑞鳳", yomi: "ずいほう", shipTypeId: 7, shipClass: 祥鳳型, remodelStage: "final", sortNo: 1030, luckBase: 40 }),
  entry({ id: 450, name: "秋津洲改", baseName: "秋津洲", yomi: "あきつしま", shipTypeId: 16, shipClass: 秋津洲型, remodelStage: "final", sortNo: 1031, luckBase: 12 }),
  entry({ id: 184, name: "大鯨", baseName: "大鯨", yomi: "たいげい", shipTypeId: 20, shipClass: 大鯨型, remodelStage: "unremodeled", sortNo: 1032, luckBase: 15 }),
  entry({ id: 352, name: "速吸改", baseName: "速吸", yomi: "はやすい", shipTypeId: 22, shipClass: 速吸型, remodelStage: "final", sortNo: 1033, luckBase: 10 }),
  entry({ id: 187, name: "明石改", baseName: "明石", yomi: "あかし", shipTypeId: 19, shipClass: 明石型, remodelStage: "final", sortNo: 1034, luckBase: 10 }),
  entry({ id: 166, name: "あきつ丸改", baseName: "あきつ丸", yomi: "あきつまる", shipTypeId: 17, shipClass: 特種船丙型, remodelStage: "final", sortNo: 1035, luckBase: 25 }),
  entry({ id: 966, name: "伊41改", baseName: "伊41", yomi: "い41", shipTypeId: 13, shipClass: 巡潜乙型改二, remodelStage: "final", sortNo: 1036, luckBase: 15 }),
  entry({ id: 398, name: "伊168改", baseName: "伊168", yomi: "い168", shipTypeId: 13, shipClass: 海大VI型, remodelStage: "final", sortNo: 1037, luckBase: 15 }),
];

/** 仮マスタの行（凍結済み）。テスト用データの個体の艦 ID はすべてここにある（unknownShip を除く） */
export const summer2026MasterEntries: readonly ShipMasterEntry[] = deepFreeze(entries);
