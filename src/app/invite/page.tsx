import type { Metadata } from "next";
import { StandaloneScreen } from "@/components/StandaloneScreen";

const TITLE = "協力者への招待";

export const metadata: Metadata = { title: TITLE };

// 協力者への招待（U19：/invite/（コード）はこの画面に書き換えて渡し、コードは画面側で読む）。左メニューは出さない。中身は PR-10 で作る
export default function InvitePage() {
  return (
    <StandaloneScreen title={TITLE}>
      <p>この画面は準備中です。</p>
    </StandaloneScreen>
  );
}
