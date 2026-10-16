"use client";

// 協力者画面の本文（要件 3.8、モック Collaborators.dc.html。招待の欄は「協力者を追加」に置き換える）。
// 権限は `@/features/auth` の useRole() から受け取り、管理者以外には拒否の表示だけを出す（保管庫は呼ばない）。
// 画面名のヘッダー帯（h1「協力者」・「管理者専用」・説明）は src/app/collaborators/page.tsx が置く
//
// PR-10b のテスト（CollaboratorsScreen.test.tsx）を先に書いた段階の入れ物。中身は実装の担当が書く
import type { ReactNode } from "react";
import type { CollaboratorRepository } from "./types";

export type CollaboratorsScreenProps = {
  /** 協力者の保管庫（本番は createSupabaseCollaboratorRepository()、テストでは偽物） */
  repository: CollaboratorRepository;
};

export const CollaboratorsScreen: (props: CollaboratorsScreenProps) => ReactNode = () => null;
