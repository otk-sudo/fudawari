/* eslint-disable @typescript-eslint/no-unused-vars -- 実装前の空の入れ物。実装するときにこの行を消す */
// 改造の連鎖（api_aftershipid）から、改装段階を問わない艦名と改造状態を求める
import type { ApiMstShipLike, RemodelInfo } from "./types";

/**
 * 改造の連鎖から、艦 ID ごとの改装段階を問わない艦名と改造状態を求める（docs/research/import-and-master.md）。
 * - 未改造：どの艦の改造先にもなっていない艦（改造先もない単独の艦も未改造）
 * - 最終改造：改造先が "0"（または api_aftershipid がない）艦と、連鎖の最後にある輪（コンバート改装）に入っている艦
 * - 中間改造：それ以外
 * - 改装段階を問わない艦名：連鎖の起点（未改造）の艦名
 * 入力のすべての艦 ID を結果に含める
 */
export function deriveRemodelInfo(
  ships: readonly Pick<ApiMstShipLike, "api_id" | "api_name" | "api_aftershipid">[],
): Map<number, RemodelInfo> {
  throw new Error("未実装");
}
