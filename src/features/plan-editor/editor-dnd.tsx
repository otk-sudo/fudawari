"use client";

// イベント定義の画面のドラッグ＆ドロップ（要件 3.7「攻略の流れ」「札の一覧」。dnd-kit）
//
// できること（落とす場所の手前に割り込む。モックと同じく、ドラッグ中はほかの部品を動かさず、落とす場所に線を出す）
// - 札を段階へ：その段階の前に新しい段階として割り込む
// - 札を海域の「＋」・段階のない海域へ：その海域の最後に新しい段階を追加する
// - 段階を段階へ：その段階の前へ移す（別の海域へも移せる）。段階を「＋」へ：その海域の最後へ移す
// - 札を札へ：その札の前へ移す（並べ替え）。札を「＋ 札を追加」の行へ：最後へ移す
//
// 操作の方法
// - ポインター：6px 以上動かしたらドラッグを始める（段階のボタンを押すだけなら、これまでどおり選ぶ）
// - キーボード：スペースキーで持ち上げ、矢印キーで動かし、スペースキーか Enter キーで置く。Esc でやめる
//   （Enter で持ち上げないのは、段階のボタンの Enter を「選ぶ」に残すため）
import {
  type Active,
  type Announcements,
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  type KeyboardCodes,
  KeyboardSensor,
  type Over,
  PointerSensor,
  pointerWithin,
  type ScreenReaderInstructions,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { type ReactNode, useCallback, useId, useState } from "react";
import { inkFor } from "./colors";
import styles from "./PlanEditor.module.css";

/** ドラッグするもの */
export type DragItem =
  | { readonly kind: "stage"; readonly stageId: string; readonly label: string; readonly color: string }
  | { readonly kind: "fuda"; readonly fudaId: string; readonly label: string; readonly color: string };

/** 落とす場所 */
export type DropTarget =
  | { readonly kind: "stage"; readonly stageId: string; readonly label: string }
  | { readonly kind: "areaEnd"; readonly areaId: string; readonly label: string }
  | { readonly kind: "fuda"; readonly fudaId: string; readonly label: string }
  | { readonly kind: "fudaEnd"; readonly label: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

/** ドラッグしているものを読む（このファイルの部品が data に入れた形でなければ null） */
function readItem(active: Active | null): DragItem | null {
  const item: unknown = active?.data.current?.item;
  if (!isRecord(item) || typeof item.label !== "string" || typeof item.color !== "string") return null;
  if (item.kind === "stage" && typeof item.stageId === "string") {
    return { kind: "stage", stageId: item.stageId, label: item.label, color: item.color };
  }
  if (item.kind === "fuda" && typeof item.fudaId === "string") {
    return { kind: "fuda", fudaId: item.fudaId, label: item.label, color: item.color };
  }
  return null;
}

/** 落とす場所を読む（このファイルの部品が data に入れた形でなければ null） */
function readTarget(over: Pick<Over, "data"> | null): DropTarget | null {
  const target: unknown = over?.data.current?.target;
  if (!isRecord(target) || typeof target.label !== "string") return null;
  switch (target.kind) {
    case "stage":
      return typeof target.stageId === "string"
        ? { kind: "stage", stageId: target.stageId, label: target.label }
        : null;
    case "areaEnd":
      return typeof target.areaId === "string"
        ? { kind: "areaEnd", areaId: target.areaId, label: target.label }
        : null;
    case "fuda":
      return typeof target.fudaId === "string" ? { kind: "fuda", fudaId: target.fudaId, label: target.label } : null;
    case "fudaEnd":
      return { kind: "fudaEnd", label: target.label };
    default:
      return null;
  }
}

/** ドラッグしているものを、その場所に落とせるか（段階は札の一覧には落とせない） */
function accepts(item: DragItem | null, target: DropTarget | null): boolean {
  if (item === null || target === null) return false;
  if (item.kind === "stage") return target.kind === "stage" || target.kind === "areaEnd";
  return true;
}

/**
 * 落とす場所の決め方。落とせない場所は除き、ポインターなら指している場所だけ（外で離したら何もしない）、
 * キーボードならいちばん近い場所
 */
const collisionDetection: CollisionDetection = (args) => {
  const item = readItem(args.active);
  const droppableContainers = args.droppableContainers.filter((container) => accepts(item, readTarget(container)));
  const filtered = { ...args, droppableContainers };
  return args.pointerCoordinates === null ? closestCenter(filtered) : pointerWithin(filtered);
};

/** キーボードの操作（Enter で持ち上げない。段階のボタンの Enter を「選ぶ」に残す） */
const KEYBOARD_CODES: KeyboardCodes = {
  start: ["Space"],
  cancel: ["Escape"],
  end: ["Space", "Enter"],
};

/** 読み上げの説明（ドラッグできる部品の aria-describedby） */
const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    "ドラッグできます。スペースキーで持ち上げ、矢印キーで動かし、スペースキーか Enter キーで置きます。Esc キーでやめます。",
};

/** 読み上げの文（ドラッグの始まり・移動・終わり） */
const ANNOUNCEMENTS: Announcements = {
  onDragStart({ active }) {
    return `${readItem(active)?.label ?? ""}を持ち上げました。`;
  },
  onDragOver({ active, over }) {
    const target = readTarget(over);
    const label = readItem(active)?.label ?? "";
    return target === null ? `${label}は置ける場所の外にあります。` : `${label}を${target.label}の上に動かしました。`;
  },
  onDragEnd({ active, over }) {
    const target = readTarget(over);
    const label = readItem(active)?.label ?? "";
    return target === null ? `${label}を置かずに戻しました。` : `${label}を${target.label}に置きました。`;
  },
  onDragCancel({ active }) {
    return `${readItem(active)?.label ?? ""}の移動をやめました。`;
  },
};

export type EditorDndProviderProps = {
  children: ReactNode;
  /** 落としたとき（落とせる場所に落としたときだけ呼ぶ） */
  onDrop: (item: DragItem, target: DropTarget) => void;
};

/** 定義画面のドラッグ＆ドロップの範囲（攻略の流れと札の一覧を包む） */
export function EditorDndProvider({ children, onDrop }: EditorDndProviderProps): ReactNode {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { keyboardCodes: KEYBOARD_CODES }),
  );
  const [dragging, setDragging] = useState<DragItem | null>(null);
  // 読み上げの説明の要素の ID（サーバーで描いたものと食い違わないよう、React の ID を使う）
  const id = useId();

  const handleDragStart = (event: DragStartEvent): void => {
    setDragging(readItem(event.active));
  };
  const handleDragEnd = (event: DragEndEvent): void => {
    setDragging(null);
    const item = readItem(event.active);
    const target = readTarget(event.over);
    if (item !== null && target !== null && accepts(item, target)) onDrop(item, target);
  };

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{ announcements: ANNOUNCEMENTS, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {dragging !== null && (
          <span className={styles.dragChip} style={{ background: dragging.color, color: inkFor(dragging.color) }}>
            {dragging.label}
          </span>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** 2 つの ref（ドラッグとドロップ）を 1 つの要素に付ける */
function useMergedRef(
  a: (element: HTMLElement | null) => void,
  b: (element: HTMLElement | null) => void,
): (element: HTMLElement | null) => void {
  return useCallback(
    (element: HTMLElement | null) => {
      a(element);
      b(element);
    },
    [a, b],
  );
}

/** 攻略の流れの段階（ドラッグでき、札・段階を落とせる） */
export function useStageDnd(item: Extract<DragItem, { kind: "stage" }>, disabled: boolean) {
  const draggable = useDraggable({
    id: `stage:${item.stageId}`,
    data: { item },
    disabled,
    attributes: { roleDescription: "ドラッグできる段階" },
  });
  const target: DropTarget = { kind: "stage", stageId: item.stageId, label: item.label };
  const droppable = useDroppable({ id: `stage-drop:${item.stageId}`, data: { target }, disabled });
  const setNodeRef = useMergedRef(draggable.setNodeRef, droppable.setNodeRef);
  const active = readItem(droppable.active);
  // 自分自身の上では線を出さない（落としても位置は変わらない）
  const showDropLine =
    droppable.isOver && active !== null && !(active.kind === "stage" && active.stageId === item.stageId);
  return {
    setNodeRef,
    attributes: draggable.attributes,
    listeners: draggable.listeners,
    isDragging: draggable.isDragging,
    showDropLine,
  };
}

/** 海域の最後（「＋」・段階のない海域の欄）。札・段階を落とせる */
export function useAreaEndDrop(id: string, areaId: string, label: string, disabled: boolean) {
  const target: DropTarget = { kind: "areaEnd", areaId, label };
  const { setNodeRef, isOver } = useDroppable({ id, data: { target }, disabled });
  return { setNodeRef, isOver };
}

/** 札の一覧の札（持ち手でドラッグし、札を落とせる） */
export function useFudaDnd(item: Extract<DragItem, { kind: "fuda" }>, disabled: boolean) {
  const draggable = useDraggable({
    id: `fuda:${item.fudaId}`,
    data: { item },
    disabled,
    attributes: { roleDescription: "ドラッグできる札" },
  });
  const target: DropTarget = { kind: "fuda", fudaId: item.fudaId, label: item.label };
  const droppable = useDroppable({ id: `fuda-drop:${item.fudaId}`, data: { target }, disabled });
  const setNodeRef = useMergedRef(draggable.setNodeRef, droppable.setNodeRef);
  const active = readItem(droppable.active);
  // 札を動かしているときだけ線を出す（段階は札の一覧に落とせない）。自分自身の上では出さない
  const showDropLine =
    droppable.isOver && active !== null && active.kind === "fuda" && active.fudaId !== item.fudaId;
  return {
    setNodeRef,
    setHandleRef: draggable.setActivatorNodeRef,
    attributes: draggable.attributes,
    listeners: draggable.listeners,
    isDragging: draggable.isDragging,
    showDropLine,
  };
}

/** 札の一覧の最後（「＋ 札を追加」の行）。札を落とすと最後へ移す */
export function useFudaEndDrop(disabled: boolean) {
  const target: DropTarget = { kind: "fudaEnd", label: "札の一覧の最後" };
  const droppable = useDroppable({ id: "fuda-end", data: { target }, disabled });
  const active = readItem(droppable.active);
  return { setNodeRef: droppable.setNodeRef, showDropLine: droppable.isOver && active?.kind === "fuda" };
}
