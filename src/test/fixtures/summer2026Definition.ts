// テスト用の定義：2026夏イベ（E1〜E3）の公開定義 JSON
//
// 出所（docs/design/mock/）
// - 札・段階・大事さ：PlanEditor.dc.html の steps と F（札の色も同じ）
// - E2 ゲージ3 の特効グループ（連合艦隊C ×1.27／B ×1.24／A ×1.18 と艦名）：PlanEditor.dc.html の groupsBy
// - そのほかの段階の倍率と対象の艦：Assign.dc.html・Main.dc.html の A31／B31／TAGO／RA／RB と各艦の b
//   （E2 ギミック＝モックの「E2:H」。E3 ギミックはモックに特効がないため未入力）
// - 道中・海域全体（モックの「E1 海域全体」「E1 道中」）と艦種補正は持たない（U11）
// - 版の日付：Assign.dc.html の「特効データ：2026/08/04 版」。開始日時：PlanEditor.dc.html（終了日時は未定）
// - ゲーム内の札番号（U10）はモックにないため、テスト用に 1〜5 を付けた
//
// モックの数値で確かめられること（boost.test.ts で確かめている）
// - 初霜改二を連合艦隊に置くと +81（E2 ゲージ3〔難所〕の ×1.27 だけが効く）
// - 一覧（Main.dc.html）の「特効 n 隻」：E1 3、E2 ギミック 3、E2 ゲージ1 3、E2 ゲージ2 6、E2 ゲージ3 8、
//   E3 ギミック 0、E3 ゲージ1 3、E3 ゲージ2 3、E3 ゲージ3 1、E3 ゲージ4 3（割り当ては ships.ts の summer2026Assignments）
//
// 使い方
// - 型付きの値が欲しいとき：summer2026Definition（凍結済み。書き換えると例外になる）
// - 書き換えて使いたいとき（不正な例・編集のテストなど）：cloneSummer2026Definition() で複製を受け取る
// - JSON の文字列が欲しいとき：JSON.stringify(summer2026Definition)
//
// ID の一覧
// - 海域：E1、E2、E3
// - 札：s31（第三十一戦隊）、tago（多号作戦部隊）、rengo（連合艦隊）、ulithi（ウルシー攻撃部隊）、sixth（第六艦隊）
// - 段階（配列の順）：E1-1、E2-G、E2-1、E2-2、E2-3、E3-G、E3-1、E3-2、E3-3、E3-4
// - 特効グループ：「段階 ID-記号」（例 E2-3-C）
import type { PublicDefinition } from "@/domain/definition/types";
import { deepFreeze } from "./freeze";

// ---- 特効グループの艦名（改装段階を問わない艦名） ----

/** 第三十一戦隊A（モックの A31：E1 ×1.09、E2 ギミック ×1.08、E3 ゲージ2 輸送 ×1.12） */
const S31_A = ["雪風", "長波", "沖波", "朝霜", "初霜", "潮", "五十鈴"];
/** 第三十一戦隊B（モックの B31：E1 ×1.21、E2 ギミック ×1.16、E3 ゲージ2 輸送 ×1.16） */
const S31_B = ["冬月", "北上"];
/** 多号作戦（モックの TAGO：E2 ゲージ1 輸送 ×1.24） */
const TAGO = ["長波", "沖波", "朝霜", "初霜", "潮", "霞", "浜波", "秋津洲", "明石"];
/** 連合艦隊C（PlanEditor の E2 ゲージ3 そのまま） */
const RENGO_C = ["千歳", "千代田", "瑞鳳", "瑞鶴", "初霜", "潮", "響"];
/** 連合艦隊B（PlanEditor の E2 ゲージ3 そのまま。モックの RB） */
const RENGO_B = [
  "雪風", "浜風", "磯風", "不知火", "時雨", "長波", "沖波", "朝霜", "浜波", "秋霜", "秋月", "涼月", "冬月",
  "初月", "花月", "島風", "初春", "松", "竹", "梅", "杉", "榧", "樫", "桐", "桃",
];
/**
 * 連合艦隊A（PlanEditor の E2 ゲージ3。モックの RA）。
 * PlanEditor のタグ「大鯨(龍鳳)」は「大鯨」にした（龍鳳の改装段階を問わない艦名は大鯨のため、これで龍鳳にも効く）
 */
const RENGO_A = [
  "大和", "長門", "榛名", "伊勢", "日向", "大鯨", "隼鷹", "鳳翔", "青葉", "妙高", "利根", "高雄", "矢矧",
  "大淀", "酒匂", "北上", "大井", "鹿島",
];
/** E3 の連合艦隊A：モックの利根改二は E3 ゲージ1 に倍率がないため、E3 ゲージ1 だけ利根を外す */
const RENGO_A_E3_1 = RENGO_A.filter((name) => name !== "利根");
/** E3 の連合艦隊B：モックの速吸改は E3 ゲージ1・ゲージ4 だけ ×1.14 のため足す */
const RENGO_B_E3 = [...RENGO_B, "速吸"];

