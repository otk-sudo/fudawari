// Supabase との境界の入口（管理者・協力者の画面だけが使う。一般の画面からは呼ばない）
export {
  createIssuingSupabaseClient,
  getSupabaseClient,
  resetSupabaseClient,
} from "./client";
export { readSupabaseConfig } from "./config";
export type { SupabaseConfig } from "./config";
