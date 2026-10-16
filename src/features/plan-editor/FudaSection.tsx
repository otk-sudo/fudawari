"use client";

import { type ReactNode, useId, useRef, useState } from "react";
import type { Fuda } from "@/domain/definition";
import {
  type AddFudaInput,
  canDeleteFuda,
  type DefinitionDoc,
  type EditError,
  type FudaPatch,
} from "@/domain/definition-edit";
import { COLOR_CHOICES } from "./colors";
import { useFudaDnd, useFudaEndDrop } from "./editor-dnd";
import { FudaForm, type FudaFormValues } from "./FudaForm";
import controls from "./controls.module.css";
import styles from "./FudaSection.module.css";

/** 札の編集の操作（失敗したら理由を返す） */
export interface FudaActions {
  add: (input: Omit<AddFudaInput, "newFudaId">) => EditError | null;
  update: (fudaId: string, patch: FudaPatch) => EditError | null;
  remove: (fudaId: string) => EditError | null;
}

export type FudaSectionProps = {
  doc: DefinitionDoc;
  /** 操作できない（終了したイベント） */
  disabled: boolean;
  actions: FudaActions;
};

/** 開いている入力の欄 */
type OpenForm = { readonly kind: "add" } | { readonly kind: "edit"; readonly fudaId: string } | null;

/** 札ごとの、使っている段階の数 */
function countUses(doc: DefinitionDoc): Map<string, number> {
  const uses = new Map<string, number>();
  for (const stage of doc.stages) {
    uses.set(stage.fudaId, (uses.get(stage.fudaId) ?? 0) + 1);
  }
  return uses;
}

/** 新しい札の初めの色（まだどの札も使っていない色。すべて使っていれば最初の色） */
function unusedColor(doc: DefinitionDoc): string {
  const used = new Set(doc.fudas.map((fuda) => fuda.color.toUpperCase()));
  return COLOR_CHOICES.find((color) => !used.has(color)) ?? COLOR_CHOICES[0] ?? "#4C8DF6";
}

/** 編集の欄で変えた項目だけの変更（変えていない札番号・色で、ほかの札との重複などの誤りにしないため） */
function changedFields(fuda: Fuda, values: FudaFormValues): FudaPatch {
  const patch: FudaPatch = {};
  if (values.name.trim() !== fuda.name) patch.name = values.name;
  if (values.color !== fuda.color) patch.color = values.color;
  if (values.gameNumber !== fuda.gameNumber) patch.gameNumber = values.gameNumber;
  return patch;
}

/**
 * 札の一覧（要件 3.7「札の一覧」、U16）。札ごとに持ち手・色・札名・使っている段階の数（n 段階）・編集のボタン。
 * 「＋ 札を追加」で名前・色・札番号を入れて追加する。持ち手のドラッグで並べ替える（editor-dnd）
 */
export function FudaSection({ doc, disabled, actions }: FudaSectionProps): ReactNode {
  const headingId = useId();
  const [form, setForm] = useState<OpenForm>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const { setNodeRef: setEndDropRef, showDropLine: endDropLine } = useFudaEndDrop(disabled);
  const uses = countUses(doc);

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          札
        </h2>
        <span className={styles.headHint}>ドラッグで並べ替え・間に割り込み</span>
      </div>
      <ul className={styles.list}>
        {doc.fudas.map((fuda) => (
          <FudaRow
            key={fuda.id}
            fuda={fuda}
            uses={uses.get(fuda.id) ?? 0}
            disabled={disabled}
            editing={form?.kind === "edit" && form.fudaId === fuda.id}
            canDelete={canDeleteFuda(doc, fuda.id)}
            onEdit={() => setForm({ kind: "edit", fudaId: fuda.id })}
            onClose={() => setForm(null)}
            actions={actions}
          />
        ))}
        <li ref={setEndDropRef} className={`${styles.endItem} ${endDropLine ? styles.dropBefore : ""}`}>
          {form?.kind === "add" ? (
            <FudaForm
              kind="add"
              initial={{ name: "", color: unusedColor(doc), gameNumber: null }}
              onSubmit={(values) => {
                const error = actions.add(values);
                if (error === null) {
                  setForm(null);
                  addButtonRef.current?.focus();
                }
                return error;
              }}
              onCancel={() => setForm(null)}
            />
          ) : (
            <button
              ref={addButtonRef}
              type="button"
              className={`${controls.dashedButton} ${styles.addButton}`}
              onClick={() => setForm({ kind: "add" })}
            >
              ＋ 札を追加
            </button>
          )}
        </li>
      </ul>
    </section>
  );
}

type FudaRowProps = {
  fuda: Fuda;
  uses: number;
  disabled: boolean;
  editing: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onClose: () => void;
  actions: FudaActions;
};

/** 札の一覧の行（listitem。ドラッグの持ち手・色・札名・n 段階・編集） */
function FudaRow({ fuda, uses, disabled, editing, canDelete, onEdit, onClose, actions }: FudaRowProps): ReactNode {
  const { setNodeRef, setHandleRef, attributes, listeners, isDragging, showDropLine } = useFudaDnd(
    { kind: "fuda", fudaId: fuda.id, label: `札「${fuda.name}」`, color: fuda.color },
    disabled,
  );
  const className = [
    styles.item,
    isDragging ? styles.itemDragging : "",
    showDropLine ? styles.dropBefore : "",
  ].join(" ");

  return (
    <li ref={setNodeRef} className={className}>
      <div className={styles.row}>
        <button
          ref={setHandleRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`${fuda.name}を動かす`}
          className={styles.handle}
        >
          <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
            <circle cx="3" cy="3" r="1.4" />
            <circle cx="9" cy="3" r="1.4" />
            <circle cx="3" cy="8" r="1.4" />
            <circle cx="9" cy="8" r="1.4" />
            <circle cx="3" cy="13" r="1.4" />
            <circle cx="9" cy="13" r="1.4" />
          </svg>
        </button>
        <span className={styles.dot} style={{ background: fuda.color }} aria-hidden="true" />
        <span className={styles.name}>{fuda.name}</span>
        <span className={styles.uses}>{uses} 段階</span>
        <button
          type="button"
          aria-label={`${fuda.name}を編集`}
          aria-expanded={editing}
          className={styles.editButton}
          onClick={editing ? onClose : onEdit}
        >
          編集
        </button>
      </div>
      {editing && (
        <FudaForm
          kind="edit"
          initial={{ name: fuda.name, color: fuda.color, gameNumber: fuda.gameNumber }}
          canDelete={canDelete}
          onSubmit={(values) => {
            const patch = changedFields(fuda, values);
            const error = Object.keys(patch).length === 0 ? null : actions.update(fuda.id, patch);
            if (error === null) onClose();
            return error;
          }}
          onDelete={() => {
            const error = actions.remove(fuda.id);
            if (error === null) onClose();
            return error;
          }}
          onCancel={onClose}
        />
      )}
    </li>
  );
}
