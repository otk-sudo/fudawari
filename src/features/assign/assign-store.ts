// 割り振りの状態と操作（roadmap T2-5、要件 3.3、U22）
//
// 割り振り画面を開くたびに createAssignStore でストアを作り、画面を移ったら捨てる（「元に戻す」の履歴は画面の中だけ。U22）。
// 画面からは zustand の useStore(store, selector) で状態を読み、状態の中の関数で操作する。
//
// - 選択と開閉：艦を押すと選んで特効を開く。別の艦を選んでも前に開いた艦は閉じない。同じ艦をもう一度押すと選択を外して閉じる。
// - 置く：「ここに置く」「（札名）に置く」で選択中の艦をその札へ移し、選択を外す。
// - ドラッグ＆ドロップ：札の列へ落とすと移動、別の艦に重ねると入れ替え（相手が控えなら自分が控えへ）、控えへ落とすと割り当てを外す。
//   自分に落としても変わらない。ドラッグを始めると選択が外れる。
// - 元に戻す：割り当ての変更だけが対象（選択・開閉は対象外）。20 手まで。
// - 保存：割り当てが変わるたびに、外から渡した保存の関数（src/lib/storage の saveAssignments と同じ形）を呼ぶ。
//
// 【未実装】T2-5 の実装担当が中身を書く。いまは型を通すための空の入れ物（操作しても何も変わらない）
import { createStore, type StoreApi } from "zustand/vanilla";
import type { AssignmentMap } from "@/domain/plan/types";
import type { ShipUid } from "@/domain/ship/types";

/** 「元に戻す」で戻せる手数（U22） */
export const UNDO_LIMIT = 20;

/** 割り当ての保存（src/lib/storage の FudawariStorage.saveAssignments と同じ形） */
export type SaveAssignments = (eventId: string, assignments: AssignmentMap) => Promise<void>;

/** createAssignStore の引数 */
export interface AssignStoreOptions {
  /** 最新イベントの ID（保存の関数にそのまま渡す） */
  eventId: string;
  /** 初めの割り当て（保存から読んだもの）。書き換えない */
  assignments: AssignmentMap;
  /** 割り当てが変わるたびに呼ぶ保存の関数 */
  save: SaveAssignments;
}

/** 割り振りの状態と操作 */
export interface AssignState {
  /** 今の割り当て（個体 ID → 札 ID。キーがない・値が undefined の個体は控え） */
  readonly assignments: AssignmentMap;
  /** 選択中の艦（右側のパネルに出す艦）。なければ null */
  readonly selectedUid: ShipUid | null;
  /** 特効を開いている艦（「特効を表示中：n 隻」の n はこの数）。重複しない */
  readonly openUids: readonly ShipUid[];
  /** 「元に戻す」を押せるか（戻せる変更が 1 つ以上ある） */
  readonly canUndo: boolean;

  /** 艦（カード）を押す。選んでいなければ選んで開く。選んでいる艦なら選択を外して閉じる */
  pressShip(uid: ShipUid): void;
  /** 選択をやめる（パネルの「×」）。開いたカードは閉じない */
  clearSelection(): void;
  /** 「すべて閉じる」：開いたカードをすべて閉じ、選択も外す */
  closeAll(): void;
  /** 「ここに置く」「（札名）に置く」：選択中の艦をその札へ移し、選択を外す。選択がなければ何もしない */
  placeSelected(fudaId: string): void;
  /** ドラッグを始めた（選択が外れる） */
  startDrag(uid: ShipUid): void;
  /** 札の列の空いている所に落とした：その札へ移す */
  dropOnFuda(uid: ShipUid, fudaId: string): void;
  /** 別の艦のカードに重ねて落とした：2 隻の札を入れ替える（相手が控えなら自分が控えに戻り、相手がその札に入る） */
  dropOnShip(uid: ShipUid, targetUid: ShipUid): void;
  /** 控えに落とした：割り当てを外す */
  dropOnTray(uid: ShipUid): void;
  /** 「元に戻す」：直前の割り当ての変更を戻す。戻すものがなければ何もしない */
  undo(): void;
}

/** 割り振りのストア（zustand の vanilla ストア） */
export type AssignStore = StoreApi<AssignState>;

/** 割り振りのストアを作る。割り振り画面を開くたびに作る */
export function createAssignStore(options: AssignStoreOptions): AssignStore {
  // 【未実装】空の入れ物：初めの割り当てを持つだけで、操作しても何も変わらない
  return createStore<AssignState>()(() => ({
    assignments: options.assignments,
    selectedUid: null,
    openUids: [],
    canUndo: false,
    pressShip: () => {},
    clearSelection: () => {},
    closeAll: () => {},
    placeSelected: () => {},
    startDrag: () => {},
    dropOnFuda: () => {},
    dropOnShip: () => {},
    dropOnTray: () => {},
    undo: () => {},
  }));
}
