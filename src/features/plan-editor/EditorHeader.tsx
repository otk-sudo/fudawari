import type { ReactNode } from "react";
import { ScreenHeader } from "@/components/ScreenHeader";
import type { EditorRole, EditorUser } from "./types";
import styles from "./PlanEditor.module.css";

/** 画面名（h1） */
export const DEFINITION_TITLE = "イベント定義";

/** 権限の表示名 */
export const ROLE_LABELS: Readonly<Record<EditorRole, string>> = {
  admin: "管理者",
  collab: "協力者",
};

export type EditorHeaderProps = {
  /** ログイン中の人（読み込みの前・拒否の表示では null。「ログイン中：」を出さない） */
  user: EditorUser | null;
};

/**
 * 定義画面のヘッダー帯（モック PlanEditor.dc.html の上部）。
 * h1「イベント定義」、「管理者・協力者専用」、説明の文、「ログイン中：（名前）（権限）」
 */
export function EditorHeader({ user }: EditorHeaderProps): ReactNode {
  return (
    <ScreenHeader title={DEFINITION_TITLE}>
      <span className={styles.adminBadge}>管理者・協力者専用</span>
      <span className={styles.headerNote}>札・攻略の段階・特効を設定します。公開すると全員の割り振り画面に反映されます</span>
      {user !== null && (
        <>
          <span className={styles.headerSpacer} aria-hidden="true" />
          <span className={styles.loginName}>
            ログイン中：{user.displayName}（{ROLE_LABELS[user.role]}）
          </span>
        </>
      )}
    </ScreenHeader>
  );
}
