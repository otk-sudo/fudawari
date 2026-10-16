// 協力者画面の表の日付の表示（日本時間）と並び順

import type { Collaborator } from "./types";

/** 日本時間の時差（ミリ秒） */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * DB の日時（timestamptz の ISO 8601。例 "2026-07-09T16:30:00.123456+00:00"）をミリ秒にする。読めなければ undefined。
 * PostgREST は秒の小数を 6 桁まで返すが、Date の文字列の形は 3 桁までなので、4 桁目からを切り捨ててから読む
 */
function parseTimestamp(text: string): number | undefined {
  const ms = Date.parse(text.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(ms) ? undefined : ms;
}

/** 日本時間の年・月・日 */
function jstDate(ms: number): { year: number; month: number; day: number } {
  const jst = new Date(ms + JST_OFFSET_MS);
  return { year: jst.getUTCFullYear(), month: jst.getUTCMonth() + 1, day: jst.getUTCDate() };
}

/** 追加した日の表示（日本時間の「2026/07/10」）。読めない値はそのまま返す */
export function formatAddedDate(createdAt: string): string {
  const ms = parseTimestamp(createdAt);
  if (ms === undefined) return createdAt;
  const { year, month, day } = jstDate(ms);
  return `${year}/${pad2(month)}/${pad2(day)}`;
}

/** 日本時間の「08/04」。読めない値はそのまま返す */
function formatMonthDay(text: string): string {
  const ms = parseTimestamp(text);
  if (ms === undefined) return text;
  const { month, day } = jstDate(ms);
  return `${pad2(month)}/${pad2(day)}`;
}

/** 最後に定義を編集した日の表示（日本時間の「08/04（下書きを保存）」）。まだ編集していなければ「—」 */
export function formatLastEdit(member: Pick<Collaborator, "lastEditedAt" | "lastEditedNote">): string {
  if (member.lastEditedAt === null) return "—";
  const date = formatMonthDay(member.lastEditedAt);
  return member.lastEditedNote === null || member.lastEditedNote === ""
    ? date
    : `${date}（${member.lastEditedNote}）`;
}

/** 表の並び：管理者を先に、同じ権限の中は追加した日の古い順（同じなら表示名の順） */
export function compareMembers(a: Collaborator, b: Collaborator): number {
  if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
  const aMs = parseTimestamp(a.createdAt) ?? Number.POSITIVE_INFINITY;
  const bMs = parseTimestamp(b.createdAt) ?? Number.POSITIVE_INFINITY;
  if (aMs !== bMs) return aMs < bMs ? -1 : 1;
  return a.displayName.localeCompare(b.displayName, "ja");
}
