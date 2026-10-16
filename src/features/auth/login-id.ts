// ログインの ID（管理者が発行する。U3）の検証と、Supabase Auth に渡すメールアドレスの形への変換。
// ID は英小文字・数字・ハイフンの 3〜32 文字で、内部では「ID@fudawari.invalid」（予約済みのドメイン。メールは送らない）にする

/** 使える ID の形（英小文字・数字・ハイフンの 3〜32 文字） */
const LOGIN_ID_PATTERN = /^[a-z0-9-]{3,32}$/;

/** ID の後ろに付けるドメイン（docs/design/database.md 2.1.1。register_collaborator もこのドメインかを確かめる） */
const LOGIN_EMAIL_DOMAIN = "fudawari.invalid";

/** ID の形が違うときに出す理由（ログインの画面と協力者の画面で同じ文を使う） */
export const LOGIN_ID_RULE_MESSAGE = "ID は英小文字・数字・ハイフンの 3〜32 文字で入れてください";

/** ID が使える形（英小文字・数字・ハイフンの 3〜32 文字）かを返す */
export function isValidLoginId(loginId: string): boolean {
  return LOGIN_ID_PATTERN.test(loginId);
}

/** ID を Supabase Auth に渡すメールアドレス（「ID@fudawari.invalid」）に変える。形は isValidLoginId で先に確かめておく */
export function loginIdToEmail(loginId: string): string {
  return `${loginId}@${LOGIN_EMAIL_DOMAIN}`;
}
