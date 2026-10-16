"use client";

// 設定のウィンドウの「データ」（要件 3.6、U21、モック SettingsDialog.dc.html）
//
// - 札割りの書き出し・読み込み：最新イベントの札割りを U21 の JSON（{ formatVersion, eventId, assignments }）の .json ファイルとして
//   ダウンロードさせる。読み込みはファイルを選ぶ → 確認（「置き換える」）→ 共有の札割りのデータ（setAssignments）で置き換える。
//   読めないファイル・別のイベントのファイルは、確認を出さずに理由を知らせる（札割りできるのは最新のイベントだけ）
// - 取り込んだ艦娘データを削除：最終取り込みの日時と隻数を出し、確認の後に getPlanStorage().clearImportedShips() で
//   個体と最終取り込みを消してから、共有の札割りのデータを読み直す（札割りは残る）
// 札割りのデータは、ほかの画面と同じく最新イベントの定義から読む（usePlanData）。ファイルの読み書きはブラウザの中だけで行う。
import { type ChangeEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { parsePlanFile, serializePlanFile } from "@/domain/plan/planFile";
import type { AssignmentMap } from "@/domain/plan/types";
import { useLatestDefinition } from "@/lib/definition";
import { getPlanStorage, type PlanData, usePlanData } from "@/lib/plan";
import type { ImportRecord } from "@/lib/storage";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  DELETE_FAILED_MESSAGE,
  FILE_READ_FAILED_MESSAGE,
  formatImportedAt,
  otherEventMessage,
  planFileFailureMessage,
  planFileName,
} from "./settings-text";
import { useLatestRef } from "./useLatestRef";
import styles from "./SettingsContent.module.css";

/** 設定のウィンドウの「データ」 */
export function DataSettings(): ReactNode {
  const definitionState = useLatestDefinition();
  const definition = definitionState.status === "success" ? definitionState.definition : null;
  const fudaIds = useMemo(() => definition?.fudas.map((fuda) => fuda.id) ?? [], [definition]);
  const plan = usePlanData(definition?.event.id ?? null, fudaIds);
  const definitionFailed = definitionState.status === "error";
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        データ
      </h2>
      {plan.status === "error" && (
        <p role="alert" className={styles.rowAlert}>
          {`札割りのデータを読み込めませんでした。${plan.error.message}`}
        </p>
      )}
      <PlanFileRow plan={plan} eventName={definition?.event.name ?? null} definitionFailed={definitionFailed} />
      <ImportedShipsRow plan={plan} definitionFailed={definitionFailed} />
    </section>
  );
}

// ---- 札割りの書き出し・読み込み ----

type PlanFileRowProps = {
  /** 共有の札割りのデータ */
  plan: PlanData;
  /** 最新イベント名（定義を読めていなければ null） */
  eventName: string | null;
  /** 最新イベントの定義を読み込めなかったか（書き出し・読み込みはできない） */
  definitionFailed: boolean;
};

function PlanFileRow({ plan, eventName, definitionFailed }: PlanFileRowProps): ReactNode {
  const ready = plan.status === "ready";
  const latestPlan = useLatestRef(plan);
  const download = useDownload();
  const inputRef = useRef<HTMLInputElement>(null);
  /** 読み込めなかった・保存できなかった理由（なければ null） */
  const [message, setMessage] = useState<string | null>(null);
  /** 置き換える割り当て（確認中。確認していなければ null） */
  const [pending, setPending] = useState<AssignmentMap | null>(null);

  function exportPlan(): void {
    if (plan.status !== "ready") return;
    setMessage(null);
    download(serializePlanFile(plan.eventId, plan.assignments), planFileName(plan.eventId));
  }

  /** 選んだファイルを読み、最新イベントの札割りなら確認を出す */
  async function readFile(file: File): Promise<void> {
    let text: string;
    try {
      text = await file.text();
    } catch {
      setMessage(FILE_READ_FAILED_MESSAGE);
      return;
    }
    const parsed = parsePlanFile(text);
    if (!parsed.ok) {
      setMessage(planFileFailureMessage(parsed.reason));
      return;
    }
    const current = latestPlan.current;
    if (current.status !== "ready") return;
    if (parsed.eventId !== current.eventId) {
      setMessage(otherEventMessage(parsed.eventId, eventName));
      return;
    }
    setPending(parsed.assignments);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // 同じファイルを選び直しても読めるよう、選んだファイルを入力から外しておく
    input.value = "";
    setMessage(null);
    if (file !== undefined) void readFile(file);
  }

  /** 「置き換える」：共有の札割りのデータで最新イベントの割り当てを置き換えて保存する */
  async function replace(): Promise<void> {
    const next = pending;
    setPending(null);
    if (next === null) return;
    // setAssignments は失敗しても例外にせず、保存の結果を状態（saveError）に入れてから終わる
    await latestPlan.current.setAssignments(next);
    const state = latestPlan.current;
    if (state.status === "ready" && state.saveError !== null) setMessage(state.saveError.message);
  }

  const shipCount = pending === null ? 0 : Object.keys(pending).length;

  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowTitle}>札割りの書き出し・読み込み</span>
        <span className={styles.rowNote}>
          {definitionFailed
            ? "イベントの定義を読み込めないため、書き出し・読み込みはできません"
            : "別のブラウザやPCへ札割りを移すときに使います"}
        </span>
      </div>
      <div className={styles.rowActions}>
        <button type="button" className={styles.button} disabled={!ready} onClick={exportPlan}>
          書き出す
        </button>
        {/* ファイルを選ぶ入力は見えなくして、名前の部分をボタンの形に見せる（フォーカスは入力に入る） */}
        <label className={styles.button} data-disabled={ready ? undefined : "true"}>
          読み込む
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className={styles.fileInput}
            disabled={!ready}
            onChange={onFileChange}
          />
        </label>
      </div>
      {message !== null && (
        <p role="alert" className={styles.rowAlert}>
          {message}
        </p>
      )}
      <ConfirmDialog
        open={pending !== null}
        title="札割りを置き換えます"
        description={`今の札割り${eventName === null ? "" : `（${eventName}）`}を、読み込んだファイルの札割り（${shipCount}隻分）に置き換えます。今の札割りは元に戻せません。`}
        confirmLabel="置き換える"
        tone="action"
        onConfirm={() => void replace()}
        onCancel={() => setPending(null)}
        returnFocusRef={inputRef}
      />
    </div>
  );
}

