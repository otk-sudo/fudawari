// 艦型の名前の対応表（艦型の番号 api_ctype → 名前。例 23 → 「白露型」）
//
// api_start2 には艦型の名前がないため、自前で持つ（U1）。
// 対応表にない艦型は、buildShipMasterEntries（fromStart2.ts）が
// 「その艦型で図鑑番号が最も小さい艦の、改装段階を問わない艦名＋型」で補う。補った名前が正しい艦型は載せなくてよい。
//
// 作り方（実装担当。2026-10-16）
// - ゲーム内の艦型の番号と名前（ゲームの事実）を、実装担当が分かる範囲で手で入れた。どこかの資料を写したものではない。
// - 番号に自信がないもの・名前の表記が定まらないもの（42・86・97 と 111 以降）は入れず、補う規則に任せる。
// - 補う規則で正しい名前にならない艦型（海外艦の「〜級」、潜水艦の艦型、最初の艦が図鑑番号の最小でない艦型など）が
//   この表の主な役目。番号を間違えると艦型ごと誤った名前になるため、実物の start2.json で生成したときに確かめる。
//
// 艦型の国籍の対応表（SHIP_CLASS_NATIONALITIES。v1.1）もこのファイルの後半に置く。
import type { BoostNationality } from "@/domain/nationality";

/** 艦型の番号 → 艦型の名前 */
export const SHIP_CLASS_NAMES: ReadonlyMap<number, string> = new Map<number, string>([
  [1, "綾波型"],
  [2, "伊勢型"],
  [3, "加賀型"],
  [4, "球磨型"],
  [5, "暁型"],
  [6, "金剛型"],
  [7, "古鷹型"],
  [8, "高雄型"],
  [9, "最上型"],
  [10, "初春型"],
  [11, "祥鳳型"],
  [12, "吹雪型"],
  [13, "青葉型"],
  [14, "赤城型"],
  [15, "千歳型"],
  [16, "川内型"],
  [17, "蒼龍型"],
  [18, "朝潮型"],
  [19, "長門型"],
  [20, "長良型"],
  [21, "天龍型"],
  [22, "島風型"],
  [23, "白露型"],
  [24, "飛鷹型"],
  [25, "飛龍型"],
  [26, "扶桑型"],
  [27, "鳳翔型"],
  [28, "睦月型"],
  [29, "妙高型"],
  [30, "陽炎型"],
  [31, "利根型"],
  [32, "龍驤型"],
  [33, "翔鶴型"],
  [34, "夕張型"],
  [35, "海大VI型"],
  [36, "巡潜乙型改二"],
  [37, "大和型"],
  [38, "夕雲型"],
  [39, "巡潜乙型"],
  [40, "巡潜3型"],
  [41, "阿賀野型"],
  [43, "大鳳型"],
  [44, "潜特型"],
  [45, "特種船丙型"],
  [46, "三式潜航輸送艇"],
  [47, "Bismarck級"],
  [48, "Z1型"],
  [49, "明石型"],
  [50, "大鯨型"],
  [51, "龍鳳型"],
  [52, "大淀型"],
  [53, "雲龍型"],
  [54, "秋月型"],
  [55, "Admiral Hipper級"],
  [56, "香取型"],
  [57, "UボートIXC型"],
  [58, "V.Veneto級"],
  [59, "秋津洲型"],
  [60, "改風早型"],
  [61, "Maestrale級"],
  [62, "瑞穂型"],
  [63, "Graf Zeppelin級"],
  [64, "Zara級"],
  [65, "Iowa級"],
  [66, "神風型"],
  [67, "Queen Elizabeth級"],
  [68, "Aquila級"],
  [69, "Lexington級"],
  [70, "Commandant Teste級"],
  [71, "巡潜甲型改二"],
  [72, "神威型"],
  [73, "Гангут級"],
  [74, "占守型"],
  [75, "春日丸級"],
  [76, "大鷹型"],
  [77, "択捉型"],
  [78, "Ark Royal級"],
  [79, "Richelieu級"],
  [80, "Guglielmo Marconi級"],
  [81, "Ташкент級"],
  [82, "J級"],
  [83, "Casablanca級"],
  [84, "Essex級"],
  [85, "日振型"],
  [87, "John C.Butler級"],
  [88, "Nelson級"],
  [89, "Gotland級"],
  [90, "日進型"],
  [91, "Fletcher級"],
  [92, "L.d.S.D.d.Abruzzi級"],
  [93, "Colorado級"],
  [94, "御蔵型"],
  [95, "Northampton級"],
  [96, "Perth級"],
  [98, "De Ruyter級"],
  [99, "Atlanta級"],
  [100, "迅鯨型"],
  [101, "松型"],
  [102, "South Dakota級"],
  [103, "巡潜丙型"],
  [104, "丁型海防艦"],
  [105, "Yorktown級"],
  [106, "St. Louis級"],
  [107, "North Carolina級"],
  [108, "Town級"],
  [109, "潜高型"],
  [110, "Brooklyn級"],
]);

