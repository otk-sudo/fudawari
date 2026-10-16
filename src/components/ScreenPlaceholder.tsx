import type { ReactNode } from "react";
import styles from "./ScreenPlaceholder.module.css";

/**
 * まだ中身を作っていない画面の本文。各画面の機能を作るときに置き換える。
 */
export function ScreenPlaceholder(): ReactNode {
  return (
    <div className={styles.body}>
      <p className={styles.text}>この画面は準備中です。</p>
    </div>
  );
}
