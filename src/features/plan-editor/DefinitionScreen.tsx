"use client";

import type { ReactNode } from "react";
import { useRole } from "@/features/auth";
import { EditorHeader } from "./EditorHeader";
import { PlanEditor, type PlanEditorProps } from "./PlanEditor";
import styles from "./PlanEditor.module.css";

export type DefinitionScreenProps = PlanEditorProps;

/**
 * イベント定義のページの中身（src/app/definition/page.tsx から使う）。
 * - 一般利用者（useRole() が "user"）：h1「イベント定義」と「このページは管理者・協力者のみ使えます」を出し、保管庫は読まない
 * - 協力者・管理者：PlanEditor を描く（画面の出し分けは保管庫が返す DB の権限で行う。権限の強制は DB の RLS）
 */
export function DefinitionScreen(props: DefinitionScreenProps): ReactNode {
  const role = useRole();
  if (role === "user") {
    return (
      <div className={styles.root}>
        <EditorHeader user={null} />
        <div className={styles.body}>
          <p className={styles.denied}>このページは管理者・協力者のみ使えます</p>
        </div>
      </div>
    );
  }
  return <PlanEditor {...props} />;
}
