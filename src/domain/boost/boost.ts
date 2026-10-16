/* eslint-disable @typescript-eslint/no-unused-vars -- 実装前の空の入れ物。実装するときにこの行を消す */
// 特効の計算（roadmap T1-3）。画面・保存・通信に依存しない純粋な関数
//
// 艦の指定は「改装段階を問わない艦名」（baseName）で行う。個体からは
// baseNameOf(master, ship.shipId)（@/domain/master）で求める。マスタにない艦は null（どこにも効かない）。
import type { PublicDefinition, Stage } from "@/domain/definition/types";
import type { ShipMaster } from "@/domain/master/types";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import type { FudaBoost, ShipBoostSummary } from "./types";

/**
 * 艦 × 段階の倍率。段階の特効グループのうち shipNames に baseName を含むものの倍率を掛け合わせる（U12）。
 * どれにも当てはまらない、または baseName が null なら 1
 */
export function stageMultiplier(stage: Stage, baseName: string | null): number {
  throw new Error("未実装");
}

/**
 * 艦 × 札の特効（スコア、効く段階と倍率、特効の有無、最大倍率）。
 * 定義にない札 ID なら score 0・stages []・hasBoost false・maxMultiplier 1
 */
export function fudaBoost(
  definition: PublicDefinition,
  fudaId: string,
  baseName: string | null,
): FudaBoost {
  throw new Error("未実装");
}

/** 艦ごとの特効のまとめ。効く札をスコアの高い順に、効かない札を定義の順に返す */
export function shipBoostSummary(
  definition: PublicDefinition,
  baseName: string | null,
): ShipBoostSummary {
  throw new Error("未実装");
}

/**
 * 段階ごとに、その段階の札に割り当てた個体のうち、その段階で特効がある（倍率 > 1）隻数（一覧の「特効 n 隻」）。
 * 定義のすべての段階 ID をキーに持つ（該当なしは 0）。
 * 一覧にない個体への割り当て、定義にない札への割り当て、マスタにない艦は数えない
 */
export function countBoostedShipsByStage(
  definition: PublicDefinition,
  master: ShipMaster,
  ships: readonly OwnedShip[],
  assignments: AssignmentMap,
): Record<string, number> {
  throw new Error("未実装");
}

/** 段階の表示名「海域名 段階名」（例「E2 ゲージ3」。要件 14 章の提案） */
export function stageLabel(definition: PublicDefinition, stageId: string): string {
  throw new Error("未実装");
}
