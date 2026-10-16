import type { Metadata } from "next";
import { ImportScreen } from "@/features/import/ImportScreen";
import { IMPORT_SCREEN_TITLE } from "@/features/import/import-screen-text";

export const metadata: Metadata = { title: IMPORT_SCREEN_TITLE };

// 取り込み（要件 3.4、モック Import.dc.html）。画面名（h1）を含むヘッダー帯も ImportScreen が描く
// （ヘッダーに札割りのデータの「最終取り込み」を出すため）
export default function ImportPage() {
  return <ImportScreen />;
}
