import type { ReactNode } from "react";
import styles from "./ScreenHeader.module.css";

export type ScreenHeaderProps = {
  /** 画面名（h1）。画面の h1 はこの 1 つだけにする */
  title: string;
  /** 画面名の右に出す補足（例「開催中：2026夏イベ」）。なければ出さない */
  note?: ReactNode;
  /** 補足の右に置くもの（主なボタンなど。各画面で使う） */
  children?: ReactNode;
};

/**
 * 各画面の上部のヘッダー帯（モックの各画面の上部と同じ形）。画面名の h1 を含む。
 */
export function ScreenHeader({ title, note, children }: ScreenHeaderProps): ReactNode {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {note !== undefined && <span className={styles.note}>{note}</span>}
      {children}
    </header>
  );
}
