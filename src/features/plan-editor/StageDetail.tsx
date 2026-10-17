"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { type Importance, importanceLabel, type Stage } from "@/domain/definition";
import {
  type BoostGroupPatch,
  canDeleteStage,
  type DefinitionDoc,
  parseShipNameList,
  type StagePatch,
} from "@/domain/definition-edit";
import { BoostGroupEditor } from "./BoostGroupEditor";
import { inkFor } from "./colors";
import controls from "./controls.module.css";
import styles from "./StageDetail.module.css";

/** 段階・特効の編集の操作 */
export interface StageActions {
  update: (stageId: string, patch: StagePatch) => void;
  remove: (stageId: string) => void;
  /** 特効グループを追加し、追加したグループの ID を返す（追加できなければ null） */
  addGroup: (stageId: string, shipNames?: readonly string[]) => string | null;
  updateGroup: (groupId: string, patch: BoostGroupPatch) => void;
  removeGroup: (groupId: string) => void;
  addShips: (groupId: string, shipNames: readonly string[]) => void;
  removeShip: (groupId: string, shipName: string) => void;
}

export type StageDetailProps = {
  doc: DefinitionDoc;
  /** 選んでいる段階 */
  stage: Stage;
  /** 公開のボタンの名前（削除の確認の文に使う） */
  publishLabel: string;
  knownShipNames: ReadonlySet<string> | undefined;
  actions: StageActions;
  /** 特効グループの倍率の欄に入力の誤りが残っているかを知らせる（BoostGroupEditor の onInvalidChange） */
  onGroupInvalidChange: (groupId: string, invalid: boolean) => void;
};

const IMPORTANCES: readonly Importance[] = ["normal", "important", "hard"];

/** 札が見つからないときの色 */
const UNKNOWN_FUDA_COLOR = "#8B93A1";

/**
 * 段階の詳細（要件 3.7「段階の詳細」、U16）。選んだ段階の名前・使う札・大事さと、この段階のボスで効く特効を編集する。
 * 段階を選び直したら作り直す（呼び出し側で key にモードと段階の ID を付ける）ので、削除の確認などの開閉は段階ごと
 */
