// 権限の 1 つの入口。画面・部品はここからだけ読み込む。
// - 一般の画面（左メニュー・ホーム・設定）も読み込むので、ここから supabase-js を静的に読み込まない（session.ts が必要なときに読む）
// - Server Component のページ（metadata を書く page.tsx）は、"use client" の部品（LoginForm など）をファイルから直接読み込む
//   （この入口は hooks を使うファイルも読み込むため、Server Component から読むとビルドが通らない）
export { setRole, useRole, useRoleReady } from "./role";
export type { Role } from "./role";
export { isValidLoginId, LOGIN_ID_RULE_MESSAGE, loginIdToEmail } from "./login-id";
export { signIn, signOut, useAccount } from "./session";
export type { Account, SignInFailure, SignInResult } from "./session";
export { AccountSection } from "./AccountSection";
export { LoginForm } from "./LoginForm";
