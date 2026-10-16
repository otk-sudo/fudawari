// ログインの ID（管理者が発行する。U3）の検証と、Supabase Auth に渡すメールアドレスの形への変換。
// ID は英小文字・数字・ハイフンの 3〜32 文字で、内部では「ID@fudawari.invalid」（予約済みのドメイン。メールは送らない）にする
//
// PR-10b のテスト（login-id.test.ts）を先に書いた段階の入れ物。中身は実装の担当が書く

/** ID が使える形（英小文字・数字・ハイフンの 3〜32 文字）かを返す */
export const isValidLoginId: (loginId: string) => boolean = () => false;

/** ID を Supabase Auth に渡すメールアドレス（「ID@fudawari.invalid」）に変える。形は isValidLoginId で先に確かめておく */
export const loginIdToEmail: (loginId: string) => string = () => "";
