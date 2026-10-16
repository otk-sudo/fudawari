// supabase-js の失敗の見分け方（ログインと協力者の保管庫で同じ基準を使う）

/**
 * 表の読み取り・RPC の応答の状態コード（supabase-js の PostgrestResponse の status）が、
 * 「サーバーに届かなかった・サーバー側の障害」を表すか。
 * supabase-js は fetch の失敗を status 0 で返す。5xx（Supabase の停止・混雑など）も同じく扱い、
 * 画面では「通信に失敗しました。しばらくしてから…」と出す。
 * RPC の業務の例外（FD001 など）は 400 で返るので、ここには当たらない
 */
export function isUnreachableStatus(status: number): boolean {
  return status === 0 || status >= 500;
}

/**
 * 表の読み取り・RPC の失敗が、「権限がない・ログインが切れている」を表すか。
 * - 42501：権限がない（PostgreSQL の insufficient_privilege。RLS・GRANT で断られた）
 * - PGRST301：JWT が無効・期限切れ（PostgREST）
 * - 状態コード 401：ログインの情報が受け付けられなかった
 * 画面では「管理者でログインし直してください」と出す
 */
export function isPermissionFailure(code: string, status: number): boolean {
  return code === "42501" || code === "PGRST301" || status === 401;
}
