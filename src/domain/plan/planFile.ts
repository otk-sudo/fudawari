// 札割りの書き出し・読み込みのファイル（U21：JSON。形式の版、イベント ID、割り当て）。純粋な関数
//
// ファイルの形：{ "formatVersion": 1, "eventId": "（イベント ID）", "assignments": { "（個体 ID）": "（札 ID）", … } }
// 設定の「札割りの書き出し・読み込み」（別のブラウザや PC へ移すとき）で使う。
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

/** 割り当てを札割りのファイルの文字列（JSON）にする */
export function serializePlanFile(eventId: string, assignments: AssignmentMap): string {
  void eventId;
  void assignments;
  throw new Error("未実装");
}

/** 札割りのファイルの文字列を読む。壊れたファイルでも例外を投げず、理由を返す */
export function parsePlanFile(text: string): PlanFileParseResult {
  void text;
  throw new Error("未実装");
}
