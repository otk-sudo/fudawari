import type { Metadata } from "next";
import { LatestEventScreenHeader } from "@/components/LatestEventScreenHeader";
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

const TITLE = "札割り一覧";

export const metadata: Metadata = { title: TITLE };

// 一覧（要件 3.2、モック Main.dc.html）。中身は PR-07 で作る
export default function ListPage() {
  return (
    <>
      <LatestEventScreenHeader title={TITLE} />
      <ScreenPlaceholder />
    </>
  );
}
