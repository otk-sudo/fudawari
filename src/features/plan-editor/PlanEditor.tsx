"use client";

import { type ReactNode, useEffect, useState } from "react";
import { DefinitionEditor } from "./DefinitionEditor";
import { EditorHeader } from "./EditorHeader";
import { errorMessage } from "./editor-model";
import type { DefinitionRepository, PlanEditorData } from "./types";
import styles from "./PlanEditor.module.css";

export type PlanEditorProps = {
  /** 定義の保管庫（読み込み・下書きの保存・公開・イベントの作成と更新） */
  repository: DefinitionRepository;
  /**
   * 艦船マスタにある「改装段階を問わない艦名」の集合（知らない艦名の警告に使う。PR-02 レビュー 4）。
   * 省略（undefined）なら警告しない
   */
  knownShipNames?: ReadonlySet<string>;
};

/** 保管庫の読み込みの状態 */
type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly data: PlanEditorData }
  | { readonly status: "error"; readonly message: string };

/**
 * イベント定義の画面（要件 3.7、モック PlanEditor.dc.html）。ヘッダー帯（h1「イベント定義」）から本文までを描く。
 * 権限は保管庫の load() が返す user.role（DB の値）で出し分ける。
 *
 * - 読み込み中：「読み込んでいます」（下書きの保存などのボタンは出さない）
 * - 読み込みの失敗：読み込めなかったこと・理由・再読み込みの案内を警告（role="alert"）で出し、本文は出さない
 * - 読み込めたら：本文（DefinitionEditor）
 */
export function PlanEditor({ repository, knownShipNames }: PlanEditorProps): ReactNode {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    // 画面を離れた後（または保管庫が替わった後）に届いた結果は捨てる
    let current = true;
    repository.load().then(
      (data) => {
        if (current) setState({ status: "loaded", data });
      },
      (error: unknown) => {
        if (current) setState({ status: "error", message: errorMessage(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [repository]);

  return (
    <div className={styles.root}>
      <EditorHeader user={state.status === "loaded" ? state.data.user : null} />
      {state.status === "loading" && (
        <div className={styles.body}>
          <p role="status" className={styles.loading}>
            読み込んでいます…
          </p>
        </div>
      )}
      {state.status === "error" && (
        <div className={styles.body}>
          <div role="alert" className={styles.loadError}>
            <p className={styles.loadErrorTitle}>イベント定義を読み込めませんでした</p>
            <p className={styles.loadErrorReason}>{state.message}</p>
            <p>ページを再読み込みしてください</p>
          </div>
        </div>
      )}
      {state.status === "loaded" && (
        <DefinitionEditor data={state.data} repository={repository} knownShipNames={knownShipNames} />
      )}
    </div>
  );
}
