// 割り振り画面のドラッグ＆ドロップの決まりごと（roadmap T2-8、要件 3.3「ドラッグ＆ドロップ」、モック Assign.dc.html）
//
// dnd-kit に渡す ID・落とす先の判定・読み上げの文を置く。画面の部品は useShipDnd.ts・DraggableShipItem.tsx。
// - ID：ドラッグする艦は "drag:個体 ID"、落とす先は "ship:個体 ID"（艦カード）・"fuda:札 ID"（札の列）・"tray"（控え）。
//   艦カードはドラッグするものと落とす先の両方なので、ID を分ける（同じ ID だと、自分の上にあるのか分からなくなる）
// - 落とす先の判定：ポインターの下にあるものから選び、艦カードを札の列・控えより優先する（カードに重ねると入れ替え）。
//   控えの一覧は仮想スクロールで前後に少し余分に行を描くので、スクロールで隠れた行のカードには当てない。
//   控えの一覧の一番上に固定した区切りの見出しの上では、その下に隠れたカードに当てず、控えとして扱う。
//   画面の上に留めたヘッダー帯の上では、落とす先なしにする（createDropTargetDetector）
// - 読み上げ：dnd-kit の既定（英語・ID を読む）の代わりに、艦名・札名で知らせる日本語の文にする。
//   キーボードでのドラッグは作らない（切り捨て候補 1）ので、キーボードの操作説明は置かない
import type { Announcements, CollisionDetection, ScreenReaderInstructions, UniqueIdentifier } from "@dnd-kit/core";
import { pointerWithin } from "@dnd-kit/core";
import type { ShipUid } from "@/domain/ship/types";

/** 落とす先 */
export type DropTarget =
  /** 札の列（艦カードの外） */
  | { readonly kind: "fuda"; readonly fudaId: string }
  /** 控え（艦カードの外） */
  | { readonly kind: "tray" }
  /** 艦カード（札の列でも控えでも） */
  | { readonly kind: "ship"; readonly uid: ShipUid };

const DRAG_PREFIX = "drag:";
const SHIP_DROP_PREFIX = "ship:";
const FUDA_DROP_PREFIX = "fuda:";
/** 控えの落とす先の ID */
export const TRAY_DROP_ID = "tray";

/** ドラッグする艦の ID */
export function dragIdOf(uid: ShipUid): string {
  return `${DRAG_PREFIX}${uid}`;
}

/** 艦カード（落とす先）の ID */
export function shipDropIdOf(uid: ShipUid): string {
  return `${SHIP_DROP_PREFIX}${uid}`;
}

/** 札の列（落とす先）の ID */
export function fudaDropIdOf(fudaId: string): string {
  return `${FUDA_DROP_PREFIX}${fudaId}`;
}

/** ドラッグする艦の ID から個体 ID を取り出す。ドラッグする艦の ID でなければ null */
export function parseDragId(id: UniqueIdentifier): ShipUid | null {
  return typeof id === "string" && id.startsWith(DRAG_PREFIX) ? id.slice(DRAG_PREFIX.length) : null;
}

/** 落とす先の ID を読む。落とす先がない・落とす先の ID でなければ null */
export function parseDropId(id: UniqueIdentifier | null | undefined): DropTarget | null {
  if (typeof id !== "string") return null;
  if (id === TRAY_DROP_ID) return { kind: "tray" };
  if (id.startsWith(SHIP_DROP_PREFIX)) return { kind: "ship", uid: id.slice(SHIP_DROP_PREFIX.length) };
  if (id.startsWith(FUDA_DROP_PREFIX)) return { kind: "fuda", fudaId: id.slice(FUDA_DROP_PREFIX.length) };
  return null;
}

// ---- 落とす先の判定 ----

/** 艦カードの落とす先に付けるデータ（useDroppable の data） */
export interface ShipDropData {
  /**
   * 当たりを取る範囲を、この要素の見える範囲に限る（控えの一覧のスクロールする要素）。
   * スクロールで隠れた行のカードが、控えの見出しや下に回り込んだ札の列の上で当たらないようにする
   */
  readonly clip: Element | null;
  /**
   * このカードの上に重なって隠す要素（控えの一覧の一番上に固定した区切りの見出しの行）。
   * ポインターがこの要素の見える範囲の中にあれば、このカードには当てない（控えの落とす先に任せる）。隠す要素がなければ null
   */
  readonly cover: Element | null;
}

