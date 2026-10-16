// 割り振り画面の控え（割り当てていない艦）の絞り込みと並び順（roadmap T2-6、要件 3.3）。画面・保存に依存しない純粋な関数
//
// - 検索：図鑑 ID（マスタの図鑑番号 sortNo。数字がちょうど一致）・名称（艦名の部分一致）。前後の空白は無視する
// - 艦種タブ：要件 3.3 の対応表（13 のタブ）。艦種の番号は start2 の api_mst_stype（docs/research/import-and-master.md）
// - 改造状態、「特効のある艦だけ」（hasBoost＝どれかの段階で倍率が 1 より大きい）、「特効が効く札」（選んだ札のどれかで効く）
// - 並び順：艦型／Lv／特効の強さ／名前。並び順ごとに見出し（隻数つき）で区切る
// - 条件の数（「絞り込み」のバッジ）＝外した改造状態の数＋「特効のある艦だけ」（ON なら 1）＋選んだ札の数
//
// 【未実装】T2-6 の実装担当が中身を書く。いまは型を通すための空の入れ物（常に空・既定外の値を返す）
import type { ShipBoostSummary } from "@/domain/boost/types";
import type { PublicDefinition } from "@/domain/definition/types";
import type { RemodelStage, ShipLookup, ShipMaster } from "@/domain/master/types";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import type { TraySort, TrayView } from "@/lib/storage";

/**
 * 艦種タブの ID（要件 3.3 の対応表。1 つだけ選ぶ）
 * - all：ALL（すべて）
 * - carrier：空母（正規空母、装甲空母）
 * - light-carrier：軽母（軽空母）
 * - battleship：戦艦（戦艦）
 * - aviation-battleship：航戦（航空戦艦）
 * - heavy-cruiser：重巡（重巡洋艦）
 * - aviation-cruiser：航巡（航空巡洋艦）
 * - light-cruiser：軽巡（軽巡洋艦、重雷装巡洋艦、練習巡洋艦）
 * - destroyer：駆逐（駆逐艦）
 * - escort：海防（海防艦）
 * - submarine：潜水（潜水艦、潜水空母）
 * - seaplane-tender：水母（水上機母艦）
 * - other：その他（潜水母艦、揚陸艦、補給艦、工作艦）
 */
export type ShipTypeTabId =
  | "all"
  | "carrier"
  | "light-carrier"
  | "battleship"
  | "aviation-battleship"
  | "heavy-cruiser"
  | "aviation-cruiser"
  | "light-cruiser"
  | "destroyer"
  | "escort"
  | "submarine"
  | "seaplane-tender"
  | "other";

/** 艦種タブ（画面に並べる順） */
export interface ShipTypeTab {
  readonly id: ShipTypeTabId;
  /** タブの文字（例「ALL」「空母」） */
  readonly label: string;
}

/** 艦種タブの一覧（画面に並べる順。要件 3.3 の対応表の順） */
export const SHIP_TYPE_TABS: readonly ShipTypeTab[] = []; // 【未実装】

/** 控えの絞り込みと並び順の条件（画面の控えの欄の状態） */
export interface TrayOptions {
  /** 検索欄の文字（図鑑 ID・名称） */
  readonly query: string;
  /** 艦種タブ */
  readonly tab: ShipTypeTabId;
  /** 改造状態ごとの ON／OFF（ON の改造状態の艦を出す） */
  readonly remodelStages: Readonly<Record<RemodelStage, boolean>>;
  /** 「特効のある艦だけ」 */
  readonly boostOnly: boolean;
  /** 「特効が効く札」で選んだ札の ID（選んだ札のどれかで特効がある艦に絞る。空なら絞らない） */
  readonly fudaIds: readonly string[];
  /** 並び順 */
  readonly sort: TraySort;
  /** 表示の詰め具合（一行／カード） */
  readonly view: TrayView;
}

/** createInitialTrayOptions の引数（設定から渡す初期値。設定とつなぐのは T2-12） */
export interface TrayOptionsInit {
  /** 並び順の初期値（省略すると艦型） */
  sort?: TraySort;
  /** 表示の初期値（省略すると一行） */
  view?: TrayView;
}

/** 控えの 1 隻（艦カードの表示に使う情報） */
export interface TrayEntry {
  /** 個体 */
  readonly ship: OwnedShip;
  /** マスタで引いた情報（マスタにない艦は known: false・name「名前が分からない艦」） */
  readonly info: ShipLookup;
  /** 特効のまとめ（効く札はスコアの高い順。カードの左端の色＝一番効く札の色に使う） */
  readonly boost: ShipBoostSummary;
}

/** 控えの区切り（見出し 1 つ分） */
export interface TrayGroup {
  /** 区切りのキー（折りたたみの状態を覚えるのに使う。同じ並び順の中で重複しない） */
  readonly key: string;
  /** 見出し（例「白露型」「Lv 150 以上」「連合艦隊で効く」「特効なし」「名前順」） */
  readonly title: string;
  /** 隻数（entries の数） */
  readonly count: number;
  /** 区切りの中の艦（並び順どおり） */
  readonly entries: readonly TrayEntry[];
}

/** buildTray の引数 */
export interface BuildTrayInput {
  definition: PublicDefinition;
  master: ShipMaster;
  /** 取り込んだ個体の一覧 */
  ships: readonly OwnedShip[];
  /** 今の割り当て（割り当てのない個体が控え） */
  assignments: AssignmentMap;
  options: TrayOptions;
}

/** buildTray の結果 */
export interface TrayResult {
  /** 区切り（並び順どおり。艦のいない区切りは入れない。条件に合う艦がいなければ空） */
  readonly groups: readonly TrayGroup[];
  /** 表示数（条件に合う控えの艦の数。「10 / 75隻」の 10） */
  readonly shownCount: number;
  /** 控えの総数（割り当てていない艦の数。条件によらない。「10 / 75隻」の 75） */
  readonly totalCount: number;
}

/** 控えの初期の条件。並び順「艦型」・「特効のある艦だけ」ON。並び順と表示の初期値は外から渡せる */
export function createInitialTrayOptions(init: TrayOptionsInit = {}): TrayOptions {
  // 【未実装】空の入れ物：初期値を返さない
  void init;
  return {
    query: "",
    tab: "all",
    remodelStages: { unremodeled: false, intermediate: false, final: false },
    boostOnly: false,
    fudaIds: [],
    sort: "name",
    view: "card",
  };
}

/** 「リセット」：艦種タブを ALL、並び順を艦型、改造状態をすべて ON、「特効のある艦だけ」を OFF、札の選択なしにする */
export function resetTrayOptions(options: TrayOptions): TrayOptions {
  // 【未実装】空の入れ物：何も変えない
  return options;
}

/** 条件の数（「絞り込み」のバッジ）＝外した改造状態の数＋「特効のある艦だけ」（ON なら 1）＋選んだ札の数 */
export function countActiveFilters(options: Pick<TrayOptions, "remodelStages" | "boostOnly" | "fudaIds">): number {
  // 【未実装】空の入れ物
  void options;
  return 0;
}

/** 艦種の番号（api_mst_stype）が入る艦種タブ。ALL 以外のどのタブにも入らない番号は null */
export function shipTypeTabOf(shipTypeId: number): Exclude<ShipTypeTabId, "all"> | null {
  // 【未実装】空の入れ物
  void shipTypeId;
  return null;
}

/** 控えを絞り込み、並び順どおりに区切って返す */
export function buildTray(input: BuildTrayInput): TrayResult {
  // 【未実装】空の入れ物
  void input;
  return { groups: [], shownCount: 0, totalCount: 0 };
}
