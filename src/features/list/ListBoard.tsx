import type { ReactNode } from "react";
import type { PublicDefinition } from "@/domain/definition";
import type { ShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";

/** 一覧の本文（ListBoard）に渡すもの。どれも読み込み済みの値（読み込み中・失敗・未取り込みの出し分けはページ側で行う） */
export interface ListBoardProps {
  /** 最新イベントの公開定義 */
  definition: PublicDefinition;
  /** 艦船マスタ（艦 ID から艦名・艦種を引く） */
  master: ShipMaster;
  /** 取り込んだ艦の個体 */
  ships: readonly OwnedShip[];
  /** 最新イベントの割り当て（個体 ID → 札 ID） */
  assignments: AssignmentMap;
}

/**
 * 一覧の本文（要件 3.2、モック Main.dc.html。roadmap T2-9）：攻略の流れ、表示の切り替え、札ごとの行。
 * 見るだけの画面で、割り振りの操作はしない。
 *
 * PR-07 のテストを先に書いた段階の空の入れ物（中身は実装の担当が作る）。
 * テストが探す形は src/test/list-screen.ts の冒頭にまとめてある。
 */
export function ListBoard(props: ListBoardProps): ReactNode {
  void props;
  return null;
}
