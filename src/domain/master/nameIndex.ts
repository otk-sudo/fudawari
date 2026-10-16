// 艦名から、改装段階を問わない艦名を引く（plan-v1 後続の対応一覧「PR-02 レビュー 4」の索引）
//
// 定義の特効グループの艦名（改装段階を問わない艦名）の照合や、定義画面で知らない艦名を警告するときに使う。
import type { ShipMaster } from "./types";

/**
 * 艦名（例「時雨改二」）から改装段階を問わない艦名（例「時雨」）を引く。
 * - 改装段階を問わない艦名そのもの（例「時雨」）を渡したときは、その艦名を返す
 * - 前後の空白（全角の空白も含む）は無視する
 * - マスタにない艦名・空の文字列は null
 */
export function baseNameOfShipName(master: ShipMaster, shipName: string): string | null {
  void master;
  void shipName;
  throw new Error("未実装");
}
