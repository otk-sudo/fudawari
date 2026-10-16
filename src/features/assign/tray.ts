// 割り振り画面の控え（割り当てていない艦）の絞り込みと並び順（roadmap T2-6、要件 3.3）。画面・保存に依存しない純粋な関数
//
// - 控え：割り当てのない艦と、定義にない札に割り当てた艦（U17：定義から消えた札の割り当ては控えに戻す）
// - 検索：図鑑 ID（マスタの図鑑番号 sortNo。数字だけの検索で、数として一致）・名称（艦名の部分一致）。
//   前後の空白は無視し、全角の英数字は半角にそろえて比べる（NFKC）。読み（ひらがな）では探さない
// - 艦種タブ：要件 3.3 の対応表（13 のタブ）。艦種の番号は start2 の api_mst_stype（docs/research/import-and-master.md）
// - 改造状態、「特効のある艦だけ」（hasBoost＝どれかの段階で倍率が 1 より大きい）、「特効が効く札」（選んだ札のどれかで効く）
// - 並び順：艦型／Lv／特効の強さ／名前。並び順ごとに見出し（隻数つき）で区切る
// - 条件の数（「絞り込み」のバッジ）＝外した改造状態の数＋「特効のある艦だけ」（ON なら 1）＋選んだ札の数
//
// マスタにない艦（名前が分からない艦）は、艦種が分からないので ALL のタブにだけ出し、
// 改造状態が分からないので改造状態の絞り込みでは外さない。特効はない（「特効なし」）。
// 並び順「艦型」では最後の「艦型不明」、「名前」では最後に置く。
//
// 同点のときの順は、どの並び順でも Lv の高い順 → 図鑑番号の小さい順 → 個体 ID の順（毎回同じ順になるように）
import { shipBoostSummary } from "@/domain/boost";
import type { ShipBoostSummary } from "@/domain/boost/types";
import type { PublicDefinition } from "@/domain/definition/types";
import { lookupShip } from "@/domain/master";
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
export const SHIP_TYPE_TABS: readonly ShipTypeTab[] = [
  { id: "all", label: "ALL" },
  { id: "carrier", label: "空母" },
  { id: "light-carrier", label: "軽母" },
  { id: "battleship", label: "戦艦" },
  { id: "aviation-battleship", label: "航戦" },
  { id: "heavy-cruiser", label: "重巡" },
  { id: "aviation-cruiser", label: "航巡" },
  { id: "light-cruiser", label: "軽巡" },
  { id: "destroyer", label: "駆逐" },
  { id: "escort", label: "海防" },
  { id: "submarine", label: "潜水" },
  { id: "seaplane-tender", label: "水母" },
  { id: "other", label: "その他" },
];

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

// ---- 条件 ----

/** 並び順の初期値（要件 3.3：初期値は艦型） */
const DEFAULT_SORT: TraySort = "class";
/** 表示の初期値（設定の初期値と同じ「一行」） */
const DEFAULT_VIEW: TrayView = "dense";

/** 改造状態をすべて ON にした値（呼ぶたびに新しいオブジェクトを作る） */
function allRemodelStagesOn(): Record<RemodelStage, boolean> {
  return { unremodeled: true, intermediate: true, final: true };
}

/** 控えの初期の条件。並び順「艦型」・「特効のある艦だけ」ON。並び順と表示の初期値は外から渡せる */
export function createInitialTrayOptions(init: TrayOptionsInit = {}): TrayOptions {
  return {
    query: "",
    tab: "all",
    remodelStages: allRemodelStagesOn(),
    boostOnly: true,
    fudaIds: [],
    sort: init.sort ?? DEFAULT_SORT,
    view: init.view ?? DEFAULT_VIEW,
  };
}

/**
 * 「リセット」：艦種タブを ALL、並び順を艦型、改造状態をすべて ON、「特効のある艦だけ」を OFF、札の選択なしにする。
 * 検索欄と表示（一行／カード）は変えない（モック Assign.dc.html の resetAll どおり）。
 * 初期の条件と違い「特効のある艦だけ」は OFF になる（要件 14 章：モックどおりとした）
 */
export function resetTrayOptions(options: TrayOptions): TrayOptions {
  return {
    ...options,
    tab: "all",
    sort: DEFAULT_SORT,
    remodelStages: allRemodelStagesOn(),
    boostOnly: false,
    fudaIds: [],
  };
}