const definition: PublicDefinition = {
  schemaVersion: 1,
  event: {
    id: "2026-summer",
    name: "2026夏イベ",
    startAt: "2026-08-07T12:00:00+09:00",
    endAt: null,
    versionDate: "2026-08-04",
  },
  areas: [
    { id: "E1", name: "E1" },
    { id: "E2", name: "E2" },
    { id: "E3", name: "E3" },
  ],
  fudas: [
    { id: "s31", name: "第三十一戦隊", color: "#8B93A1", gameNumber: 1 },
    { id: "tago", name: "多号作戦部隊", color: "#5FB0E8", gameNumber: 2 },
    { id: "rengo", name: "連合艦隊", color: "#4C8DF6", gameNumber: 3 },
    { id: "ulithi", name: "ウルシー攻撃部隊", color: "#3FB37F", gameNumber: 4 },
    { id: "sixth", name: "第六艦隊", color: "#A97EF0", gameNumber: 5 },
  ],
  stages: [
    {
      id: "E1-1",
      areaId: "E1",
      name: "ギミック〜ゲージ3",
      fudaId: "s31",
      importance: "normal",
      boosts: [
        { id: "E1-1-B", name: "第三十一戦隊B", multiplier: 1.21, shipNames: S31_B },
        { id: "E1-1-A", name: "第三十一戦隊A", multiplier: 1.09, shipNames: S31_A },
      ],
    },
    {
      id: "E2-G",
      areaId: "E2",
      name: "ギミック",
      fudaId: "s31",
      importance: "normal",
      boosts: [
        { id: "E2-G-B", name: "第三十一戦隊B", multiplier: 1.16, shipNames: S31_B },
        { id: "E2-G-A", name: "第三十一戦隊A", multiplier: 1.08, shipNames: S31_A },
      ],
    },
    {
      id: "E2-1",
      areaId: "E2",
      name: "ゲージ1 輸送",
      fudaId: "tago",
      importance: "normal",
      boosts: [{ id: "E2-1-T", name: "多号作戦", multiplier: 1.24, shipNames: TAGO }],
    },
    {
      id: "E2-2",
      areaId: "E2",
      name: "ゲージ2",
      fudaId: "rengo",
      importance: "important",
      boosts: [
        { id: "E2-2-B", name: "連合艦隊B", multiplier: 1.19, shipNames: RENGO_B },
        { id: "E2-2-A", name: "連合艦隊A", multiplier: 1.14, shipNames: RENGO_A },
      ],
    },
    {
      id: "E2-3",
      areaId: "E2",
      name: "ゲージ3",
      fudaId: "rengo",
      importance: "hard",
      boosts: [
        { id: "E2-3-C", name: "連合艦隊C", multiplier: 1.27, shipNames: RENGO_C },
        { id: "E2-3-B", name: "連合艦隊B", multiplier: 1.24, shipNames: RENGO_B },
        { id: "E2-3-A", name: "連合艦隊A", multiplier: 1.18, shipNames: RENGO_A },
      ],
    },
    {
      id: "E3-G",
      areaId: "E3",
      name: "ギミック",
      fudaId: "s31",
      importance: "normal",
      boosts: [],
    },
    {
      id: "E3-1",
      areaId: "E3",
      name: "ゲージ1",
      fudaId: "ulithi",
      importance: "normal",
      boosts: [
        { id: "E3-1-B", name: "連合艦隊B", multiplier: 1.14, shipNames: RENGO_B_E3 },
        { id: "E3-1-A", name: "連合艦隊A", multiplier: 1.08, shipNames: RENGO_A_E3_1 },
      ],
    },
    {
      id: "E3-2",
      areaId: "E3",
      name: "ゲージ2 輸送",
      fudaId: "s31",
      importance: "normal",
      boosts: [
        { id: "E3-2-B", name: "第三十一戦隊B", multiplier: 1.16, shipNames: S31_B },
        { id: "E3-2-A", name: "第三十一戦隊A", multiplier: 1.12, shipNames: S31_A },
      ],
    },
    {
      id: "E3-3",
      areaId: "E3",
      name: "ゲージ3",
      fudaId: "sixth",
      importance: "important",
      boosts: [
        { id: "E3-3-A", name: "第六艦隊A", multiplier: 1.38, shipNames: ["伊41"] },
        { id: "E3-3-B", name: "第六艦隊B", multiplier: 1.24, shipNames: ["伊168"] },
      ],
    },
    {
      id: "E3-4",
      areaId: "E3",
      name: "ゲージ4",
      fudaId: "ulithi",
      importance: "hard",
      boosts: [
        { id: "E3-4-B", name: "連合艦隊B", multiplier: 1.14, shipNames: RENGO_B_E3 },
        { id: "E3-4-A", name: "連合艦隊A", multiplier: 1.08, shipNames: RENGO_A },
      ],
    },
  ],
};

/** 2026夏イベの公開定義（凍結済み。書き換えたいときは cloneSummer2026Definition を使う） */
export const summer2026Definition: PublicDefinition = deepFreeze(definition);

/** 2026夏イベの公開定義の複製（書き換えてよい） */
export function cloneSummer2026Definition(): PublicDefinition {
  return JSON.parse(JSON.stringify(summer2026Definition)) as PublicDefinition;
}
