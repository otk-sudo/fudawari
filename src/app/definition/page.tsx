import type { Metadata } from "next";
import { DEFINITION_TITLE, DefinitionPageContent } from "@/features/plan-editor";

export const metadata: Metadata = { title: DEFINITION_TITLE };

// イベント定義（要件 3.7、モック PlanEditor.dc.html。管理者・協力者専用）。
// 一般利用者には拒否の表示を出す（中身は src/features/plan-editor の DefinitionScreen）
export default function DefinitionPage() {
  return <DefinitionPageContent />;
}
