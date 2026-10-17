// 画面テスト（Playwright）で「Supabase への通信」を見分ける判定（e2e/no-supabase.spec.ts・e2e/permissions.spec.ts で共通に使う）
//
// 接続先の URL はビルドのときの環境変数（NEXT_PUBLIC_SUPABASE_URL）で決まり、入っていないこともあるため、
// 次のどれかに当たる通信を「Supabase への通信」とみなす
// - 環境変数 NEXT_PUBLIC_SUPABASE_URL（あれば）で始まる
// - ホスト名が supabase.co・supabase.in・supabase.net で終わる
// - パスが Supabase の API（/auth/v1/・/rest/v1/・/realtime/v1/・/storage/v1/・/functions/v1/）で始まる
//
// Playwright から読むので、Vitest や Testing Library を読み込まない。

const SUPABASE_API_PATHS = ["/auth/v1/", "/rest/v1/", "/realtime/v1/", "/storage/v1/", "/functions/v1/"];
const SUPABASE_HOST_SUFFIXES = [".supabase.co", ".supabase.in", ".supabase.net"];

/** URL が Supabase への通信（HTTP・WebSocket）か */
export function isSupabaseUrl(url: string): boolean {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (configured !== undefined && configured !== "" && url.startsWith(configured)) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    SUPABASE_HOST_SUFFIXES.some((suffix) => parsed.hostname.endsWith(suffix)) ||
    SUPABASE_API_PATHS.some((path) => parsed.pathname.startsWith(path))
  );
}
