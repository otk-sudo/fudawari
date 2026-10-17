// 保存の記録の絞り込み・件数・8 件ずつの表示（純粋な関数。要件 3.7「保存の記録」、roadmap T3-10）
import type { SaveLogEntry, SaveLogKind } from "./types";

/** 1 ページに出す件数（「さらに古い記録を表示」で足す件数） */
export const SAVE_LOG_PAGE_SIZE = 8;

/** 編集できる人（「誰が」の選択肢の並びと表示名に使う。PR-12b） */
export interface SaveLogMember {
  readonly userId: string;
  readonly displayName: string;
}

/**
 * 「誰が」の選択肢の 1 つ（PR-12b）。
 * userId があれば、その ID の記録を選ぶ（同じ表示名の 2 人は別の選択肢）。
 * userId が null なら、ID の分からない記録のうち userName が name のものをまとめて選ぶ
 */
export interface SaveLogUserOption {
  readonly userId: string | null;
  /** 表示名（選択肢の文字） */
  readonly name: string;
}

/** 絞り込みの条件（null は「全員」「すべて」） */
export interface SaveLogFilter {
  /**
   * 誰が（saveLogUserOptions の選択肢。null は全員）。PR-12b で userName の代わりにする。
   * 【PR-12b の先行テスト用に省略できる形で置いた。実装担当が userName を消し、省略できない形にする】
   */
  readonly user?: SaveLogUserOption | null;
  /** 誰が（記録の userName と同じ表示名。null は全員）【PR-12b で user に置き換える】 */
  readonly userName: string | null;
  /** 種類（null はすべて） */
  readonly kind: SaveLogKind | null;
  /** 海域の表示名（null はすべて。海域を選ぶと mapLabel が null の記録〔公開など〕は出さない） */
  readonly mapLabel: string | null;
}

/** 表示する記録と件数 */
export interface SaveLogView {
  /** 表示する記録（絞り込んだ記録の先頭から 8 × pages 件。並びは入力のまま） */
  readonly shown: readonly SaveLogEntry[];
  /** 該当件数（絞り込んだ記録の件数） */
  readonly matched: number;
  /** まだ表示していない古い記録があるか（「さらに古い記録を表示」を出すか） */
  readonly hasMore: boolean;
}

/** 記録が条件をすべて満たすか（null の条件は問わない） */
function matches(entry: SaveLogEntry, filter: SaveLogFilter): boolean {
  if (filter.userName !== null && entry.userName !== filter.userName) return false;
  if (filter.kind !== null && entry.kind !== filter.kind) return false;
  if (filter.mapLabel !== null && entry.mapLabel !== filter.mapLabel) return false;
  return true;
}

/**
 * 記録（新しい順）を条件で絞り込み、先頭から 8 × pages 件を表示する記録として返す。入力は書き換えない
 * @param pages 表示するページ数（開いたとき・絞り込みを変えたときは 1。「さらに古い記録を表示」で 1 増やす）
 */
export function viewSaveLogs(entries: readonly SaveLogEntry[], filter: SaveLogFilter, pages: number): SaveLogView {
  const hit = entries.filter((entry) => matches(entry, filter));
  const limit = SAVE_LOG_PAGE_SIZE * Math.max(1, Math.floor(pages));
  return { shown: hit.slice(0, limit), matched: hit.length, hasMore: hit.length > limit };
}

/**
 * 「誰が」の選択肢（PR-12b。記録に現れる人だけ。利用者の ID で見分ける）。
 * - 並びは編集できる人の並び（members。管理者を先に、追加した順）。表示名は members の表示名
 * - members にいない人（外された協力者など）は、記録に現れた順（新しい順）で後ろに足す（表示名は記録の userName）
 * - 同じ人（同じ ID）は 1 つ。同じ表示名でも ID が違えば別の選択肢。ID の分からない記録は表示名ごとに 1 つにまとめる
 */
export function saveLogUserOptions(
  entries: readonly SaveLogEntry[],
  members: readonly SaveLogMember[],
): SaveLogUserOption[] {
  // 【PR-12b の先行テスト用の空の入れ物】中身は実装担当が作る（テスト：view.test.ts の saveLogUserOptions）
  void entries;
  void members;
  throw new Error("未実装（PR-12b）");
}

/**
 * 「誰が」の選択肢に出す表示名（記録に現れる人だけ）。
 * 編集できる人の並び（memberNames。管理者を先に、追加した順）に並べ、そこにいない人（外された協力者など）は
 * 記録に現れた順（新しい順）で後ろに足す。同じ名前は 1 つにする
 */
export function saveLogUserNames(entries: readonly SaveLogEntry[], memberNames: readonly string[]): string[] {
  const appeared = new Set(entries.map((entry) => entry.userName));
  const members = memberNames.filter((name, index) => appeared.has(name) && memberNames.indexOf(name) === index);
  const memberSet = new Set(members);
  const others = [...appeared].filter((name) => !memberSet.has(name));
  return [...members, ...others];
}
