import type { ReactNode } from "react";
import styles from "./ScreenHeader.module.css";

export type ScreenHeaderProps = {
  /** 画面名（h1）。画面の h1 はこの 1 つだけにする */
  title: string;
  /**
   * 画面名の右に出す最新イベント名（例「2026夏イベ」。モックの札型の表示）。なければ出さない。
   * 一覧・割り振り・差分は LatestEventScreenHeader から公開定義のイベント名を渡す。
   * 前に読み上げ用の「最新イベント：」（画面には出さない）を付ける
   */
  eventName?: string;
  /** 画面名（とイベント名）の右に出す補足（例「開催中：2026夏イベ」）。なければ出さない */
  note?: ReactNode;
  /** 補足の右に置くもの（主なボタンなど。各画面で使う） */
  children?: ReactNode;
};

/**
 * 各画面の上部のヘッダー帯（モックの各画面の上部と同じ形）。画面名の h1 を含む。
 *
 * イベント名の前には、画面には出さない（視覚的に隠した）「最新イベント：」を置き、
 * 読み上げでは「最新イベント：（イベント名）」と続けて読まれるようにする（間に空白を入れない）。
 */
export function ScreenHeader({ title, eventName, note, children }: ScreenHeaderProps): ReactNode {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {eventName !== undefined && (
        <>
          <span className={styles.visuallyHidden}>最新イベント：</span>
          <span className={styles.eventName}>{eventName}</span>
        </>
      )}
      {note !== undefined && <span className={styles.note}>{note}</span>}
      {children}
    </header>
  );
}
