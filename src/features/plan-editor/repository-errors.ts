// 定義の保管庫の失敗のうち、画面が見分けるもの（supabase-js を読み込まない。画面の部品から使う）

/** ログインし直してもらうときの理由の文 */
export const MSG_SIGN_IN_AGAIN = "ログインが切れています。ログインし直してください";

/**
 * Supabase のセッションがない・期限が切れている（別のタブでのログアウトを含む）ときの失敗。
 * 定義画面は、読み込みがこの失敗なら、保存した権限を消してログインし直す案内を出す（協力者画面と同じ扱い）
 */
export class SessionExpiredError extends Error {
  constructor(message: string = MSG_SIGN_IN_AGAIN) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

/** セッションがない・期限が切れているという失敗か */
export function isSessionExpiredError(error: unknown): error is SessionExpiredError {
  return error instanceof SessionExpiredError;
}
