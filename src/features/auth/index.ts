// 権限の 1 つの入口。画面・部品はここからだけ読み込む
export { setRole, useRole } from "./role";
export type { Role } from "./role";
export { isValidLoginId, loginIdToEmail } from "./login-id";
export { signIn, signOut, useAccount } from "./session";
export type { Account, SignInFailure, SignInResult } from "./session";
export { AccountSection } from "./AccountSection";
