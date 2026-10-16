import type { Metadata } from "next";
// 部品はファイルから直接読み込む（@/features/collaborators の入口は hooks のファイルも含み、Server Component からは読めない）
import { CollaboratorsHeader } from "@/features/collaborators/CollaboratorsHeader";
import { SupabaseCollaboratorsScreen } from "@/features/collaborators/SupabaseCollaboratorsScreen";

const TITLE = "協力者";

export const metadata: Metadata = { title: TITLE };

// 協力者（要件 3.8、モック Collaborators.dc.html。管理者専用）。
// ヘッダー帯は全員に出し、本文は管理者なら ID とパスワードの発行・編集できる人の表、それ以外なら拒否の表示
export default function CollaboratorsPage() {
  return (
    <>
      <CollaboratorsHeader title={TITLE} />
      <SupabaseCollaboratorsScreen />
    </>
  );
}