/**
 * 文字をファイルとしてダウンロードさせる関数を返す（Blob → URL.createObjectURL → <a download> の click()）。
 * 作った URL は、設定のウィンドウを閉じる（部品を外す）ときにまとめて解放する（ダウンロードを始める前に解放しないように）
 */
function useDownload(): (text: string, fileName: string) => void {
  const urlsRef = useRef<string[]>([]);
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
    };
  }, []);
  return useCallback((text: string, fileName: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    urlsRef.current.push(url);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }, []);
}

// ---- 取り込んだ艦娘データを削除 ----

type ImportedShipsRowProps = {
  /** 共有の札割りのデータ */
  plan: PlanData;
  /** 最新イベントの定義を読み込めなかったか（そのときは最終取り込みを保存先から直接読む） */
  definitionFailed: boolean;
};

function ImportedShipsRow({ plan, definitionFailed }: ImportedShipsRowProps): ReactNode {
  const latestPlan = useLatestRef(plan);
  const [storedLastImport, setStoredLastImport] = useStoredLastImport(definitionFailed);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // 最終取り込み（まだ分からなければ undefined、取り込んでいなければ null）。
  // 定義を読めないときは札割りのデータを読まない（待機中のまま）ので、保存先から直接読んだものを使う
  const lastImport: ImportRecord | null | undefined =
    plan.status === "ready" ? plan.lastImport : definitionFailed ? storedLastImport : undefined;

  /** 「削除する」（確認の後）：個体と最終取り込みを消し、共有の札割りのデータを読み直す */
  async function deleteShips(): Promise<void> {
    setConfirming(false);
    setBusy(true);
    setFailed(false);
    try {
      await getPlanStorage().clearImportedShips();
    } catch {
      setFailed(true);
      setBusy(false);
      return;
    }
    setStoredLastImport(null);
    // reload は例外を投げない（失敗は状態に入れる）
    await latestPlan.current.reload();
    setBusy(false);
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowTitle}>取り込んだ艦娘データを削除</span>
        <span className={styles.rowNote}>{lastImportNote(lastImport)}</span>
      </div>
      <button
        ref={deleteButtonRef}
        type="button"
        className={styles.dangerButton}
        disabled={lastImport === undefined || lastImport === null || busy}
        onClick={() => setConfirming(true)}
      >
        削除する
      </button>
      {failed && (
        <p role="alert" className={styles.rowAlert}>
          {DELETE_FAILED_MESSAGE}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        title="取り込んだ艦娘データを削除します"
        description={`取り込んだ艦娘${lastImport ? `（${lastImport.shipCount}隻）` : ""}と最終取り込みの記録を、このブラウザから削除します。札割りは残ります。削除は取り消せません。`}
        confirmLabel="削除する"
        tone="danger"
        onConfirm={() => void deleteShips()}
        onCancel={() => setConfirming(false)}
        returnFocusRef={deleteButtonRef}
      />
    </div>
  );
}

/** 最終取り込みの説明（「最終取り込み 10/15 20:40 ／ 312隻。札割りは残ります」） */
function lastImportNote(lastImport: ImportRecord | null | undefined): string {
  if (lastImport === undefined) return "読み込み中…";
  if (lastImport === null) return "取り込んだ艦娘データはありません";
  const importedAt = formatImportedAt(lastImport.importedAt) ?? "（日時不明）";
  return `最終取り込み ${importedAt} ／ ${lastImport.shipCount}隻。札割りは残ります`;
}

/**
 * 保存先から直接読んだ最終取り込み（enabled のときだけ読む。読むまで・読めなければ undefined）と、それを書き換える関数。
 * 最新イベントの定義を読めず、札割りのデータ（usePlanData）が読まれないときに使う
 */
function useStoredLastImport(
  enabled: boolean,
): [ImportRecord | null | undefined, (record: ImportRecord | null) => void] {
  const [record, setRecord] = useState<ImportRecord | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    getPlanStorage()
      .loadLastImport()
      .then(
        (loaded) => {
          if (active) setRecord(loaded);
        },
        () => {
          if (active) setRecord(undefined);
        },
      );
    return () => {
      active = false;
    };
  }, [enabled]);
  return [record, setRecord];
}
