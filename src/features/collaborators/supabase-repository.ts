// 協力者の保管庫の Supabase の実装（docs/design/database.md 2.1.1・4 章）。
//
// - 一覧：profiles の全行（RLS で管理者・協力者は全行を読める）
// - 発行：保存しない別のクライアント（createIssuingSupabaseClient）で auth.signUp（ID は「ID@fudawari.invalid」）し、
//   返った user ID を、ふだんのクライアント（管理者のログイン）で rpc("register_collaborator", { p_user_id, p_display_name }) に渡す
// - 外す：ふだんのクライアントで rpc("remove_collaborator", { p_user_id })
// - クライアントは、各操作を呼んだときに作る（保管庫を作っただけでは作らない）
//
// PR-10b のテスト（supabase-repository.test.ts）を先に書いた段階の入れ物。中身は実装の担当が書く
import type { CollaboratorRepository } from "./types";

export const createSupabaseCollaboratorRepository: () => CollaboratorRepository = () => ({
  list: async () => ({ ok: false, error: "unknown" }),
  issue: async () => ({ ok: false, error: "unknown" }),
  remove: async () => ({ ok: false, error: "unknown" }),
});
