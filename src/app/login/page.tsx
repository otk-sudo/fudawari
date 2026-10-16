import type { Metadata } from "next";
import { StandaloneScreen } from "@/components/StandaloneScreen";
// "use client" の部品はファイルから直接読み込む（@/features/auth の入口は hooks のファイルも含み、Server Component からは読めない）
import { LoginForm } from "@/features/auth/LoginForm";

const TITLE = "管理者・協力者のログイン";

export const metadata: Metadata = { title: TITLE };

// 管理者・協力者のログイン（U3・U14：一般の画面からはリンクせず、ブックマークして使う）。左メニューは出さない。
// ID とパスワードは管理者が発行する（要件 3.8）。ログインできたらホームへ移る
export default function LoginPage() {
  return (
    <StandaloneScreen title={TITLE}>
      <LoginForm />
    </StandaloneScreen>
  );
}
