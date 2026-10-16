// 招待（2026-10-17 にやめた。U3・U19）の古いリンク（/invite）を開いた人への案内。
// 協力者の追加は、管理者が ID とパスワードを発行する形に変わった（要件 3.8）。hooks を使わないので Server Component からも置ける
import Link from "next/link";
import type { ReactNode } from "react";
import { ROUTES } from "@/lib/routes";
import styles from "./CollaboratorsScreen.module.css";

export function InviteRetiredNotice(): ReactNode {
  return (
    <div className={styles.denied}>
      <p className={styles.deniedTitle}>このページは使われなくなりました</p>
      <p className={styles.deniedNote}>協力者の追加は、管理者が ID とパスワードを発行します</p>
      <Link href={ROUTES.home} className={styles.link}>
        ホームに戻る
      </Link>
    </div>
  );
}
