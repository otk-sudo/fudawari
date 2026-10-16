"use client";

import type { ReactNode } from "react";
import { useLatestDefinition } from "@/lib/definition";
import { DefinitionLoadAlert } from "./DefinitionLoadAlert";
import { ScreenHeader } from "./ScreenHeader";

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
 * - 読み込み・検証に失敗したら、ヘッダー帯の下に理由と次の行動を出す（DefinitionLoadAlert。role="alert"）
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
