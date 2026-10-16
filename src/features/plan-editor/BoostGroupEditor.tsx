"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { BoostGroup } from "@/domain/definition";
import type { StageActions } from "./StageDetail";
import controls from "./controls.module.css";
import styles from "./StageDetail.module.css";

/** 倍率の範囲（画面で入れられる値。定義の検証は 1 以上だけを見るが、打ち間違いを防ぐため上限を 10 にする） */
const MULTIPLIER_MIN = 1;
const MULTIPLIER_MAX = 10;
const MSG_MULTIPLIER_RANGE = `倍率は ${MULTIPLIER_MIN} 以上 ${MULTIPLIER_MAX} 以下の数で入力してください`;

export type BoostGroupEditorProps = {
  group: BoostGroup;
  /** 段階の中での順番（0 から） */
  index: number;
  /** 描いたときにグループ名の欄へフォーカスを移す（追加した直後） */
  autoFocus: boolean;
  knownShipNames: ReadonlySet<string> | undefined;
  actions: Pick<StageActions, "updateGroup" | "removeGroup" | "addShips" | "removeShip">;
};

/**
 * 特効グループ（group。名前は「特効グループ n：グループ名」）。
 * 倍率（確定したときに 1 以上 10 以下か確かめる）とグループ名をその場で編集し、艦名のタグとグループは × で外す（U16）
 */
export function BoostGroupEditor({ group, index, autoFocus, knownShipNames, actions }: BoostGroupEditorProps): ReactNode {
  // 倍率の欄の、まだ確定していない値（null は文書の値を出す）
  const [multiplierText, setMultiplierText] = useState<string | null>(null);
  const [multiplierError, setMultiplierError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [shipText, setShipText] = useState("");
  const errorId = useId();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const shipInputRef = useRef<HTMLInputElement | null>(null);
  // Esc で艦名の入力をやめたとき、続く blur で足さないための印
  const cancelShipRef = useRef(false);
  const groupName = group.name === "" ? "（名前なし）" : group.name;
  const unknownShips = knownShipNames === undefined ? [] : group.shipNames.filter((name) => !knownShipNames.has(name));

  useEffect(() => {
    if (autoFocus) nameRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (adding) shipInputRef.current?.focus();
  }, [adding]);

  const commitMultiplier = (): void => {
    if (multiplierText === null) return;
    const text = multiplierText.trim();
    const value = Number(text);
    if (text === "" || !Number.isFinite(value) || value < MULTIPLIER_MIN || value > MULTIPLIER_MAX) {
      setMultiplierError(MSG_MULTIPLIER_RANGE);
      return;
    }
    setMultiplierError(null);
    setMultiplierText(null);
    if (value !== group.multiplier) actions.updateGroup(group.id, { multiplier: value });
  };

  const commitShip = (keepOpen: boolean): void => {
    const name = shipText.trim();
    if (name !== "") actions.addShips(group.id, [name]);
    setShipText("");
    if (!keepOpen) setAdding(false);
  };

  return (
    <div role="group" aria-label={`特効グループ ${index + 1}：${groupName}`} className={styles.group}>
      <label className={styles.multiplier}>
        <span aria-hidden="true">×</span>
        <input
          type="number"
          aria-label="倍率"
          min={MULTIPLIER_MIN}
          max={MULTIPLIER_MAX}
          step={0.01}
          inputMode="decimal"
          className={styles.multiplierInput}
          value={multiplierText ?? String(group.multiplier)}
          aria-invalid={multiplierError !== null || undefined}
          aria-describedby={multiplierError === null ? undefined : errorId}
          onChange={(event) => setMultiplierText(event.currentTarget.value)}
          onBlur={commitMultiplier}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitMultiplier();
          }}
        />
      </label>
      <div className={styles.groupBody}>
        <div className={styles.groupNameRow}>
          <input
            ref={nameRef}
            type="text"
            aria-label="グループ名"
            className={`${controls.input} ${styles.groupNameInput}`}
            placeholder="グループ名（例：連合艦隊C）"
            value={group.name}
            onChange={(event) => actions.updateGroup(group.id, { name: event.currentTarget.value })}
          />
          <button
            type="button"
            aria-label={`特効グループ「${groupName}」を削除`}
            className={styles.removeGroup}
            onClick={() => actions.removeGroup(group.id)}
          >
            ×
          </button>
        </div>
        <ul className={styles.tags} aria-label="艦名">
          {group.shipNames.map((ship) => (
            <li key={ship} className={styles.tag}>
              <span>{ship}</span>
              <button
                type="button"
                aria-label={`${ship}を外す`}
                className={styles.tagRemove}
                onClick={() => actions.removeShip(group.id, ship)}
              >
                ×
              </button>
            </li>
          ))}
          <li className={styles.tagAddItem}>
            {adding ? (
              <input
                ref={shipInputRef}
                type="text"
                aria-label="追加する艦名"
                className={styles.tagInput}
                placeholder="艦名"
                value={shipText}
                onChange={(event) => setShipText(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    commitShip(true);
                  } else if (event.key === "Escape") {
                    cancelShipRef.current = true;
                    setShipText("");
                    setAdding(false);
                  }
                }}
                onBlur={() => {
                  if (cancelShipRef.current) {
                    cancelShipRef.current = false;
                    return;
                  }
                  commitShip(false);
                }}
              />
            ) : (
              <button type="button" className={styles.tagAdd} onClick={() => setAdding(true)}>
                ＋ 艦名
              </button>
            )}
          </li>
        </ul>
        {unknownShips.length > 0 && (
          <p className={styles.warning}>
            {`艦船マスタにない艦名：${unknownShips.join("、")}（書き間違いがないか確かめてください）`}
          </p>
        )}
        {multiplierError !== null && (
          <p id={errorId} role="alert" className={styles.error}>
            {multiplierError}
          </p>
        )}
      </div>
    </div>
  );
}
