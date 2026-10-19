"use client";

// 札の列（要件 3.3「札の列」、モック Assign.dc.html の札ごとの <section>）
//
// - 見出しは札の色で、札名・使う段階・隻数
// - 艦を選んでいるとき、その艦がいない札の列に「ここに置く（特効あり）」／「ここに置く（特効なし）」を出す
// - 選んだ艦に特効がない札の列は薄くする（data-dimmed="true"。選んだ艦が今いる列は薄くしない）。
//   opacity で全体を薄くせず、下地・枠・見出しの札の色だけを抑え、文字は読める濃さのまま（FudaColumn.module.css）
// - 艦カードは呼ぶ側が children（<li> の並び）で渡す
// - <section> は札の列へのドロップの落とす先（dnd-kit の useDroppable。roadmap T2-8）。ドラッグ中の強調（data-drop-highlight）と、
//   列の最後の「ここに移動」の出し方は画面が決める（dropHighlight・moveHint）。
//   ドラッグ中は全部の列で「ここに移動」の場所を先に取り（出さない列では見えなくするだけ）、ドラッグ中に列の大きさを変えない。
//   dnd-kit はドラッグを始めたときに落とす先の範囲を測るので、列が後から伸びると「ここに移動」の上が範囲の外になるため
//
// 札名を見出しにして region の名前にする（aria-labelledby）。
import { useDroppable } from "@dnd-kit/core";
import { type CSSProperties, type ReactNode, useId } from "react";
import type { Fuda } from "@/domain/definition/types";
import { fudaDropIdOf } from "./dnd";
import { inkOn } from "./ship-view";
import styles from "./FudaColumn.module.css";

/** CSS 変数を含む style（React の CSSProperties は CSS 変数の名前を知らないため、型を足す） */
type StyleWithVariables = CSSProperties & Record<`--${string}`, string>;

/** 「ここに置く」ボタンの出し方。null は出さない（艦を選んでいない、選んだ艦がこの札にいる） */
export type PlaceButtonKind = "boost" | "no-boost" | null;

/** 「ここに移動」の出し方。shown は出す、reserved は場所だけ取って見えなくする（ドラッグ中のほかの列）、null は描かない（ドラッグしていない） */
export type MoveHintKind = "shown" | "reserved" | null;

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
  /** 落とす先として強調するか（ドラッグ中に、この列か列の中の艦カードの上にあるとき） */
  dropHighlight: boolean;
  /** 列の最後の「ここに移動」の出し方（出すのは、ドラッグ中に列の空いている所の上にあり、ドラッグした艦が今この列にいないとき） */
  moveHint: MoveHintKind;
  /** 艦カード（<li> の並び） */
  children: ReactNode;
}

/** 札の列 */
export function FudaColumn({
  fuda,
  stageLabels,
  count,
  place,
  dimmed,
  onPlace,
  dropHighlight,
  moveHint,
  children,
}: FudaColumnProps): ReactNode {
  const headingId = useId();
  const { setNodeRef: setDropNodeRef } = useDroppable({ id: fudaDropIdOf(fuda.id) });
  const headClass = `${styles.head} ${inkOn(fuda.color) === "dark" ? styles.darkInk : styles.lightInk}`;
  // 見出しの下地は CSS で札の色にする（薄い列では札の色を左端の線だけに抑えるため、style で直接塗らない）
  const headStyle: StyleWithVariables = { "--fuda-color": fuda.color };

  return (
    <section
      ref={setDropNodeRef}
      aria-labelledby={headingId}
      className={styles.column}
      data-dimmed={dimmed ? "true" : undefined}
      data-drop-highlight={dropHighlight ? "true" : undefined}
    >
      <div className={headClass} style={headStyle}>
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
      <ul className={styles.list}>
        {children}
        {/* 見た目だけの案内（読み上げはドラッグの知らせが行う） */}
        {moveHint !== null && (
          <li
            className={moveHint === "shown" ? styles.moveHint : `${styles.moveHint} ${styles.moveHintReserved}`}
            aria-hidden="true"
          >
            ここに移動
          </li>
        )}
      </ul>
    </section>
  );
}
