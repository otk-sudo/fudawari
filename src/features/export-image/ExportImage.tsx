import type { ReactNode } from "react";
import type { PublicDefinition } from "@/domain/definition";
import type { ShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";

/** 出力する画像 1 枚（ExportImage）に渡すもの */
export interface ExportImageProps {
  /** 最新イベントの公開定義（イベント名・攻略の流れ・札） */
  definition: PublicDefinition;
  /** 艦船マスタ（艦名を引く） */
  master: ShipMaster;
  /** 取り込んだ艦の個体 */
  ships: readonly OwnedShip[];
  /** 最新イベントの割り当て（個体 ID → 札 ID） */
  assignments: AssignmentMap;
  /** この 1 枚に入れる札の ID（最大 6。渡した順に列を並べる） */
  fudaIds: readonly string[];
  /** 何枚目か（1 から） */
  page: number;
  /** 全部で何枚か（1 なら「n / m」を出さない） */
  pageCount: number;
}

/**
 * 画像で保存で出力する画像 1 枚（1600×900。要件 3.9、モック ExportImage.dc.html。roadmap T2-10）の DOM。
 * modern-screenshot でこの DOM を PNG にする。
 *
 * PR-07 のテストを先に書いた段階の空の入れ物（中身は実装の担当が作る）。
 * テストが探す形は src/test/list-screen.ts の冒頭にまとめてある。
 */
export function ExportImage(props: ExportImageProps): ReactNode {
  void props;
  return null;
}
