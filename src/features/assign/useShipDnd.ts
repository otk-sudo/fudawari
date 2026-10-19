"use client";

// 割り振り画面のドラッグ＆ドロップの状態と、DndContext に渡すもの（roadmap T2-8、要件 3.3「ドラッグ＆ドロップ」、モック Assign.dc.html）
//
// - センサー：マウスは 5px 以上動かすとドラッグを始める（押すだけならクリック＝選択のまま）。
//   指は 250ms 長押ししてから動かすとドラッグを始める（すぐに動かせば、ふつうのスクロールになる）。
//   PointerSensor は指の操作にも反応して、指でのスクロールや長押しの待ちとぶつかるので、MouseSensor と TouchSensor に分ける。
//   キーボードでのドラッグは作らない（切り捨て候補 1。クリックの「ここに置く」が代わり）ので KeyboardSensor は入れない
// - ドラッグを始めると選択を外し（startDrag）、落とした先に応じて、札へ移す・入れ替える・控えへ戻す
//   （dropOnFuda・dropOnShip・dropOnTray。自分自身・今いる札など、割り当てが変わらない落とし方ではストアが何もしない）
// - 落とす先の判定・読み上げの文は dnd.ts。ドラッグ中の艦（activeUid）と、ポインターの下の落とす先（over）を返し、
//   画面はそれで札の列・控えの強調と「ここに移動」を決める（dropFeedbackOf）
import {
  type DndContextProps,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  MouseSensor,
  type MouseSensorOptions,
  TouchSensor,
  type TouchSensorOptions,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useMemo, useState } from "react";
import type { ShipUid } from "@/domain/ship/types";
import type { AssignStore } from "./assign-store";
import {
  createDragAnnouncements,
  createDropTargetDetector,
  detectDropTarget,
  type DragLookup,
  type DropTarget,
  NO_DRAG_INSTRUCTIONS,
  parseDragId,
  parseDropId,
} from "./dnd";

/** マウス：押したまま 5px 動かすとドラッグを始める（それより小さい動きはクリック） */
const MOUSE_SENSOR_OPTIONS: MouseSensorOptions = { activationConstraint: { distance: 5 } };
/** 指：250ms 押したままにするとドラッグを始める。その間に 5px より動いたら、ドラッグにせずスクロールに任せる */
const TOUCH_SENSOR_OPTIONS: TouchSensorOptions = { activationConstraint: { delay: 250, tolerance: 5 } };

/** ドラッグの状態 */
interface DragState {
  /** ドラッグしている艦。していなければ null */
  readonly activeUid: ShipUid | null;
  /** ポインターの下の落とす先。なければ null */
  readonly over: DropTarget | null;
}

const IDLE: DragState = { activeUid: null, over: null };

/** useShipDnd の引数 */
export interface UseShipDndOptions {
  /** 割り振りのストア（選択を外す・落とした先へ移す） */
  store: AssignStore;
  /** 読み上げに使う艦名・札名と、艦の今いる札（描き直すたびに同じものを渡すと、読み上げの文を作り直さない） */
  lookup: DragLookup;
  /** 上に重なって隠す要素（画面の上に留めたヘッダー帯）。この上で離しても、その下に隠れたものには落とさない */
  dropBlocker?: Element | null;
}

/** useShipDnd の戻り値 */
export interface ShipDnd extends DragState {
  /** DndContext に渡すもの（children 以外） */
  contextProps: Omit<DndContextProps, "children">;
}

/** 割り振り画面のドラッグ＆ドロップ */
export function useShipDnd({ store, lookup, dropBlocker = null }: UseShipDndOptions): ShipDnd {
  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS),
  );
  const [drag, setDrag] = useState<DragState>(IDLE);
  const accessibility = useMemo(
    () => ({ announcements: createDragAnnouncements(lookup), screenReaderInstructions: NO_DRAG_INSTRUCTIONS }),
    [lookup],
  );
  // 隠す要素が変わったとき（描いたとき）だけ判定の関数を作り直す
  const collisionDetection = useMemo(
    () => (dropBlocker === null ? detectDropTarget : createDropTargetDetector(() => [dropBlocker])),
    [dropBlocker],
  );

  const handleDragStart = ({ active }: DragStartEvent): void => {
    const uid = parseDragId(active.id);
    if (uid === null) return;
    store.getState().startDrag(uid);
    setDrag({ activeUid: uid, over: null });
  };

  const handleDragOver = ({ over }: DragOverEvent): void => {
    setDrag((current) => ({ ...current, over: parseDropId(over?.id) }));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent): void => {
    setDrag(IDLE);
    const uid = parseDragId(active.id);
    const target = parseDropId(over?.id);
    if (uid === null || target === null) return;
    const { dropOnFuda, dropOnShip, dropOnTray } = store.getState();
    switch (target.kind) {
      case "fuda":
        dropOnFuda(uid, target.fudaId);
        break;
      case "ship":
        dropOnShip(uid, target.uid);
        break;
      case "tray":
        dropOnTray(uid);
        break;
    }
  };

  return {
    ...drag,
    contextProps: {
      sensors,
      collisionDetection,
      accessibility,
      onDragStart: handleDragStart,
      onDragOver: handleDragOver,
      onDragEnd: handleDragEnd,
      onDragCancel: () => setDrag(IDLE),
    },
  };
}
