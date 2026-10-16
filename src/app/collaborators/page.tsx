import type { Metadata } from "next";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

const TITLE = "協力者";

export const metadata: Metadata = { title: TITLE };

// 協力者（要件 3.8、モック Collaborators.dc.html。管理者専用）。中身は PR-10 で作る
export default function CollaboratorsPage() {
  return (
    <>
      <ScreenHeader title={TITLE} />
      <ScreenPlaceholder />
    </>
  );
}
