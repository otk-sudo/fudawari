// 協力者画面（要件 3.8）の入口。
// Server Component のページ（metadata を書く page.tsx）は、部品をファイルから直接読み込む
// （この入口は hooks を使うファイルも読み込むため、Server Component から読むとビルドが通らない）
export { CollaboratorsHeader } from "./CollaboratorsHeader";
export type { CollaboratorsHeaderProps } from "./CollaboratorsHeader";
export { CollaboratorsScreen } from "./CollaboratorsScreen";
export type { CollaboratorsScreenProps } from "./CollaboratorsScreen";
export { InviteRetiredNotice } from "./InviteRetiredNotice";
export { generatePassword } from "./password";
export { SupabaseCollaboratorsScreen } from "./SupabaseCollaboratorsScreen";
export { createSupabaseCollaboratorRepository } from "./supabase-repository";
export type {
  Collaborator,
  CollaboratorError,
  CollaboratorRepository,
  CollaboratorResult,
  CollaboratorRole,
  IssueCollaboratorInput,
} from "./types";
