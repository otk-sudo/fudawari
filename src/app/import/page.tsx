import type { Metadata } from "next";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

const TITLE = "艦娘の取り込み";

export const metadata: Metadata = { title: TITLE };

// 取り込み（要件 3.4、モック Import.dc.html）。中身は PR-04 で作る
export default function ImportPage() {
  return (
    <>
      <ScreenHeader title={TITLE} />
      <ScreenPlaceholder />
    </>
  );
}
