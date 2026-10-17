"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { DefinitionEditor } from "./DefinitionEditor";
import { EditorHeader } from "./EditorHeader";
import { errorMessage } from "./editor-model";
import type { PresenceConnector } from "./presence/types";
import { isSessionExpiredError } from "./repository-errors";
import type { SaveLogLoader } from "./save-log/types";
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
  /**
   * 読み込みが「セッションがない・期限切れ」（SessionExpiredError）で失敗したときに呼ぶ（省略なら、ほかの失敗と同じく理由を出す）。
   * 関数が変わっても読み込み直さない（読み込みが失敗したときの最新の関数を呼ぶ）
   */
  onSessionExpired?: () => void;
  /** 保存の記録を読む（PR-12。「保存の記録を見る」のウィンドウで使う。省略なら「保存の記録を見る」を出さない） */
  loadSaveLogs?: SaveLogLoader;
  /**
   * 編集中の表示のチャンネルにつなぐ（PR-12。「（名前）も編集中（E3 を表示中）」に使う。省略なら出さない）。
   * 同じ関数を渡し続けること（変わるとつなぎ直す）
   */
  connectPresence?: PresenceConnector;
};

/** 保管庫の読み込みの状態（loaded の key は読み込みごとに変わる番号。編集画面をその読み込みの内容で作り直すために使う） */
type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly data: PlanEditorData; readonly key: number }
  | { readonly status: "error"; readonly message: string };

const LOADING: LoadState = { status: "loading" };

/**
 * イベント定義の画面（要件 3.7、モック PlanEditor.dc.html）。ヘッダー帯（h1「イベント定義」）から本文までを描く。
 * 権限は保管庫の load() が返す user.role（DB の値）で出し分ける。
 *
 * - 読み込み中：「読み込んでいます」（下書きの保存などのボタンは出さない）
 * - 読み込みの失敗：読み込めなかったこと・理由・再読み込みの案内を警告（role="alert"）で出し、本文は出さない
 * - 読み込めたら：本文（DefinitionEditor）
 * - 保管庫が変わったら：読み込み中に戻し、新しい保管庫の内容で編集画面を作り直す（前の保管庫の内容・編集・版を持ち越さない）
 */
export function PlanEditor({
  repository,
  knownShipNames,
  onSessionExpired,
  loadSaveLogs,
  connectPresence,
}: PlanEditorProps): ReactNode {
  // 状態は、それを読んだ保管庫と組で持つ（保管庫が変わったら、新しい読み込みが済むまで読み込み中として描く）
  const [state, setState] = useState<{ readonly repository: DefinitionRepository; readonly load: LoadState }>(() => ({
    repository,
    load: LOADING,
  }));
  // 読み込みの通し番号（編集画面の key）
  const loadCountRef = useRef(0);
  // セッション切れのときに呼ぶ関数（最新のものを持つ。読み込みの効果の依存に入れず、関数が変わっても読み込み直さない）
  const onSessionExpiredRef = useRef(onSessionExpired);
  useEffect(() => {
    onSessionExpiredRef.current = onSessionExpired;
  });

  useEffect(() => {
    // 画面を離れた後（または保管庫が替わった後）に届いた結果は捨てる
    let current = true;
    repository.load().then(
      (data) => {
        if (!current) return;
        loadCountRef.current += 1;
        setState({ repository, load: { status: "loaded", data, key: loadCountRef.current } });
      },
      (error: unknown) => {
        if (!current) return;
        setState({ repository, load: { status: "error", message: errorMessage(error) } });
        if (isSessionExpiredError(error)) onSessionExpiredRef.current?.();
      },
    );
    return () => {
      current = false;
    };
  }, [repository]);

  const view = state.repository === repository ? state.load : LOADING;

  return (
    <div className={styles.root}>
      <EditorHeader user={view.status === "loaded" ? view.data.user : null} />
      {view.status === "loading" && (
        <div className={styles.body}>
          <p role="status" className={styles.loading}>
            読み込んでいます…
          </p>
        </div>
      )}
      {view.status === "error" && (
        <div className={styles.body}>
          <div role="alert" className={styles.loadError}>
            <p className={styles.loadErrorTitle}>イベント定義を読み込めませんでした</p>
            <p className={styles.loadErrorReason}>{view.message}</p>
            <p>ページを再読み込みしてください</p>
          </div>
        </div>
      )}
      {view.status === "loaded" && (
        <DefinitionEditor
          key={view.key}
          data={view.data}
          repository={repository}
          knownShipNames={knownShipNames}
          loadSaveLogs={loadSaveLogs}
          connectPresence={connectPresence}
        />
      )}
    </div>
  );
}
