"use client";

// 艦カードを包む li（ドラッグする要素で、重ねて入れ替える落とす先。roadmap T2-8、要件 3.3「ドラッグ＆ドロップ」、モック Assign.dc.html）
//
// - 控え（TrayGroupList）と札の列（AssignScreen）の両方で使う。中の艦カード（ShipCard）は呼ぶ側が children で渡す
// - li はボタンにも Tab で止まる所にもしない（キーボードでのドラッグは作らない。クリックの「ここに置く」が代わり）。
//   そのため useDraggable の attributes（role="button"・tabIndex・英語の aria-roledescription）は付けず、listeners だけを付ける
// - ドラッグしている艦は薄くする。別の艦をドラッグして重ねている間は、点線の枠と「⇄ 入れ替え」を出す（自分自身の上では出さない）
// - 控えの一覧（仮想スクロール）の行として使うときは、行の位置の style・data-index・行の高さを測る measureRef と、
//   当たりを取る範囲（clip：一覧のスクロールする要素）を渡す
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { type CSSProperties, type ReactNode, useCallback } from "react";
import type { ShipUid } from "@/domain/ship/types";
import { dragIdOf, type ShipDropData, shipDropIdOf } from "./dnd";
import styles from "./DraggableShipItem.module.css";

export interface DraggableShipItemProps {
  /** 艦の個体 ID */
  uid: ShipUid;
  /** 落とす先の当たりを取る範囲を、この要素の見える範囲に限る（控えの一覧のスクロールする要素）。省略すると限らない */
  clip?: Element | null;
  /** 足すクラス（控えの行の間隔など） */
  className?: string;
  /** 足す style（控えの行の位置） */
  style?: CSSProperties;
  /** 仮想スクロールの行の番号（data-index。行の高さを測るときに使う） */
  virtualIndex?: number;
  /** 仮想スクロールの行の高さを測る ref */
  measureRef?: (element: HTMLLIElement | null) => void;
  /** 艦カード */
  children: ReactNode;
}

/** 艦カードを包む li */
export function DraggableShipItem({
  uid,
  clip = null,
  className,
  style,
  virtualIndex,
  measureRef,
  children,
}: DraggableShipItemProps): ReactNode {
  const { setNodeRef: setDragNodeRef, listeners, isDragging } = useDraggable({ id: dragIdOf(uid) });
  const dropData: ShipDropData = { clip };
  const { setNodeRef: setDropNodeRef, isOver, active } = useDroppable({ id: shipDropIdOf(uid), data: dropData });
  const ref = useCallback(
    (element: HTMLLIElement | null) => {
      setDragNodeRef(element);
      setDropNodeRef(element);
      measureRef?.(element);
    },
    [setDragNodeRef, setDropNodeRef, measureRef],
  );
  // 別の艦をドラッグして、このカードに重ねている
  const swapTarget = isOver && active !== null && !isDragging;

  return (
    <li
      ref={ref}
      className={className === undefined ? styles.item : `${styles.item} ${className}`}
      style={style}
      data-index={virtualIndex}
      data-dragging={isDragging ? "true" : undefined}
      data-swap-target={swapTarget ? "true" : undefined}
      {...listeners}
    >
      {children}
      {swapTarget && (
        <span className={styles.swapHint} aria-hidden="true">
          ⇄ 入れ替え
        </span>
      )}
    </li>
  );
}
