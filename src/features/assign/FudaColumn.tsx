"use client";

// 札の列（要件 3.3「札の列」、モック Assign.dc.html の札ごとの <section>）
//
// - 見出しは札の色で、札名・使う段階・隻数
// - 艦を選んでいるとき、その艦がいない札の列に「ここに置く（特効あり）」／「ここに置く（特効なし）」を出す
// - 選んだ艦に特効がない札の列は薄くする（data-dimmed="true"。選んだ艦が今いる列は薄くしない）
// - 艦カードは呼ぶ側が children（<li> の並び）で渡す
//
// 札名を見出しにして region の名前にする（aria-labelledby）。札の列へのドロップ（PR-06）は、
// この部品の <section> に dnd-kit の useDroppable を付け、「ここに移動」の表示を足す想定。
import { type ReactNode, useId } from "react";
import type { Fuda } from "@/domain/definition/types";
import { inkOn } from "./ship-view";
import styles from "./FudaColumn.module.css";

/** 「ここに置く」ボタンの出し方。null は出さない（艦を選んでいない、選んだ艦がこの札にいる） */
export type PlaceButtonKind = "boost" | "no-boost" | null;

export interface FudaColumnProps {
  /** 札 */
  fuda: Fuda;
  /** 使う段階の表示名（例「E2 ゲージ2」）。定義の順 */
  stageLabels: readonly string[];
  /** この札に置いた艦の数 */
  count: number;
  /** 「ここに置く」ボタンの出し方 */
  place: PlaceButtonKind;
  /** 薄く表示するか */
  dimmed: boolean;
  /** 「ここに置く」を押したとき */
  onPlace: () => void;
  /** 艦カード（<li> の並び） */
  children: ReactNode;
}

/** 札の列 */
export function FudaColumn({ fuda, stageLabels, count, place, dimmed, onPlace, children }: FudaColumnProps): ReactNode {
  const headingId = useId();
  const headClass = `${styles.head} ${inkOn(fuda.color) === "dark" ? styles.darkInk : styles.lightInk}`;

  return (
    <section aria-labelledby={headingId} className={styles.column} data-dimmed={dimmed ? "true" : undefined}>
      <div className={headClass} style={{ background: fuda.color }}>
        <h2 id={headingId} className={styles.name}>
          {fuda.name}
        </h2>
        <span className={styles.meta}>
          {stageLabels.length > 0 && `${stageLabels.join("・")} ／ `}
          {count}隻
        </span>
      </div>
      {place !== null && (
        <button
          type="button"
          className={`${styles.place} ${place === "boost" ? styles.placeBoost : styles.placeNoBoost}`}
          onClick={onPlace}
        >
          {place === "boost" ? "ここに置く（特効あり）" : "ここに置く（特効なし）"}
        </button>
      )}
      <ul className={styles.list}>{children}</ul>
    </section>
  );
}
