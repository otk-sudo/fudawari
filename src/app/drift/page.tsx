import type { Metadata } from "next";
import { DRIFT_SCREEN_TITLE, DriftPageContent } from "@/features/drift";

export const metadata: Metadata = { title: DRIFT_SCREEN_TITLE };

// 差分（要件 3.5、モック Drift.dc.html）。読み込み・出し分け・中身は DriftPageContent
export default function DriftPage() {
  return <DriftPageContent />;
}
