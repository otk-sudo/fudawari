import type { Metadata } from "next";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

const TITLE = "計画と実際の札";

export const metadata: Metadata = { title: TITLE };

// 差分（要件 3.5、モック Drift.dc.html）。中身は PR-08 で作る
export default function DriftPage() {
  return (
    <>
      <ScreenHeader title={TITLE} />
      <ScreenPlaceholder />
    </>
  );
}