/** 点が要素の見える範囲（画面上の矩形）の中にあるか */
function isPointInside(element: Element, point: { x: number; y: number }): boolean {
  const rect = element.getBoundingClientRect();
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

/**
 * 落とす先の判定（DndContext の collisionDetection）。
 * ポインターの下の艦カード（見える範囲の中にあり、固定した見出しに隠れていないもの）があれば、それだけを返す。
 * なければ札の列・控えを返す
 */
export const detectDropTarget: CollisionDetection = (args) => {
  const { pointerCoordinates, droppableContainers } = args;
  const hits = pointerWithin(args);
  const isShip = (id: UniqueIdentifier): boolean => parseDropId(id)?.kind === "ship";
  const shipHit = hits.find((hit) => {
    if (!isShip(hit.id) || pointerCoordinates === null) return false;
    const data = droppableContainers.find((candidate) => candidate.id === hit.id)?.data.current;
    const clip: unknown = data?.clip;
    const cover: unknown = data?.cover;
    if (clip instanceof Element && !isPointInside(clip, pointerCoordinates)) return false;
    return !(cover instanceof Element && isPointInside(cover, pointerCoordinates));
  });
  if (shipHit !== undefined) return [shipHit];
  return hits.filter((hit) => !isShip(hit.id));
};

/**
 * 上に重なって隠す要素（画面の上に留めたヘッダー帯など）を考える、落とす先の判定を作る。
 * ポインターが隠す要素の見える範囲の中にあれば、落とす先なし（その下に隠れた札の列・艦カードに落とさない。PR #45 のレビュー）。
 * そうでなければ detectDropTarget と同じ。隠す要素は判定のたびに getBlockers で読む（まだ描いていない要素は null）
 */
export function createDropTargetDetector(getBlockers: () => readonly (Element | null)[]): CollisionDetection {
  return (args) => {
    const { pointerCoordinates } = args;
    if (pointerCoordinates !== null) {
      const blocked = getBlockers().some((blocker) => blocker !== null && isPointInside(blocker, pointerCoordinates));
      if (blocked) return [];
    }
    return detectDropTarget(args);
  };
}

// ---- 落とした結果 ----

/** 読み上げの文・ドラッグ中の表示を決めるのに使う、今の画面の情報 */
export interface DragLookup {
  /** 艦名（分からなければ「艦」など） */
  shipName(uid: ShipUid): string;
  /** 札名 */
  fudaName(fudaId: string): string;
  /** 艦が今いる札の ID（控えなら null） */
  placeOf(uid: ShipUid): string | null;
}

/** 落とした結果（割り当てがどう変わるか）。落とす前の割り当てで決める */
export type DropOutcome =
  | { readonly kind: "move"; readonly fudaId: string }
  | { readonly kind: "return" }
  | { readonly kind: "swap"; readonly targetUid: ShipUid }
  | { readonly kind: "none" };

/** uid の艦を target に落としたときの結果（createAssignStore の dropOnFuda・dropOnTray・dropOnShip と同じ決まり） */
export function dropOutcomeOf(lookup: Pick<DragLookup, "placeOf">, uid: ShipUid, target: DropTarget | null): DropOutcome {
  if (target === null) return { kind: "none" };
  const place = lookup.placeOf(uid);
  switch (target.kind) {
    case "fuda":
      return place === target.fudaId ? { kind: "none" } : { kind: "move", fudaId: target.fudaId };
    case "tray":
      return place === null ? { kind: "none" } : { kind: "return" };
    case "ship":
      // 自分自身・同じ札どうし・控えどうしなら札は変わらない
      return target.uid === uid || lookup.placeOf(target.uid) === place
        ? { kind: "none" }
        : { kind: "swap", targetUid: target.uid };
  }
}

// ---- ドラッグ中の表示 ----

/** ドラッグ中の、札の列・控えの表示（モック Assign.dc.html の boxStyle・moveHint・trayStyle） */
export interface DropFeedback {
  /** 強調する札の列（その列の上か、列の中の艦カードの上にあるとき）。なければ null */
  readonly highlightedFudaId: string | null;
  /** 「ここに移動」を出す札の列（列の空いている所の上で、ドラッグした艦が今いる列でないとき）。なければ null */
  readonly moveHintFudaId: string | null;
  /** 控えを強調するか（札に置いた艦をドラッグしていて、控えの空いている所の上にあるとき） */
  readonly trayHighlighted: boolean;
}

/** ドラッグしていないときの表示 */
const NO_FEEDBACK: DropFeedback = { highlightedFudaId: null, moveHintFudaId: null, trayHighlighted: false };

/** ドラッグ中の表示を決める（activeUid：ドラッグしている艦、over：ポインターの下の落とす先） */
export function dropFeedbackOf(
  lookup: Pick<DragLookup, "placeOf">,
  activeUid: ShipUid | null,
  over: DropTarget | null,
): DropFeedback {
  if (activeUid === null || over === null) return NO_FEEDBACK;
  const place = lookup.placeOf(activeUid);
  switch (over.kind) {
    case "fuda":
      return {
        highlightedFudaId: over.fudaId,
        moveHintFudaId: place === over.fudaId ? null : over.fudaId,
        trayHighlighted: false,
      };
    case "tray":
      return { ...NO_FEEDBACK, trayHighlighted: place !== null };
    case "ship":
      return { ...NO_FEEDBACK, highlightedFudaId: lookup.placeOf(over.uid) };
  }
}

// ---- 読み上げ ----

/**
 * 操作の説明（DndContext の accessibility.screenReaderInstructions）。
 * 説明はどこからも読ませない（li に useDraggable の attributes〔aria-describedby〕を付けない）ので空にする。
 * 渡さないと、dnd-kit が英語の既定の説明を見えない要素として DOM に置くため、空の文を渡す
 */
export const NO_DRAG_INSTRUCTIONS: ScreenReaderInstructions = { draggable: "" };

/** ドラッグの読み上げの文（DndContext の accessibility.announcements） */
export function createDragAnnouncements(lookup: DragLookup): Announcements {
  /** ドラッグしている艦の名前（ID が読めなければ「艦」） */
  const draggedName = (id: UniqueIdentifier): string => {
    const uid = parseDragId(id);
    return uid === null ? "艦" : lookup.shipName(uid);
  };

  return {
    onDragStart: ({ active }) => `${draggedName(active.id)}をつかみました`,
    onDragOver: ({ active, over }) => {
      const target = parseDropId(over?.id);
      if (target === null) return "落とす先の外にあります";
      switch (target.kind) {
        case "fuda":
          return `${lookup.fudaName(target.fudaId)}の上にあります`;
        case "tray":
          return "控えの上にあります";
        case "ship": {
          const uid = parseDragId(active.id);
          if (target.uid === uid) return "元の位置にあります";
          const targetName = lookup.shipName(target.uid);
          // 入れ替わる相手（違う札の艦、札の艦と控えの艦）の上だけ、入れ替えると知らせる（落とした結果と同じ判定）
          return uid !== null && dropOutcomeOf(lookup, uid, target).kind === "swap"
            ? `${targetName}の上にあります。離すと入れ替えます`
            : `${targetName}の上にあります`;
        }
      }
    },
    onDragEnd: ({ active, over }) => {
      const uid = parseDragId(active.id);
      const name = draggedName(active.id);
      const outcome: DropOutcome = uid === null ? { kind: "none" } : dropOutcomeOf(lookup, uid, parseDropId(over?.id));
      switch (outcome.kind) {
        case "move":
          return `${name}を${lookup.fudaName(outcome.fudaId)}に移しました`;
        case "return":
          return `${name}を控えに戻しました`;
        case "swap":
          return `${name}と${lookup.shipName(outcome.targetUid)}を入れ替えました`;
        case "none":
          return `${name}は動かしませんでした`;
      }
    },
    onDragCancel: ({ active }) => `${draggedName(active.id)}のドラッグをやめました`,
  };
}