/** 条件の数（「絞り込み」のバッジ）＝外した改造状態の数＋「特効のある艦だけ」（ON なら 1）＋選んだ札の数 */
export function countActiveFilters(options: Pick<TrayOptions, "remodelStages" | "boostOnly" | "fudaIds">): number {
  const offStages = Object.values(options.remodelStages).filter((on) => !on).length;
  return offStages + (options.boostOnly ? 1 : 0) + options.fudaIds.length;
}

// ---- 艦種 ----

/**
 * 艦種の番号（api_mst_stype）ごとの艦種タブと、並び順「艦型」での艦種の順（要件 3.3）。
 * 配列の順が艦種の順で、同じ順位の艦種（戦艦の 8・9、補給艦の 15・22）は 1 行にまとめる。
 * ここにない番号（使われていない 12 超弩級戦艦や、これから増える艦種）は、ALL 以外のどのタブにも入らず、艦種の順は最後
 */
const SHIP_TYPE_ORDER: readonly { readonly ids: readonly number[]; readonly tab: Exclude<ShipTypeTabId, "all"> }[] = [
  { ids: [8, 9], tab: "battleship" }, // 戦艦
  { ids: [10], tab: "aviation-battleship" }, // 航空戦艦
  { ids: [11], tab: "carrier" }, // 正規空母
  { ids: [18], tab: "carrier" }, // 装甲空母
  { ids: [7], tab: "light-carrier" }, // 軽空母
  { ids: [5], tab: "heavy-cruiser" }, // 重巡洋艦
  { ids: [6], tab: "aviation-cruiser" }, // 航空巡洋艦
  { ids: [3], tab: "light-cruiser" }, // 軽巡洋艦
  { ids: [4], tab: "light-cruiser" }, // 重雷装巡洋艦
  { ids: [21], tab: "light-cruiser" }, // 練習巡洋艦
  { ids: [2], tab: "destroyer" }, // 駆逐艦
  { ids: [1], tab: "escort" }, // 海防艦
  { ids: [13], tab: "submarine" }, // 潜水艦
  { ids: [14], tab: "submarine" }, // 潜水空母
  { ids: [16], tab: "seaplane-tender" }, // 水上機母艦
  { ids: [20], tab: "other" }, // 潜水母艦
  { ids: [17], tab: "other" }, // 揚陸艦
  { ids: [15, 22], tab: "other" }, // 補給艦
  { ids: [19], tab: "other" }, // 工作艦
];

/** 艦種の番号 → 艦種タブと艦種の順位（SHIP_TYPE_ORDER の索引） */
const SHIP_TYPE_INFO: ReadonlyMap<number, { readonly tab: Exclude<ShipTypeTabId, "all">; readonly rank: number }> =
  new Map(SHIP_TYPE_ORDER.flatMap(({ ids, tab }, rank) => ids.map((id) => [id, { tab, rank }] as const)));

/** 艦種の番号（api_mst_stype）が入る艦種タブ。ALL 以外のどのタブにも入らない番号は null */
export function shipTypeTabOf(shipTypeId: number): Exclude<ShipTypeTabId, "all"> | null {
  return SHIP_TYPE_INFO.get(shipTypeId)?.tab ?? null;
}

/** 並び順「艦型」での艦種の順位（小さいほど前）。対応表にない番号は最後 */
function shipTypeRankOf(shipTypeId: number): number {
  return SHIP_TYPE_INFO.get(shipTypeId)?.rank ?? SHIP_TYPE_ORDER.length;
}

// ---- 絞り込み ----

/** 検索に使う形にそろえる：全角の英数字・空白を半角にし（NFKC）、前後の空白を除く */
function normalizeForSearch(text: string): string {
  return text.normalize("NFKC").trim();
}

/** 控えの艦か：割り当てがない、または定義にない札に割り当てている（U17） */
function isInTray(assignments: AssignmentMap, uid: string, fudaIds: ReadonlySet<string>): boolean {
  // 自分自身のキーだけを見る（Object.prototype の項目を拾わない）
  const fudaId = Object.hasOwn(assignments, uid) ? assignments[uid] : undefined;
  return fudaId === undefined || !fudaIds.has(fudaId);
}

