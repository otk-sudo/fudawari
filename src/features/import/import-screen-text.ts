// 取り込み画面の文言と、表示の値を作る純粋な関数（要件 3.4、モック Import.dc.html）
//
// 画面（"use client" の ImportScreen）とページ（サーバーで描く src/app/import/page.tsx）の両方から読むため、
// React に依存しないファイルに分けている（"use client" のファイルから読んだ値は、サーバーの部品では文字列として使えない）。
import type { ImportFailureReason } from "@/domain/import";

/** 画面名（h1 とページのタイトル） */
export const IMPORT_SCREEN_TITLE = "艦娘の取り込み";

/** Lv 下限の範囲（要件 3.4「1〜185」） */
export const MIN_LEVEL_LOWEST = 1;
export const MIN_LEVEL_HIGHEST = 185;

/** すぐ選べる Lv 下限（要件 3.4） */
export const MIN_LEVEL_PRESETS: readonly number[] = [1, 50, 99, 150];

/** 保存（previewImport・saveImport）に失敗したときの理由の文 */
export const SAVE_FAILED_MESSAGE =
  "取り込んだ艦娘をこのブラウザに保存できませんでした（ブラウザ内の保存の空きが足りない・使えない可能性があります）";

/** n を Lv 下限の範囲（1〜185）に収める */
export function clampMinLevel(n: number): number {
  return Math.min(MIN_LEVEL_HIGHEST, Math.max(MIN_LEVEL_LOWEST, n));
}

/**
 * Lv 下限の欄の文字を、取り込みに使う Lv 下限にする（2026-10-17 親の決定）。
 * 空・数として読めない値は 1、範囲外（0・200 など）は 1〜185 に収める。小数は切り捨てる
 */
export function toMinLevel(text: string): number {
  const n = Number(text);
  if (text.trim() === "" || !Number.isFinite(n)) return MIN_LEVEL_LOWEST;
  return clampMinLevel(Math.floor(n));
}

/** 取り込む艦娘の条件の名前（完了の表示の「（すべての艦娘・Lv1以上）」に使う） */
export function lockConditionLabel(lockedOnly: boolean): string {
  return lockedOnly ? "ロック済みだけ" : "すべての艦娘";
}

/** 解析に失敗した理由の文（何も貼り付けていないときの文は要件 3.4・モックのまま） */
export function failureMessage(reason: ImportFailureReason): string {
  switch (reason) {
    case "empty":
      return "まだ何も貼り付けられていません。コピーした艦娘の情報を左の欄に貼り付けてから「取り込む」を押してください";
    case "invalidJson":
      return "貼り付けた内容を JSON として読めません（途中で切れている可能性があります）。もう一度コピーして貼り付けてください";
    case "unexpectedShape":
      return "貼り付けた内容は艦娘の情報の形式ではありません。制空権シミュレータに艦娘を反映するときと同じ方法でコピーしてください";
    case "noShips":
      return "取り込む範囲に当てはまる艦がいません。取り込む範囲（ロック済みだけ・Lv 下限）を見直してください";
  }
}

/** 2 桁にそろえる */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 取り込んだ日時（ISO 8601）を「10/15 20:40」の形にする（利用者の端末の時刻帯で出す）。
 * 日時として読めなければ null
 */
export function formatImportedAt(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getMonth() + 1}/${date.getDate()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
