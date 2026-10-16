"use client";

import type { ReactNode } from "react";
import { type DefinitionLoadError, useLatestDefinition } from "@/lib/definition";
import { ScreenHeader } from "./ScreenHeader";
import styles from "./LatestEventScreenHeader.module.css";

export type LatestEventScreenHeaderProps = {
  /** 画面名（h1） */
  title: string;
  /** 補足の右に置くもの（主なボタンなど。各画面で使う） */
  children?: ReactNode;
};

/**
 * 最新イベントの公開定義を使う画面（一覧・割り振り・差分）のヘッダー帯（要件 3.0、roadmap T2-3）。
 *
 * - 読み込めたら、画面名の右に最新イベント名を出す（開催中かどうかによらない。イベントを選ぶ欄は置かない）
 * - 読み込み・検証に失敗したら、ヘッダー帯の下に理由を出す（role="alert"）
 * - 読み込み中は、イベント名も理由も出さない
 */
export function LatestEventScreenHeader({ title, children }: LatestEventScreenHeaderProps): ReactNode {
  const state = useLatestDefinition();

  return (
    <>
      <ScreenHeader
        title={title}
        eventName={state.status === "success" ? state.definition.event.name : undefined}
      >
        {children}
      </ScreenHeader>
      {state.status === "error" && <DefinitionLoadAlert error={state.error} />}
    </>
  );
}

/** 公開定義を読み込めなかったことと、その理由（取得の失敗の状態コード、検証の誤りの文など） */
function DefinitionLoadAlert({ error }: { error: DefinitionLoadError }): ReactNode {
  return (
    <div className={styles.body}>
      <div role="alert" className={styles.alert}>
        <p className={styles.alertTitle}>イベントの定義を読み込めませんでした</p>
        <p className={styles.alertReason}>{error.message}</p>
      </div>
    </div>
  );
}
