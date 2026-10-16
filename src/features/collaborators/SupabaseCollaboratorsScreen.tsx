"use client";

// 協力者画面の本文を、Supabase の保管庫につないで出す（/collaborators のページが置く）。
// 保管庫（関数を持つオブジェクト）は Server Component のページから渡せないため、ここ（Client Component）で作る。
// 保管庫は作っただけでは Supabase のクライアントを作らず、管理者が開いたときだけ通信する
import { type ReactNode, useState } from "react";
import { CollaboratorsScreen } from "./CollaboratorsScreen";
import { createSupabaseCollaboratorRepository } from "./supabase-repository";

export function SupabaseCollaboratorsScreen(): ReactNode {
  // 描き直しのたびに作り直さない（作り直すと一覧を読み直してしまう）
  const [repository] = useState(createSupabaseCollaboratorRepository);
  return <CollaboratorsScreen repository={repository} />;
}