export function StageDetail({
  doc,
  stage,
  publishLabel,
  knownShipNames,
  actions,
  onGroupInvalidChange,
}: StageDetailProps): ReactNode {
  const [confirming, setConfirming] = useState(false);
  // 「この段階を削除」（削除の確認をやめたら、ここへフォーカスを戻す）
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const [pasting, setPasting] = useState(false);
  // 追加した直後の特効グループ（グループ名の欄にフォーカスを移す）
  const [focusGroupId, setFocusGroupId] = useState<string | null>(null);
  const nameId = useId();
  const fudaGroupName = useId();
  const area = doc.areas.find((a) => a.id === stage.areaId);
  const fuda = doc.fudas.find((f) => f.id === stage.fudaId);
  const color = fuda?.color ?? UNKNOWN_FUDA_COLOR;
  const stageLabel = `${area?.name ?? ""} ${stage.name}`.trim();

  return (
    <section aria-label="段階の詳細" className={styles.section}>
      <div className={styles.head} style={{ background: color, color: inkFor(color) }}>
        <span className={styles.headText}>
          <h2 className={styles.headTitle}>{stageLabel}</h2>
          <span className={styles.headFuda}>{fuda?.name ?? "（札なし）"}</span>
        </span>
        <button
          ref={deleteButtonRef}
          type="button"
          className={styles.deleteButton}
          disabled={!canDeleteStage(doc, stage.id)}
          onClick={() => setConfirming(true)}
        >
          この段階を削除
        </button>
      </div>

      {confirming && (
        <DeleteConfirm
          text={`「${stageLabel}」を削除しますか？ 設定した札・大事さ・特効もまとめて消えます。「${publishLabel}」を押すまでは一般の画面には反映されません`}
          onDelete={() => {
            setConfirming(false);
            actions.remove(stage.id);
          }}
          onCancel={() => {
            setConfirming(false);
            deleteButtonRef.current?.focus();
          }}
        />
      )}

      <div className={styles.content}>
        <div className={styles.basics}>
          <div className={styles.field}>
            <label htmlFor={nameId} className={styles.label}>
              段階の名前
            </label>
            <input
              id={nameId}
              type="text"
              className={`${controls.input} ${styles.nameInput}`}
              placeholder="例：ゲージ2 輸送"
              value={stage.name}
              onChange={(event) => actions.update(stage.id, { name: event.currentTarget.value })}
            />
            <span className={styles.label} aria-hidden="true">
              この段階で使う札
            </span>
            <div role="radiogroup" aria-label="この段階で使う札" className={styles.fudaChoices}>
              {doc.fudas.map((choice) => (
                <label key={choice.id} className={styles.fudaChoice}>
                  <input
                    type="radio"
                    name={fudaGroupName}
                    className={styles.fudaChoiceInput}
                    checked={choice.id === stage.fudaId}
                    onChange={() => actions.update(stage.id, { fudaId: choice.id })}
                  />
                  <span className={styles.fudaChoiceLabel} style={{ background: choice.color, color: inkFor(choice.color) }}>
                    {choice.name}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className={styles.field}>
            <span className={styles.label} aria-hidden="true">
              大事さ
            </span>
            <div role="group" aria-label="大事さ" className={controls.segment}>
              {IMPORTANCES.map((importance) => (
                <button
                  key={importance}
                  type="button"
                  aria-pressed={stage.importance === importance}
                  className={`${controls.segmentButton} ${importance === "hard" ? controls.segmentButtonStrong : ""}`}
                  onClick={() => actions.update(stage.id, { importance })}
                >
                  {importanceLabel(importance)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.boosts}>
          <div className={styles.boostHead}>
            <span className={styles.boostTitle}>この段階のボスで効く特効</span>
            <span className={styles.boostNote}>艦名は改装段階を問わず一致します</span>
          </div>
          {stage.boosts.length === 0 && <p className={styles.noBoosts}>この段階の特効は未入力です</p>}
          {stage.boosts.map((group, index) => (
            <BoostGroupEditor
              key={group.id}
              group={group}
              index={index}
              autoFocus={group.id === focusGroupId}
              knownShipNames={knownShipNames}
              actions={actions}
              onInvalidChange={onGroupInvalidChange}
            />
          ))}
          <div className={styles.boostActions}>
            <button
              type="button"
              className={controls.dashedButton}
              onClick={() => setFocusGroupId(actions.addGroup(stage.id))}
            >
              ＋ 特効グループを追加
            </button>
            <button
              type="button"
              className={controls.ghostButton}
              aria-expanded={pasting}
              onClick={() => setPasting((open) => !open)}
            >
              攻略サイトの艦名リストを貼り付け
            </button>
          </div>
          {pasting && (
            <PastePanel
              onAdd={(shipNames) => {
                setFocusGroupId(actions.addGroup(stage.id, shipNames));
                setPasting(false);
              }}
              onCancel={() => setPasting(false)}
            />
          )}
        </div>
      </div>
    </section>
  );
}

type DeleteConfirmProps = {
  text: string;
  onDelete: () => void;
  onCancel: () => void;
};

/** 段階の削除の確認（alertdialog）。開いたら「やめる」にフォーカスを移す */
function DeleteConfirm({ text, onDelete, onCancel }: DeleteConfirmProps): ReactNode {
  const textId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      role="alertdialog"
      aria-label="段階の削除の確認"
      aria-describedby={textId}
      className={styles.confirm}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <span id={textId} className={styles.confirmText}>
        {text}
      </span>
      <button type="button" className={controls.dangerSolidButton} onClick={onDelete}>
        削除する
      </button>
      <button ref={cancelRef} type="button" className={controls.ghostButton} onClick={onCancel}>
        やめる
      </button>
    </div>
  );
}

type PastePanelProps = {
  onAdd: (shipNames: readonly string[]) => void;
  onCancel: () => void;
};

/** 「攻略サイトの艦名リストを貼り付け」：貼った艦名の一覧から新しい特効グループを作る */
function PastePanel({ onAdd, onCancel }: PastePanelProps): ReactNode {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  return (
    <div className={styles.paste}>
      <label htmlFor={id} className={styles.label}>
        艦名リスト
      </label>
      <textarea
        id={id}
        rows={4}
        className={`${controls.input} ${styles.pasteInput}`}
        placeholder="例：雪風、時雨、浜風"
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <span className={styles.pasteHint}>読点・カンマ・スラッシュ・改行で区切ります。前後の空白と重複は除きます</span>
      {error !== null && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.pasteActions}>
        <button
          type="button"
          className={controls.primaryButton}
          onClick={() => {
            const shipNames = parseShipNameList(text);
            if (shipNames.length === 0) {
              setError("艦名が見つかりません。艦名の一覧を貼り付けてください");
              return;
            }
            onAdd(shipNames);
          }}
        >
          特効グループとして追加
        </button>
        <button type="button" className={controls.ghostButton} onClick={onCancel}>
          やめる
        </button>
      </div>
    </div>
  );
}
