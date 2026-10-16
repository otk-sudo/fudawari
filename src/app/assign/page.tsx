import type { Metadata } from "next";
import { ASSIGN_SCREEN_TITLE, AssignPageContent } from "@/features/assign";

export const metadata: Metadata = { title: ASSIGN_SCREEN_TITLE };

// 割り振り（要件 3.3、モック Assign.dc.html）。読み込み・出し分け・中身は AssignPageContent。
// ドラッグ＆ドロップと 600 隻の仮想スクロールは PR-06 で足す
export default function AssignPage() {
  return <AssignPageContent />;
}
