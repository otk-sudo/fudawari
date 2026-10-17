// 協力者画面のヘッダー帯（要件 3.8、モック Collaborators.dc.html）：h1「協力者」、「管理者専用」、説明。
// 権限によらず同じものを出す（管理者以外にも見出しは出し、本文で拒否の表示をする）。hooks を使わないので Server Component からも置ける
import type { ReactNode } from "react";
import { ScreenHeader } from "@/components/ScreenHeader";
import styles from "./CollaboratorsScreen.module.css";

export type CollaboratorsHeaderProps = {
  /** 画面名（h1） */
  title: string;
};

export function CollaboratorsHeader({ title }: CollaboratorsHeaderProps): ReactNode {
  return (
    <ScreenHeader title={title}>
      <span className={styles.adminOnlyBadge}>管理者専用</span>
      <span className={styles.headerNote}>イベント定義を編集できる人を管理します</span>
    </ScreenHeader>
  );
}
