"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode, useEffect, useId, useState } from "react";
import { formatDateTimeJst } from "@/domain/definition-edit";
import { errorMessage } from "../editor-model";
import type { SaveLogEntry, SaveLogKind, SaveLogLoader } from "./types";
import { type SaveLogMember, type SaveLogUserOption, saveLogUserOptions, viewSaveLogs } from "./view";
import styles from "./SaveLogDialog.module.css";

/** 種類のバッジ・選択肢の文字 */
const KIND_LABELS: Readonly<Record<SaveLogKind, string>> = {
  save: "下書き保存",
  publish: "公開",
};

const KIND_CHOICES: readonly SaveLogKind[] = ["save", "publish"];

/** 絞り込みの「全員」「すべて」の値 */
const ALL = "";

export type SaveLogDialogProps = {
  /** 記録を読む関数（ウィンドウを開くたびに呼ぶ） */
  loader: SaveLogLoader;
  /** 開いたイベントの ID */
  eventId: string;
  /** 開いたイベントの名前（見出しの横に出す） */
  eventName: string;
  /** 定義の海域の表示名（「海域」の選択肢） */
  areaNames: readonly string[];
  /** 編集できる人（「誰が」の選択肢の並びと今の表示名。管理者を先に、追加した順） */
  members: readonly SaveLogMember[];
};

/** 記録の読み込みの状態 */
type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly entries: readonly SaveLogEntry[] }
  | { readonly status: "error"; readonly message: string };

/** 一覧の日時（「10/15 22:52」。読めない値はそのまま） */
function shortDateTime(value: string): string {
  const full = formatDateTimeJst(value);
  return /^\d{4}\//.test(full) ? full.slice(5) : full;
}

/** 「誰が」の選択肢の選択欄の値（ID のある人は ID、ID の分からない記録は表示名で見分ける） */
function userOptionValue(option: SaveLogUserOption): string {
  return option.userId === null ? `name:${option.name}` : `id:${option.userId}`;
}

/** 選択欄の値を種類にする（「すべて」は null） */
function toKind(value: string): SaveLogKind | null {
  return value === "save" || value === "publish" ? value : null;
}

type FilterSelectProps = {
  label: string;
  value: string;
  disabled: boolean;
  allLabel: string;
  options: ReadonlyArray<readonly [value: string, label: string]>;
  onChange: (value: string) => void;
};

/** 絞り込みの選択欄（ラベルつき） */
function FilterSelect({ label, value, disabled, allLabel, options, onChange }: FilterSelectProps): ReactNode {
  const id = useId();
  return (
    <span className={styles.filter}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className={styles.select}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value={ALL}>{allLabel}</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </span>
  );
}

/** 記録の 1 行 */
function SaveLogRow({ entry }: { entry: SaveLogEntry }): ReactNode {
  return (
    <li className={styles.row}>
      <time className={styles.at} dateTime={entry.createdAt} title={formatDateTimeJst(entry.createdAt)}>
        {shortDateTime(entry.createdAt)}
      </time>
      <span className={styles.who}>{entry.userName}</span>
      <span className={entry.kind === "save" ? styles.badgeSave : styles.badgePublish}>{KIND_LABELS[entry.kind]}</span>
      <span className={styles.summary}>{entry.summary}</span>
    </li>
  );
}

