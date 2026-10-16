import type { ReactNode } from "react";
import type { DefinitionLoadError } from "@/lib/definition";
import styles from "./DefinitionLoadAlert.module.css";

export type DefinitionLoadAlertProps = {
  /** 読み込みの失敗の理由（@/lib/definition の useLatestDefinition が返す） */
  error: DefinitionLoadError;
};

/**
 * 最新イベントの公開定義を読み込めなかったことを知らせる警告（role="alert"）。ヘッダー帯の下に置く。
 * 一覧・割り振り・差分（LatestEventScreenHeader）とホームで同じものを使う。
 *
 * 書くこと：読み込めなかったこと、その理由（取得の失敗の状態コード、検証の誤りの文など）、次の行動（再読み込み）
 */
export function DefinitionLoadAlert({ error }: DefinitionLoadAlertProps): ReactNode {
  return (
    <div className={styles.body}>
      <div role="alert" className={styles.alert}>
        <p className={styles.title}>イベントの定義を読み込めませんでした</p>
        <p className={styles.reason}>{error.message}</p>
        <p className={styles.advice}>ページを再読み込みしてください</p>
      </div>
    </div>
  );
}
