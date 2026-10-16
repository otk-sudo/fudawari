import type { Metadata } from "next";
import { LatestEventScreenHeader } from "@/components/LatestEventScreenHeader";
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

const TITLE = "割り振り";

export const metadata: Metadata = { title: TITLE };

// 割り振り（要件 3.3、モック Assign.dc.html）。中身は PR-05・PR-06 で作る
export default function AssignPage() {
  return (
    <>
      <LatestEventScreenHeader title={TITLE} />
      <ScreenPlaceholder />
    </>
  );
}
