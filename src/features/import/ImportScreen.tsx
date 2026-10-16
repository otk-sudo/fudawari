"use client";

import type { ReactNode } from "react";

/**
 * 取り込み画面の本文（要件 3.4、モック Import.dc.html、roadmap T2-4）。
 *
 * いまはテスト（ImportScreen.test.tsx）を先に書いた段階の空の入れ物。中身は PR-04b の実装で作る。
 * 引数は取らず、艦船マスタ（useShipMaster）・最新イベントの定義（useLatestDefinition）・札割りのデータ（usePlanData）・
 * 保存先（getPlanStorage）を自分で読む想定。
 */
export function ImportScreen(): ReactNode {
  return null;
}
