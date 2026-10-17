// 艦の国籍（v1.1「特効グループに国籍の条件を足す」。U11）。純粋な値と関数
//
// - 艦船マスタの各行は国籍（Nationality）を持つ。api_start2 にはないため、艦型の番号から自前の対応表で入れる
//   （SHIP_CLASS_NATIONALITIES。@/domain/master/shipClassNames）。対応表にない艦型の艦は "unknown"。
// - 特効グループの国籍の条件で選べるのは BoostNationality（"unknown" を除く 12 か国）だけ。
//   "unknown" の艦は国籍の条件には当てはまらない（艦名の条件には当てはまる）。
// - BOOST_NATIONALITIES の並びが、画面（チェックボックス・タグ）と保存（定義の nationalities）の正規の順。

/** 艦の国籍。"unknown" は艦型の国籍が分からない艦（対応表にない艦型） */
export type Nationality =
  | "japan"
  | "usa"
  | "uk"
  | "germany"
  | "italy"
  | "france"
  | "soviet"
  | "netherlands"
  | "australia"
  | "sweden"
  | "norway"
  | "thailand"
  | "unknown";

/** 特効グループの国籍の条件で選べる国籍（"unknown" を除く） */
export type BoostNationality = Exclude<Nationality, "unknown">;

/** 定義で選べる国籍（凍結済み）。この並びが画面・保存の正規の順 */
export const BOOST_NATIONALITIES: readonly BoostNationality[] = Object.freeze([
  "japan",
  "usa",
  "uk",
  "germany",
  "italy",
  "france",
  "soviet",
  "netherlands",
  "australia",
  "sweden",
  "norway",
  "thailand",
] as const);

/** 国籍 → 表示名 */
const LABELS: Readonly<Record<Nationality, string>> = Object.freeze({
  japan: "日本",
  usa: "アメリカ",
  uk: "イギリス",
  germany: "ドイツ",
  italy: "イタリア",
  france: "フランス",
  soviet: "ソ連",
  netherlands: "オランダ",
  australia: "オーストラリア",
  sweden: "スウェーデン",
  norway: "ノルウェー",
  thailand: "タイ",
  unknown: "不明",
});

/** 判定に使う集合（文字列で引けるように string の集合にしておく） */
const BOOST_NATIONALITY_SET: ReadonlySet<string> = new Set<string>(BOOST_NATIONALITIES);

/** 国籍の表示名（例 "usa" → 「アメリカ」、"unknown" → 「不明」） */
export function nationalityLabel(nationality: Nationality): string {
  return LABELS[nationality];
}

/** 中身の分からない値が、定義で選べる国籍（"unknown" 以外の国籍）か */
export function isBoostNationality(value: unknown): value is BoostNationality {
  return typeof value === "string" && BOOST_NATIONALITY_SET.has(value);
}

/** 中身の分からない値が、国籍（"unknown" を含む）か */
export function isNationality(value: unknown): value is Nationality {
  return value === "unknown" || isBoostNationality(value);
}
