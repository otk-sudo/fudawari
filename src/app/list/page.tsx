import type { Metadata } from "next";
import { ListPageContent } from "@/features/list/ListPageContent";
import { LIST_SCREEN_TITLE } from "@/features/list/title";

export const metadata: Metadata = { title: LIST_SCREEN_TITLE };

// 一覧（要件 3.2、モック Main.dc.html）と画像で保存（要件 3.9）。読み込み・出し分け・中身は ListPageContent
export default function ListPage() {
  return <ListPageContent />;
}
