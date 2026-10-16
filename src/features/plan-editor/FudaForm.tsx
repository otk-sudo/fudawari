"use client";

import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { EditError } from "@/domain/definition-edit";
import { COLOR_CHOICES, colorName } from "./colors";
import controls from "./controls.module.css";
import styles from "./FudaSection.module.css";

/** 札の入力の値 */
export interface FudaFormValues {
  readonly name: string;
  readonly color: string;
  /** ゲーム内の札番号（未入力は null。数でなければ NaN のまま渡し、定義の編集の関数で誤りにする） */
  readonly gameNumber: number | null;
}

export type FudaFormProps = {
  /** 追加（「＋ 札を追加」）か編集（札の行の「編集」）か */
  kind: "add" | "edit";
  /** 初めの値 */
  initial: FudaFormValues;
  /** 編集で、札を削除できるか（段階で使われていない） */
  canDelete?: boolean;
  /** 「追加する」「変更する」。失敗したら理由を返す（欄は閉じない） */
  onSubmit: (values: FudaFormValues) => EditError | null;
  /** 「この札を削除」（編集だけ）。失敗したら理由を返す */
  onDelete?: () => EditError | null;
  onCancel: () => void;
};

/** 札番号の入力欄の値を数にする（空は null） */
function parseGameNumber(text: string): number | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : Number(trimmed);
}

/**
 * 札の追加・編集の入力の欄（U16：名前・色〔用意した色から選ぶ〕・札番号〔任意〕。名前と色は変更できる。
 * 削除できるのは使われていない札だけ）
 */
export function FudaForm({ kind, initial, canDelete = false, onSubmit, onDelete, onCancel }: FudaFormProps): ReactNode {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [gameNumberText, setGameNumberText] = useState(initial.gameNumber === null ? "" : String(initial.gameNumber));
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const numberId = useId();
  const colorGroupName = useId();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const isAdd = kind === "add";

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const failure = onSubmit({ name, color, gameNumber: parseGameNumber(gameNumberText) });
    setError(failure?.message ?? null);
  };

  return (
    <form aria-label={isAdd ? "札を追加" : "札を編集"} className={styles.form} onSubmit={handleSubmit}>
      <label htmlFor={nameId} className={styles.formLabel}>
        札の名前
      </label>
      <input
        id={nameId}
        ref={nameRef}
        type="text"
        className={controls.input}
        placeholder="例：機動部隊"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <span className={styles.formLabel} aria-hidden="true">
        札の色
      </span>
      <div role="radiogroup" aria-label="札の色" className={styles.colors}>
        {COLOR_CHOICES.map((choice) => (
          <label key={choice} className={styles.colorItem}>
            <input
              type="radio"
              name={colorGroupName}
              aria-label={colorName(choice)}
              className={styles.colorInput}
              checked={color === choice}
              onChange={() => setColor(choice)}
            />
            <span className={styles.colorSwatch} style={{ background: choice }} aria-hidden="true" />
          </label>
        ))}
      </div>
      <label htmlFor={numberId} className={styles.formLabel}>
        札番号（任意）
      </label>
      <input
        id={numberId}
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        className={`${controls.input} ${styles.numberInput}`}
        value={gameNumberText}
        onChange={(event) => setGameNumberText(event.currentTarget.value)}
      />
      <span className={styles.formHint}>ゲーム内の札の番号です。取り込んだ艦の札と比べるのに使います</span>
      {error !== null && (
        <p role="alert" className={styles.formError}>
          {error}
        </p>
      )}
      <div className={styles.formActions}>
        <button type="submit" className={controls.primaryButton}>
          {isAdd ? "追加する" : "変更する"}
        </button>
        <button type="button" className={controls.ghostButton} onClick={onCancel}>
          やめる
        </button>
      </div>
      {!isAdd && (
        <div className={styles.formDelete}>
          <button
            type="button"
            className={controls.dangerButton}
            disabled={!canDelete}
            onClick={() => {
              const failure = onDelete?.() ?? null;
              setError(failure?.message ?? null);
            }}
          >
            この札を削除
          </button>
          {!canDelete && <span className={styles.formHint}>段階で使われている札は削除できません</span>}
        </div>
      )}
    </form>
  );
}
