"use client";

// 設定のウィンドウの「アカウント」欄（要件 3.6、モック SettingsDialog.dc.html）。
// 協力者・管理者のときだけ、見出し「アカウント」、「ログイン中：（名前）」「権限：管理者／協力者」、「ログアウト」を出す。
// 一般利用者には何も出さない（ログインのボタンも出さない。U14）。設定のウィンドウへの組み込みは PR-08 が行う
import { type ReactNode, useId, useState } from "react";
import type { Account } from "./account";
import { signOut, useAccount } from "./session";
import styles from "./AccountSection.module.css";

/** 権限の表示名 */
const ROLE_LABELS: Record<Account["role"], string> = {
  admin: "管理者",
  collab: "協力者",
};

export function AccountSection(): ReactNode {
  const account = useAccount();
  const headingId = useId();
  // ログアウトの二重押しを防ぐ
  const [signingOut, setSigningOut] = useState(false);

  if (account === null) return null;

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.title}>
        アカウント
      </h2>
      <div className={styles.body}>
        <div className={styles.info}>
          <span className={styles.name}>ログイン中：{account.displayName}</span>
          <span className={styles.role}>権限：{ROLE_LABELS[account.role]}</span>
        </div>
        <button
          type="button"
          className={styles.signOut}
          disabled={signingOut}
          onClick={() => void handleSignOut()}
        >
          ログアウト
        </button>
      </div>
    </section>
  );
}
