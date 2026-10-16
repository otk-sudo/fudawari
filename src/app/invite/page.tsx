import type { Metadata } from "next";
import { ScreenHeader } from "@/components/ScreenHeader";
// 部品はファイルから直接読み込む（@/features/collaborators の入口は hooks のファイルも含み、Server Component からは読めない）
import { InviteRetiredNotice } from "@/features/collaborators/InviteRetiredNotice";

const TITLE = "協力者への招待";

export const metadata: Metadata = { title: TITLE };

// 協力者への招待（2026-10-17 にやめた。U3・U19）。古いリンクを開いた人に、使われなくなったことだけを伝える。
// 単独の画面ではなくなったので、ほかの画面と同じく左メニューを出す
export default function InvitePage() {
  return (
    <>
      <ScreenHeader title={TITLE} />
      <InviteRetiredNotice />
    </>
  );
}
