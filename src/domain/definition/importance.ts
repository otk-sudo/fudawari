// 大事さ（普通／重要／難所）の重みと表示名
import type { Importance } from "./types";

/** 大事さごとの重み（特効のスコア計算に使う） */
const WEIGHTS: Readonly<Record<Importance, 1 | 2 | 3>> = {
  normal: 1,
  important: 2,
  hard: 3,
};

/** 大事さごとの表示名 */
const LABELS: Readonly<Record<Importance, string>> = {
  normal: "普通",
  important: "重要",
  hard: "難所",
};

/** 大事さの重み。普通 1／重要 2／難所 3（特効のスコア計算に使う） */
export function importanceWeight(importance: Importance): 1 | 2 | 3 {
  return WEIGHTS[importance];
}

/** 大事さの表示名。"普通"／"重要"／"難所" */
export function importanceLabel(importance: Importance): string {
  return LABELS[importance];
}

/** 文字列が大事さの 3 種（"normal"／"important"／"hard"）のどれかか（定義の検証に使う） */
export function isImportance(value: string): value is Importance {
  return Object.hasOwn(WEIGHTS, value);
}