/** 条件（検索・艦種タブ・改造状態・特効・札）に合うかを調べる関数を作る。並び順と表示は見ない */
function createMatcher(options: TrayOptions): (entry: TrayEntry) => boolean {
  const query = normalizeForSearch(options.query);
  // 数字だけの検索は図鑑番号でも探す（「001」は 1 と同じ）。数字だけでも名称に含まれていれば当たる
  const sortNoQuery = /^\d+$/.test(query) ? Number(query) : null;
  const selectedFudaIds = new Set(options.fudaIds);

  return ({ info, boost }) => {
    if (query !== "") {
      const byName = normalizeForSearch(info.name).includes(query);
      const bySortNo = sortNoQuery !== null && info.known && info.sortNo === sortNoQuery;
      if (!byName && !bySortNo) return false;
    }
    // マスタにない艦は艦種が分からないので ALL にだけ出す
    if (options.tab !== "all" && (!info.known || shipTypeTabOf(info.shipTypeId) !== options.tab)) return false;
    // マスタにない艦は改造状態が分からないので外さない
    if (info.known && !options.remodelStages[info.remodelStage]) return false;
    // 特効の有無はスコアではなく倍率で決める（effective は hasBoost の札だけ）
    if (options.boostOnly && boost.effective.length === 0) return false;
    if (selectedFudaIds.size > 0 && !boost.effective.some((fuda) => selectedFudaIds.has(fuda.fudaId))) return false;
    return true;
  };
}

// ---- 並び順 ----

/** 名前の比べ方（日本語の順） */
const nameCollator = new Intl.Collator("ja");
/** 個体 ID の比べ方（数字の部分は数として比べる。「99」は「100」より前） */
const uidCollator = new Intl.Collator("ja", { numeric: true });

/** 艦型が分からない艦（マスタにない艦）の区切りの見出し */
const UNKNOWN_CLASS_TITLE = "艦型不明";

/** 同点のときの比べ方に使う図鑑番号（マスタにない艦は後ろ） */
function sortNoOf(entry: TrayEntry): number {
  return entry.info.known ? entry.info.sortNo : Number.MAX_SAFE_INTEGER;
}

/** 同点のときの順：Lv の高い順 → 図鑑番号の小さい順 → 個体 ID の順 */
function compareTie(a: TrayEntry, b: TrayEntry): number {
  return b.ship.level - a.ship.level || sortNoOf(a) - sortNoOf(b) || uidCollator.compare(a.ship.uid, b.ship.uid);
}

function toGroup(key: string, title: string, entries: readonly TrayEntry[]): TrayGroup {
  return { key, title, count: entries.length, entries };
}

/**
 * 艦型：艦型ごとに区切る。艦種の順 → 艦型名の順、艦型の中は Lv の高い順。
 * 艦型が 2 つの艦種にまたがる（伊勢型＝戦艦と航空戦艦など）ときは、見出しを 1 つにまとめて前の艦種の位置に置く。
 * マスタにない艦は最後の「艦型不明」に入れる
 */
function groupByClass(entries: readonly TrayEntry[]): TrayGroup[] {
  const classes = new Map<number, { name: string; rank: number; entries: TrayEntry[] }>();
  const unknown: TrayEntry[] = [];
  for (const entry of entries) {
    const { info } = entry;
    if (!info.known) {
      unknown.push(entry);
      continue;
    }
    const rank = shipTypeRankOf(info.shipTypeId);
    const shipClass = classes.get(info.shipClassId);
    if (shipClass === undefined) {
      classes.set(info.shipClassId, { name: info.shipClassName, rank, entries: [entry] });
    } else {
      shipClass.entries.push(entry);
      shipClass.rank = Math.min(shipClass.rank, rank);
    }
  }

  const groups = [...classes]
    .sort(([idA, a], [idB, b]) => a.rank - b.rank || nameCollator.compare(a.name, b.name) || idA - idB)
    .map(([id, shipClass]) => toGroup(`class-${id}`, shipClass.name, shipClass.entries.sort(compareTie)));
  if (unknown.length > 0) groups.push(toGroup("class-unknown", UNKNOWN_CLASS_TITLE, unknown.sort(compareTie)));
  return groups;
}

