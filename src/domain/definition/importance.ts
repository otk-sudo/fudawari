/* eslint-disable @typescript-eslint/no-unused-vars -- 実装前の空の入れ物。実装するときにこの行を消す */
// 大事さ（普通／重要／難所）の重みと表示名
import type { Importance } from "./types";

/** 大事さの重み。普通 1／重要 2／難所 3（特効のスコア計算に使う） */
export function importanceWeight(importance: Importance): 1 | 2 | 3 {
  throw new Error("未実装");
}

/** 大事さの表示名。"普通"／"重要"／"難所" */
export function importanceLabel(importance: Importance): string {
  throw new Error("未実装");
}
