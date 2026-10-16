// 札割りの書き出し・読み込みのファイル（U21：JSON。形式の版、イベント ID、割り当て）。純粋な関数
//
// ファイルの形：{ "formatVersion": 1, "eventId": "（イベント ID）", "assignments": { "（個体 ID）": "（札 ID）", … } }
// 設定の「札割りの書き出し・読み込み」（別のブラウザや PC へ移すとき）で使う。
import type { ShipUid } from "@/domain/ship/types";
import type { AssignmentMap } from "./types";

/** 札割りのファイルの形式の版。形を変えるときに上げる */
export const PLAN_FILE_FORMAT_VERSION = 1;

/** 札割りのファイルの中身 */
export interface PlanFile {
  formatVersion: typeof PLAN_FILE_FORMAT_VERSION;
  /** イベント ID */
  eventId: string;
  /** 割り当て（個体 ID → 札 ID） */
  assignments: AssignmentMap;
}

/**
 * 読み込みに失敗した理由
 * - "invalidJson"：JSON として読めない（空も含む）
 * - "invalidFormat"：JSON としては読めるが、札割りのファイルの形でない
 *   （形式の版・イベント ID・割り当てがない、型が違う、イベント ID が空、割り当ての札 ID が文字列でない）
 * - "unsupportedVersion"：形式の版がこのアプリの知らない値
 */
export type PlanFileFailureReason = "invalidJson" | "invalidFormat" | "unsupportedVersion";

/** 読み込みの結果 */
export type PlanFileParseResult =
  | { ok: true; eventId: string; assignments: AssignmentMap }
  | { ok: false; reason: PlanFileFailureReason };

/** 値がオブジェクト（null・配列を除く）か */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 割り当てのうち、札 ID が文字列のものだけを写す（控え〔undefined〕のキーは入れない） */
function copyAssignments(assignments: AssignmentMap): Record<ShipUid, string> {
  const result: Record<ShipUid, string> = {};
  for (const [uid, fudaId] of Object.entries(assignments)) {
    if (typeof fudaId === "string") result[uid] = fudaId;
  }
  return result;
}

/** 割り当てを札割りのファイルの文字列（JSON）にする（人が開いても読めるよう字下げする） */
export function serializePlanFile(eventId: string, assignments: AssignmentMap): string {
  const file: PlanFile = {
    formatVersion: PLAN_FILE_FORMAT_VERSION,
    eventId,
    assignments: copyAssignments(assignments),
  };
  return JSON.stringify(file, null, 2);
}

/** 札割りのファイルの文字列を読む。壊れたファイルでも例外を投げず、理由を返す */
export function parsePlanFile(text: string): PlanFileParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalidJson" };
  }
  if (!isRecord(data)) return { ok: false, reason: "invalidFormat" };

  // 形式の版を先に見る（知らない版は、ほかの項目の形も分からないため）
  const { formatVersion, eventId, assignments } = data;
  if (typeof formatVersion !== "number") return { ok: false, reason: "invalidFormat" };
  if (formatVersion !== PLAN_FILE_FORMAT_VERSION) return { ok: false, reason: "unsupportedVersion" };

  if (typeof eventId !== "string" || eventId.trim() === "") return { ok: false, reason: "invalidFormat" };
  if (!isRecord(assignments)) return { ok: false, reason: "invalidFormat" };

  const result: Record<ShipUid, string> = {};
  for (const [uid, fudaId] of Object.entries(assignments)) {
    if (typeof fudaId !== "string") return { ok: false, reason: "invalidFormat" };
    result[uid] = fudaId;
  }
  return { ok: true, eventId, assignments: result };
}
