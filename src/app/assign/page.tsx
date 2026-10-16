import type { Metadata } from "next";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

const TITLE = "割り振り";

export const metadata: Metadata = { title: TITLE };

// 割り振り（要件 3.3、モック Assign.dc.html）。中身は PR-05・PR-06 で作る
export default function AssignPage() {
  return (
    <>
      <ScreenHeader title={TITLE} />
      <ScreenPlaceholder />
    </>
  );
}
