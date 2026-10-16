import type { Metadata } from "next";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

const TITLE = "イベント定義";

export const metadata: Metadata = { title: TITLE };

// イベント定義（要件 3.7、モック PlanEditor.dc.html。管理者・協力者専用）。中身は PR-11 で作る
export default function DefinitionPage() {
  return (
    <>
      <ScreenHeader title={TITLE} />
      <ScreenPlaceholder />
    </>
  );
}