// 艦型の国籍の対応表（艦型の番号 api_ctype → 国籍。v1.1「特効グループに国籍の条件を足す」）
//
// api_start2 には国籍がないため、艦型の名前と同じく自前で持つ。特効グループの国籍の条件の照合に使う。
// 対応表にない艦型の艦は、buildShipMasterEntries（fromStart2.ts）が "unknown"（国籍の条件に当てはまらない）にする。
//
// 作り方（親。2026-10-17）
// - 実物の start2.json（2026-10-17 取得、艦型の番号 1〜141）の艦名から、艦型ごとの国籍を確かめた。
// - 海外艦の艦型を国ごとに並べ、残りの 1〜141（42 は存在しない）を日本にする。
//   暁型（5。Верный を含む）・宗谷（111）は日本。改装で艦名が変わる艦は艦型の国籍に従う
//   （86：呂500〔U-511 の改装〕はドイツ、80：伊504・124：伊503 はイタリア）。
// - 新しい艦型（142 以降）が実装されたら、実物の start2.json で確かめてから足す。足すまでは "unknown"。

/** 海外艦の艦型（国籍 → 艦型の番号） */
const OVERSEAS_CLASS_IDS: Readonly<Record<Exclude<BoostNationality, "japan">, readonly number[]>> = {
  usa: [65, 69, 83, 84, 87, 91, 93, 95, 99, 102, 105, 106, 107, 110, 114, 116, 118, 121, 122, 125],
  uk: [67, 78, 82, 88, 108, 112, 134, 135],
  germany: [47, 48, 55, 57, 63, 86],
  italy: [58, 61, 64, 68, 80, 92, 113, 124],
  france: [70, 79, 128, 129, 138, 139, 141],
  soviet: [73, 81, 131],
  netherlands: [98],
  australia: [96],
  sweden: [89, 140],
  norway: [133],
  thailand: [137],
};

/** 確かめた艦型の番号の上限（1〜この値） */
const LAST_KNOWN_CLASS_ID = 141;

/** 1〜LAST_KNOWN_CLASS_ID のうち実在しない艦型の番号 */
const MISSING_CLASS_IDS: ReadonlySet<number> = new Set([42]);

/** 対応表を作る（海外艦の艦型を入れ、残りの実在する番号を日本にする。並びは艦型の番号の昇順） */
function buildClassNationalities(): Map<number, BoostNationality> {
  const overseas = new Map<number, BoostNationality>();
  for (const [nationality, ids] of Object.entries(OVERSEAS_CLASS_IDS) as [BoostNationality, readonly number[]][]) {
    for (const id of ids) overseas.set(id, nationality);
  }
  const result = new Map<number, BoostNationality>();
  for (let id = 1; id <= LAST_KNOWN_CLASS_ID; id += 1) {
    if (MISSING_CLASS_IDS.has(id)) continue;
    result.set(id, overseas.get(id) ?? "japan");
  }
  return result;
}

/** 艦型の番号 → 国籍 */
export const SHIP_CLASS_NATIONALITIES: ReadonlyMap<number, BoostNationality> = buildClassNationalities();
