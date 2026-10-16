import type { ReactNode } from "react";
import styles from "./StandaloneScreen.module.css";

export type StandaloneScreenProps = {
  /** 画面名（h1） */
  title: string;
  children?: ReactNode;
};

/**
 * 左メニューを出さない単独の画面（ログイン、招待）の枠。中央に 1 枚の面を置く。
 * 左メニューを出さない画面の判定は `@/lib/routes` の isStandalonePath。
 */
export function StandaloneScreen({ title, children }: StandaloneScreenProps): ReactNode {
  return (
    <main className={styles.main}>
      <div className={styles.panel}>
        <h1 className={styles.title}>{title}</h1>
        {children}
      </div>
    </main>
  );
}
