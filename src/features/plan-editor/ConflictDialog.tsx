"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { formatDateTimeJst } from "@/domain/definition-edit";
import type { ChangeKind, ConflictChoice, ConflictChoices, MergeConflict } from "@/domain/merge";
import styles from "./ConflictDialog.module.css";

/** 変更の種類の表示 */
const CHANGE_KIND_LABELS: Readonly<Record<ChangeKind, string>> = {
  added: "追加",
  deleted: "削除",
  modified: "変更",
};

/** 自動で合わせた所の 1 件（相手だけが変えた所） */
export interface MergedItem {
  /** 表示名（例「E3 ゲージ4 の特効「第二十七駆逐隊」」） */
  readonly label: string;
  readonly change: ChangeKind;
  /** 変えた人の表示名 */
  readonly name: string;
  /** 「場所を見る」で選ぶ段階（段階・特効の変更のとき。ほかは null で「場所を見る」を出さない） */
  readonly stageId: string | null;
}

/** 自動で合わせた所の文（「自動で合わせた所：（表示名）（（名前）が追加）」と「場所を見る」） */
export function MergedItemLine({
  item,
  onSeePlace,
}: {
  item: MergedItem;
  onSeePlace: (stageId: string) => void;
}): ReactNode {
  const { stageId } = item;
  return (
    <li className={styles.mergedItem}>
      <span>
        自動で合わせた所：{item.label}（{item.name}が{CHANGE_KIND_LABELS[item.change]}）
      </span>
      {stageId !== null && (
        <button type="button" className={styles.mergedPlace} onClick={() => onSeePlace(stageId)}>
          場所を見る
        </button>
      )}
    </li>
  );
}

export type ConflictDialogProps = {
  /** 先に保存した人の表示名 */
  theirsName: string;
  /** 先に保存した日時 */
  theirsAt: string;
  /** 自動で合わせた所 */
  mergedItems: readonly MergedItem[];
  /** 衝突（同じ所を 2 人が変えた所） */
  conflicts: readonly MergeConflict[];
  /** 衝突ごとの選択 */
  choices: ConflictChoices;
  /** すべて選んだが、その結果の文書に問題があるときの理由（なければ null） */
  problem: string | null;
  /** 保存の途中（ボタンを押せなくする） */
  saving: boolean;
  onChoose: (conflictId: string, choice: ConflictChoice) => void;
  onSeePlace: (stageId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 保存の確認（要件 3.7「同時編集」、モック PlanEditor.dc.html）。開いた後に他の人が下書きを保存していて、
 * 同じ所を 2 人が変えていたときに出す。本文の上に置き（攻略の流れを見ながら選べるよう、ほかの操作を止めない）、出たらフォーカスを移す。
 * - 自動で合わせた所と「場所を見る」
 * - 衝突ごとに「同じ所を2人が変えています：（表示名）　どちらを残しますか？」と、相手・自分の内容の選択肢、「場所を見る」
 * - 「この内容で保存」（すべて選び、結果の文書に問題がないときだけ押せる）・「保存をやめる」（Esc でも同じ）
 */
export function ConflictDialog(props: ConflictDialogProps): ReactNode {
  const { theirsName, conflicts, choices } = props;
  const dialogRef = useRef<HTMLElement | null>(null);
  const allChosen = conflicts.every((conflict) => choices[conflict.id] !== undefined);
  const canConfirm = allChosen && props.problem === null && !props.saving;

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <section
      ref={dialogRef}
      role="alertdialog"
      aria-label="保存の確認"
      tabIndex={-1}
      className={styles.dialog}
      onKeyDown={(event) => {
        // Esc は「保存をやめる」と同じ（保存の途中は閉じない）
        if (event.key === "Escape" && !props.saving) props.onCancel();
      }}
    >
      <p className={styles.title}>
        開いた後に{theirsName}が下書きを保存していました（{formatDateTimeJst(props.theirsAt)}）
      </p>
      <p className={styles.note}>
        下の攻略の流れで、<b className={styles.noteConflict}>赤く光っている段階</b>
        が2人とも変えた所（どちらか選んでください）、<b className={styles.noteMerged}>橙の枠</b>が{theirsName}
        だけが変えた所です
      </p>
      {props.mergedItems.length > 0 && (
        <ul className={styles.mergedList}>
          {props.mergedItems.map((item, index) => (
            <MergedItemLine key={`${item.label}-${String(index)}`} item={item} onSeePlace={props.onSeePlace} />
          ))}
        </ul>
      )}
      {conflicts.map((conflict) => {
        const { stageId } = conflict;
        const chosen = choices[conflict.id];
        return (
          <div key={conflict.id} className={styles.conflict}>
            <p className={styles.conflictText}>
              同じ所を2人が変えています：<b>{conflict.label}</b>　どちらを残しますか？
              {stageId !== null && (
                <>
                  {"　"}
                  <button type="button" className={styles.conflictPlace} onClick={() => props.onSeePlace(stageId)}>
                    場所を見る
                  </button>
                </>
              )}
            </p>
            <div role="radiogroup" aria-label={`${conflict.label}のどちらを残すか`} className={styles.choices}>
              {(
                [
                  ["theirs", `${theirsName}の内容：${conflict.theirsText}`],
                  ["mine", `あなたの内容：${conflict.mineText}`],
                ] as const
              ).map(([choice, label]) => (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={chosen === choice}
                  className={`${styles.choice} ${chosen === choice ? styles.choiceOn : ""}`}
                  disabled={props.saving}
                  onClick={() => props.onChoose(conflict.id, choice)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {props.problem !== null && (
        <p role="alert" className={styles.problem}>
          この内容では保存できません。{props.problem}
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.confirm} disabled={!canConfirm} onClick={props.onConfirm}>
          この内容で保存
        </button>
        <button type="button" className={styles.cancel} disabled={props.saving} onClick={props.onCancel}>
          保存をやめる
        </button>
      </div>
    </section>
  );
}
