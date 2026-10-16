// Supabase に接続するための設定（環境変数）を読む。
// 使うのは管理者・協力者の画面（ログイン・協力者・イベント定義）だけ。一般利用者の画面は Supabase に通信しない（CLAUDE.md）

/** Supabase の接続先 */
export type SupabaseConfig = {
  /** プロジェクトの URL（環境変数 NEXT_PUBLIC_SUPABASE_URL） */
  url: string;
  /** 画面に置いてよい公開用のキー（環境変数 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY） */
  publishableKey: string;
};

/**
 * 環境変数から接続先を読む。どちらかがない（空の文字列を含む）ときは null（画面は「ログインの設定がありません」と出し、通信しない）。
 * Next.js は `process.env.NEXT_PUBLIC_…` をビルドのときに値へ書き換えるため、変数名をそのまま書いて読むこと。
 * 呼ぶたびに読む（テストでは vi.stubEnv で差し替える）
 */
export function readSupabaseConfig(): SupabaseConfig | null {
  // 書き換えの対象にするため、process.env の分割代入や変数名の組み立てはしない
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (url === undefined || url === "" || publishableKey === undefined || publishableKey === "") {
    return null;
  }
  return { url, publishableKey };
}
