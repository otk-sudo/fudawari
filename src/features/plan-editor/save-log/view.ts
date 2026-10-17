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
  /** 誰が（saveLogUserOptions の選択肢。null は全員） */
  readonly user: SaveLogUserOption | null;
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

/** 記録が「誰が」の選択肢の人のものか（ID があれば ID で、ID の分からない記録は表示名で見分ける） */
function isByUser(entry: SaveLogEntry, user: SaveLogUserOption): boolean {
  if (user.userId !== null) return entry.userId === user.userId;
  return entry.userId === null && entry.userName === user.name;
}

/** 記録が条件をすべて満たすか（null の条件は問わない） */
function matches(entry: SaveLogEntry, filter: SaveLogFilter): boolean {
  if (filter.user !== null && !isByUser(entry, filter.user)) return false;
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
  const memberIds = new Set(members.map((member) => member.userId));
  const recordedIds = new Set(entries.flatMap((entry) => (entry.userId === null ? [] : [entry.userId])));

  // 編集できる人のうち記録に現れる人（編集できる人の並び・今の表示名。同じ ID は 1 つ）
  const options: SaveLogUserOption[] = [];
  const added = new Set<string>();
  for (const member of members) {
    if (!recordedIds.has(member.userId) || added.has(member.userId)) continue;
    added.add(member.userId);
    options.push({ userId: member.userId, name: member.displayName });
  }

  // 編集できる人にいない人（外された人は ID ごと、ID の分からない記録は表示名ごと）を、記録に現れた順で後ろに足す
  const addedNames = new Set<string>();
  for (const entry of entries) {
    if (entry.userId === null) {
      if (addedNames.has(entry.userName)) continue;
      addedNames.add(entry.userName);
      options.push({ userId: null, name: entry.userName });
    } else if (!memberIds.has(entry.userId) && !added.has(entry.userId)) {
      added.add(entry.userId);
      options.push({ userId: entry.userId, name: entry.userName });
    }
  }
  return options;
}