/** Lv：「Lv 150 以上」のように 10 刻みで区切り、Lv の高い順。Lv 10 未満は「Lv 1 以上」 */
function groupByLevel(entries: readonly TrayEntry[]): TrayGroup[] {
  // Lv の高い順に並べてから区切るので、区切りも Lv の高い順にできる
  const bands = new Map<number, TrayEntry[]>();
  for (const entry of [...entries].sort(compareTie)) {
    const band = Math.floor(entry.ship.level / 10) * 10;
    const list = bands.get(band);
    if (list === undefined) {
      bands.set(band, [entry]);
    } else {
      list.push(entry);
    }
  }
  return [...bands].map(([band, list]) => toGroup(`lv-${band}`, `Lv ${Math.max(band, 1)} 以上`, list));
}

/**
 * 特効の強さ：一番効く札ごとに「（札名）で効く」で区切り（定義の札の順）、その中はその札でのスコアの高い順。
 * 最後に「特効なし」（マスタにない艦もここ）
 */
function groupByBoost(entries: readonly TrayEntry[], definition: PublicDefinition): TrayGroup[] {
  const byBestFuda = new Map<string, TrayEntry[]>();
  const noBoost: TrayEntry[] = [];
  for (const entry of entries) {
    // effective はスコアの高い順なので、先頭が一番効く札
    const best = entry.boost.effective.at(0);
    if (best === undefined) {
      noBoost.push(entry);
      continue;
    }
    const list = byBestFuda.get(best.fudaId);
    if (list === undefined) {
      byBestFuda.set(best.fudaId, [entry]);
    } else {
      list.push(entry);
    }
  }

  /** 一番効く札でのスコア */
  const bestScore = (entry: TrayEntry): number => entry.boost.effective.at(0)?.score ?? 0;
  const groups: TrayGroup[] = [];
  for (const fuda of definition.fudas) {
    const list = byBestFuda.get(fuda.id);
    if (list === undefined) continue;
    // 同じ札 ID が定義に 2 回あっても区切りは 1 つにする（キーを重複させない）
    byBestFuda.delete(fuda.id);
    list.sort((a, b) => bestScore(b) - bestScore(a) || compareTie(a, b));
    groups.push(toGroup(`boost-fuda-${fuda.id}`, `${fuda.name}で効く`, list));
  }
  if (noBoost.length > 0) groups.push(toGroup("boost-none", "特効なし", noBoost.sort(compareTie)));
  return groups;
}

/** 名前の比べ方に使う読み（マスタの読みが空なら艦名） */
function yomiOf(info: Extract<ShipLookup, { known: true }>): string {
  return info.yomi === "" ? info.name : info.yomi;
}

/** 名前：「名前順」の 1 区切りで、マスタの読みの五十音順。同じ読みの艦は同点の順。マスタにない艦は最後 */
function groupByName(entries: readonly TrayEntry[]): TrayGroup[] {
  if (entries.length === 0) return [];
  const sorted = [...entries].sort((a, b) => {
    if (a.info.known && b.info.known) {
      return nameCollator.compare(yomiOf(a.info), yomiOf(b.info)) || compareTie(a, b);
    }
    if (a.info.known !== b.info.known) return a.info.known ? -1 : 1;
    return compareTie(a, b);
  });
  return [toGroup("name", "名前順", sorted)];
}

/** 並び順に従って区切る */
function groupEntries(entries: readonly TrayEntry[], sort: TraySort, definition: PublicDefinition): TrayGroup[] {
  switch (sort) {
    case "class":
      return groupByClass(entries);
    case "lv":
      return groupByLevel(entries);
    case "boost":
      return groupByBoost(entries, definition);
    case "name":
      return groupByName(entries);
  }
}

// ---- 控え ----

/** 控えを絞り込み、並び順どおりに区切って返す */
export function buildTray(input: BuildTrayInput): TrayResult {
  const { definition, master, ships, assignments, options } = input;
  const definedFudaIds = new Set(definition.fudas.map((fuda) => fuda.id));

  const trayShips = ships.filter((ship) => isInTray(assignments, ship.uid, definedFudaIds));
  const matches = createMatcher(options);
  const shown = trayShips
    .map((ship): TrayEntry => {
      const info = lookupShip(master, ship.shipId);
      return { ship, info, boost: shipBoostSummary(definition, info.known ? info.baseName : null) };
    })
    .filter(matches);

  return {
    groups: groupEntries(shown, options.sort, definition),
    shownCount: shown.length,
    totalCount: trayShips.length,
  };
}
