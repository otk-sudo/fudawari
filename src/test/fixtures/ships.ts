// テスト用の艦の個体と割り当て
//
// - summer2026Ships：モック（Main.dc.html と Assign.dc.html）に出てくる所持艦 31 隻。Lv・運はモックの値。
//   個体 ID（uid）はモックのキー（例 "hatsushimo"）。同名艦の 朝霜改二 が 2 隻（asashimo／asashimo2）いる。
//   実際に付いている札（sallyArea）はすべて 0（札なし）。差分のテストでは複製して書き換えて使う。
// - summer2026Assignments：一覧（Main.dc.html）の割り当て（各艦の at）。控えの艦はキーがない。
// - unknownShip：仮マスタにない艦 ID（99999）の個体。「名前が分からない艦」のテスト用（summer2026Ships には入れていない）。
// - createBulkShips(count)：600 隻以上の性能のテスト用。仮マスタの艦を順に繰り返して作る（毎回同じ内容）。
// - shipByUid(uid)：summer2026Ships から個体を取り出す（ないと例外。テストの書き間違いを早く見つけるため）。
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import { deepFreeze } from "./freeze";
import { summer2026MasterEntries } from "./shipMaster";

function ship(uid: string, shipId: number, level: number, luck: number): OwnedShip {
  return { uid, shipId, level, luck, sallyArea: 0 };
}

const ships: OwnedShip[] = [
  ship("shigure", 961, 175, 59), // 時雨改三
  ship("shigure2", 145, 98, 22), // 時雨改二
  ship("yukikaze", 656, 168, 72), // 雪風改二
  ship("yukikaze2", 228, 85, 55), // 雪風改
  ship("naganami", 543, 152, 31), // 長波改二
  ship("okinami", 569, 130, 28), // 沖波改二
  ship("asashimo", 578, 140, 34), // 朝霜改二
  ship("asashimo2", 578, 92, 20), // 朝霜改二（同名艦の別の個体）
  ship("hatsushimo", 419, 131, 48), // 初霜改二
  ship("ushio", 407, 125, 40), // 潮改二
  ship("fuyuzuki", 538, 120, 27), // 冬月改
  ship("shiranui", 567, 145, 30), // 不知火改二
  ship("kasumi", 470, 150, 39), // 霞改二乙
  ship("hamanami", 558, 110, 23), // 浜波改
  ship("suzukaze", 978, 92, 26), // 涼風改二（Main.dc.html だけに出てくる）
  ship("isuzu", 141, 140, 24), // 五十鈴改二
  ship("kitakami", 119, 160, 40), // 北上改二
  ship("yahagi", 668, 155, 45), // 矢矧改二乙
  ship("tone", 188, 150, 35), // 利根改二（Assign.dc.html だけ）
  ship("yamato", 916, 175, 61), // 大和改二重
  ship("nagato", 541, 170, 52), // 長門改二
  ship("hyuga", 554, 140, 42), // 日向改二（Assign.dc.html だけ）
  ship("zuikaku", 468, 165, 80), // 瑞鶴改二甲
  ship("zuiho", 560, 130, 55), // 瑞鳳改二乙（Assign.dc.html だけ）
  ship("akitsushima", 450, 95, 20), // 秋津洲改（Assign.dc.html だけ）
  ship("taigei", 184, 80, 25), // 大鯨（Assign.dc.html だけ）
  ship("hayasui", 352, 90, 18), // 速吸改（Assign.dc.html だけ）
  ship("akashi", 187, 99, 12), // 明石改（Assign.dc.html だけ）
  ship("akitsumaru", 166, 88, 40), // あきつ丸改（Assign.dc.html だけ。特効なし）
  ship("i41", 966, 120, 30), // 伊41改
  ship("i168", 398, 100, 63), // 伊168改
];

/** モックの所持艦 31 隻（凍結済み） */
export const summer2026Ships: readonly OwnedShip[] = deepFreeze(ships);

/** 一覧（Main.dc.html）の割り当て（凍結済み）。個体 ID → 札 ID */
export const summer2026Assignments: AssignmentMap = deepFreeze({
  // 第三十一戦隊：4 隻（特効あり 3 隻。涼風改二は特効なし）
  hatsushimo: "s31",
  fuyuzuki: "s31",
  suzukaze: "s31",
  isuzu: "s31",
  // 多号作戦部隊：3 隻
  okinami: "tago",
  asashimo: "tago",
  kasumi: "tago",
  // 連合艦隊：8 隻
  shigure2: "rengo",
  yukikaze: "rengo",
  naganami: "rengo",
  ushio: "rengo",
  kitakami: "rengo",
  yahagi: "rengo",
  nagato: "rengo",
  zuikaku: "rengo",
  // ウルシー攻撃部隊：3 隻
  shigure: "ulithi",
  shiranui: "ulithi",
  yamato: "ulithi",
  // 第六艦隊：1 隻
  i41: "sixth",
});

/** 仮マスタにない艦 ID の個体（「名前が分からない艦」のテスト用） */
export const unknownShip: OwnedShip = deepFreeze({
  uid: "unknown",
  shipId: 99999,
  level: 1,
  luck: 10,
  sallyArea: 0,
});

/** summer2026Ships から個体 ID で取り出す。ないと例外 */
export function shipByUid(uid: string): OwnedShip {
  const found = summer2026Ships.find((s) => s.uid === uid);
  if (!found) {
    throw new Error(`テスト用データに個体 ${uid} がありません`);
  }
  return found;
}

/**
 * 性能のテスト用に count 隻（既定 600 隻）の個体を作る。毎回同じ内容を返す。
 * - 艦：仮マスタの行を順に繰り返す（同じ艦 ID の個体が何隻もできる＝同名艦）
 * - 個体 ID："bulk-0001" から連番
 * - Lv：1〜185 に散らす。運：運の初期値＋0〜39。札：すべて 0（札なし）
 */
export function createBulkShips(count = 600): OwnedShip[] {
  return Array.from({ length: count }, (_, i) => {
    const master = summer2026MasterEntries[i % summer2026MasterEntries.length];
    return {
      uid: `bulk-${String(i + 1).padStart(4, "0")}`,
      shipId: master.id,
      level: 1 + ((i * 37) % 185),
      luck: master.luckBase + (i % 40),
      sallyArea: 0,
    };
  });
}
