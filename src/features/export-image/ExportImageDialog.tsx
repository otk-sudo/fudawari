import type { ReactNode } from "react";
import type { PublicDefinition } from "@/domain/definition";
import type { ShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";

/** 画像で保存のウィンドウ（ExportImageDialog）に渡すもの */
export interface ExportImageDialogProps {
  /** 開いているか（開閉は呼ぶ側が持つ） */
  open: boolean;
  /** 開閉が変わるとき（×・「やめる」・背景のクリックで false） */
  onOpenChange: (open: boolean) => void;
  /** 最新イベントの公開定義 */
  definition: PublicDefinition;
  /** 艦船マスタ */
  master: ShipMaster;
  /** 取り込んだ艦の個体 */
  ships: readonly OwnedShip[];
  /** 最新イベントの割り当て（個体 ID → 札 ID） */
  assignments: AssignmentMap;
}

/**
 * 画像で保存のウィンドウ（要件 3.9、モック Main.dc.html の画像で保存。roadmap T2-10）。Radix UI の Dialog で作る。
 * 一覧の「画像で保存」から開く。
 *
 * PR-07 のテストを先に書いた段階の空の入れ物（中身は実装の担当が作る）。
 * テストが探す形は src/test/list-screen.ts の冒頭にまとめてある。
 */
export function ExportImageDialog(props: ExportImageDialogProps): ReactNode {
  void props;
  return null;
}