/** ウィンドウの中身（開くたびに作られ、記録を読み直す） */
function SaveLogBody({ loader, eventId, areaNames, members }: Omit<SaveLogDialogProps, "eventName">): ReactNode {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [userValue, setUserValue] = useState(ALL);
  const [kind, setKind] = useState(ALL);
  const [mapLabel, setMapLabel] = useState(ALL);
  const [pages, setPages] = useState(1);

  useEffect(() => {
    // ウィンドウを閉じた後に届いた結果は捨てる
    let current = true;
    loader(eventId).then(
      (entries) => {
        if (current) setLoad({ status: "loaded", entries });
      },
      (error: unknown) => {
        if (current) setLoad({ status: "error", message: errorMessage(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [loader, eventId]);

  const entries = load.status === "loaded" ? load.entries : [];
  const users = saveLogUserOptions(entries, members);
  const selectedUser = users.find((option) => userOptionValue(option) === userValue) ?? null;
  const view = viewSaveLogs(
    entries,
    { user: selectedUser, kind: toKind(kind), mapLabel: mapLabel === ALL ? null : mapLabel },
    pages,
  );
  const userOptions = users.map((option) => [userOptionValue(option), option.name] as const);
  const kindOptions = KIND_CHOICES.map((value) => [value, KIND_LABELS[value]] as const);
  const areaOptions = areaNames.map((name) => [name, name] as const);
  const filterDisabled = load.status !== "loaded";

  /** 絞り込みを変える（8 件の表示に戻す） */
  const changeFilter = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPages(1);
  };

  return (
    <>
      <div className={styles.filters}>
        <FilterSelect
          label="誰が"
          value={userValue}
          disabled={filterDisabled}
          allLabel="全員"
          options={userOptions}
          onChange={changeFilter(setUserValue)}
        />
        <FilterSelect
          label="種類"
          value={kind}
          disabled={filterDisabled}
          allLabel="すべて"
          options={kindOptions}
          onChange={changeFilter(setKind)}
        />
        <FilterSelect
          label="海域"
          value={mapLabel}
          disabled={filterDisabled}
          allLabel="すべて"
          options={areaOptions}
          onChange={changeFilter(setMapLabel)}
        />
        {load.status === "loaded" && (
          <span className={styles.count}>
            {view.shown.length} / {view.matched} 件
          </span>
        )}
      </div>

      {load.status === "loading" && (
        <p role="status" className={styles.message}>
          読み込んでいます…
        </p>
      )}
      {load.status === "error" && (
        <div role="alert" className={styles.error}>
          <p className={styles.errorTitle}>保存の記録を読み込めませんでした</p>
          <p>{load.message}</p>
        </div>
      )}
      {load.status === "loaded" && (
        // 一覧の部分だけをスクロールする（キーボードでもスクロールできるよう、フォーカスを受け取れるようにする）
        <ol aria-label="記録" tabIndex={0} className={styles.list}>
          {view.shown.map((entry) => (
            <SaveLogRow key={entry.id} entry={entry} />
          ))}
          {view.matched === 0 && <li className={styles.empty}>条件に合う記録はありません</li>}
          {view.hasMore && (
            <li className={styles.moreRow}>
              <button type="button" className={styles.moreButton} onClick={() => setPages((current) => current + 1)}>
                さらに古い記録を表示
              </button>
            </li>
          )}
        </ol>
      )}
    </>
  );
}

/**
 * 「保存の記録を見る」と、共有の下書きの記録のウィンドウ（要件 3.7「保存の記録」・3.0、モック PlanEditor.dc.html）。
 * - ウィンドウは Radix UI の Dialog（見た目なし）。開いている間は後ろの画面を触れない。×・「閉じる」・背景の暗い部分で閉じる
 * - 開くたびに記録を読み直す。絞り込み（誰が・種類・海域）、「表示件数 / 該当件数 件」、8 件ずつの表示、該当なしの文
 */
export function SaveLogDialog({ eventName, ...bodyProps }: SaveLogDialogProps): ReactNode {
  return (
    <Dialog.Root>
      <Dialog.Trigger className={styles.openButton}>保存の記録を見る</Dialog.Trigger>
      <Dialog.Portal>
        {/* ウィンドウを背景の中に置く（背景のクリックは中身の外のクリックとして閉じる） */}
        <Dialog.Overlay className={styles.overlay} data-testid="save-log-dialog-overlay">
          {/* Radix は aria-modal を自動で付けないため明示する */}
          <Dialog.Content className={styles.content} aria-modal="true">
            <div className={styles.header}>
              <Dialog.Title className={styles.title}>共有の下書きの記録</Dialog.Title>
              <Dialog.Description className={styles.eventName}>{eventName}</Dialog.Description>
              <Dialog.Close className={styles.cross} aria-label="閉じる">
                ×
              </Dialog.Close>
            </div>
            <SaveLogBody {...bodyProps} />
            <div className={styles.footer}>
              <Dialog.Close className={styles.closeButton}>閉じる</Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
