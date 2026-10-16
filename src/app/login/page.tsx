import type { Metadata } from "next";
import { StandaloneScreen } from "@/components/StandaloneScreen";

const TITLE = "管理者・協力者のログイン";

export const metadata: Metadata = { title: TITLE };

// 管理者・協力者のログイン（U14：一般の画面からはリンクせず、ブックマークして使う）。左メニューは出さない。中身は PR-10 で作る
export default function LoginPage() {
  return (
    <StandaloneScreen title={TITLE}>
      <p>この画面は準備中です。</p>
    </StandaloneScreen>
  );
}
