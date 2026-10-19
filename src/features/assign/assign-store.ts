// 割り振りの状態と操作（roadmap T2-5、要件 3.3、U22）
//
// 割り振り画面を開くたびに createAssignStore でストアを作り、画面を移ったら捨てる（「元に戻す」の履歴は画面の中だけ。U22）。
// 画面からは zustand の useStore(store, selector) で状態を読み、状態の中の関数で操作する。
//
// - 選択と開閉：艦を押すと選んで特効を開く。別の艦を選んでも前に開いた艦は閉じない。同じ艦をもう一度押すと選択を外して閉じる。
// - 置く：「ここに置く」「（札名）に置く」で選択中の艦をその札へ移し、選択を外して、その艦のカードを閉じる。
// - ドラッグ＆ドロップ：札の列へ落とすと移動、別の艦に重ねると入れ替え（相手が控えなら自分が控えへ）、控えへ落とすと割り当てを外す。
//   自分に落としても変わらない。ドラッグを始めると選択が外れる。
//   ドラッグした艦が別の札へ移ったら（札の列へ落とす・入れ替えで札に入る）、その艦のカードを閉じる。控えへ戻したときと、
//   入れ替えで押し出された艦の開閉は変えない。
// - 札へ移した艦のカードを閉じるのは、続けて置いても「特効を表示中：n 隻」が増え続けず、札の列が開いたカードで伸び続けないため
//   （UI／UX レビュー 2026-10-19。閉じるのは置いた艦だけで、ほかの開いた艦はそのまま）。
// - 元に戻す：割り当ての変更だけが対象（選択・開閉は対象外）。20 手まで。
// - 外からの置き換え：画面の外（設定の札割りの読み込みなど）で割り当てが変わったら、新しい割り当てに替えて履歴を捨てる
//   （replaceAssignments。保存はしない。保存先はもう新しい割り当てになっている。保存の失敗の知らせを消し、
//   置き換える前に頼んだ保存の結果は映さない。PR-14）
// - 保存：割り当てが変わるたびに、外から渡した保存の関数（src/lib/storage の saveAssignments と同じ形）を呼ぶ。
//   保存の結果は待たずに画面の操作を続け、失敗したら saveError に理由を入れる（次の保存が成功したら null に戻す）。
//
// 割り当てが変わらない操作（今の札へ落とす、控えどうしを重ねるなど）は、保存も「元に戻す」の対象にもしない。
// 定義から消えた札の割り当ては、ストアを作る前に控えに戻しておく（U17。保存の returnOrphanedAssignments）。
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
  /**
   * 最後の保存が失敗したときの理由の文（保存の関数が投げたエラーのメッセージ）。初めと、保存に成功した後は null。
   * 画面は「保存できませんでした」などの文を添えて知らせる
   */
  readonly saveError: string | null;

  /** 艦（カード）を押す。選んでいなければ選んで開く。選んでいる艦なら選択を外して閉じる */
  pressShip(uid: ShipUid): void;
  /** 選択をやめる（パネルの「×」）。開いたカードは閉じない */
  clearSelection(): void;
  /** 「すべて閉じる」：開いたカードをすべて閉じ、選択も外す */
  closeAll(): void;
  /** 「ここに置く」「（札名）に置く」：選択中の艦をその札へ移し、選択を外して、その艦のカードを閉じる。選択がなければ何もしない */
  placeSelected(fudaId: string): void;
  /** ドラッグを始めた（選択が外れる） */
  startDrag(uid: ShipUid): void;
  /** 札の列の空いている所に落とした：その札へ移し、移ったらその艦のカードを閉じる */
  dropOnFuda(uid: ShipUid, fudaId: string): void;
  /**
   * 別の艦のカードに重ねて落とした：2 隻の札を入れ替える（相手が控えなら自分が控えに戻り、相手がその札に入る）。
   * ドラッグした艦が別の札へ移ったら、その艦のカードを閉じる（押し出された艦の開閉は変えない）
   */
  dropOnShip(uid: ShipUid, targetUid: ShipUid): void;
  /** 控えに落とした：割り当てを外す（カードの開閉は変えない） */
  dropOnTray(uid: ShipUid): void;
  /** 「元に戻す」：直前の割り当ての変更を戻す。戻すものがなければ何もしない */
  undo(): void;
  /** 外で変わった割り当てに置き換え、「元に戻す」の履歴と保存の失敗の知らせを捨てる（保存はしない。置き換える前に頼んだ保存の結果も映さない） */
  replaceAssignments(assignments: AssignmentMap): void;
}

/** 割り振りのストア（zustand の vanilla ストア） */
export type AssignStore = StoreApi<AssignState>;

/** 個体の札の変更（札 ID。undefined は控えに戻す） */
type Reassignment = readonly [uid: ShipUid, fudaId: string | undefined];

/** 保存の失敗の理由が分からないときの文 */
const UNKNOWN_SAVE_ERROR = "原因の分からないエラー";

/** 個体の今の札（控えなら undefined）。自分自身のキーだけを見る（Object.prototype の項目を拾わない） */
function fudaOf(assignments: AssignmentMap, uid: ShipUid): string | undefined {
  return Object.hasOwn(assignments, uid) ? assignments[uid] : undefined;
}

/** 札を変えた新しい割り当てを作る。控えに戻す個体はキーを消す。渡した割り当ては書き換えない */
function applyReassignments(assignments: AssignmentMap, changes: readonly Reassignment[]): AssignmentMap {
  const next: Partial<Record<ShipUid, string>> = { ...assignments };
  for (const [uid, fudaId] of changes) {
    if (fudaId === undefined) {
      delete next[uid];
    } else {
      next[uid] = fudaId;
    }
  }
  return next;
}

/** 保存の関数が投げたものから、失敗の理由の文を取り出す */
function describeSaveError(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  if (typeof error === "string" && error !== "") return error;
  return UNKNOWN_SAVE_ERROR;
}

/** 割り振りのストアを作る。割り振り画面を開くたびに作る */
export function createAssignStore(options: AssignStoreOptions): AssignStore {
  const { eventId, save } = options;

  return createStore<AssignState>()((set, get) => {
    /** 戻せる割り当て（古い順。UNDO_LIMIT 個まで）。ストアごとに持ち、画面を移ると一緒に消える */
    let past: AssignmentMap[] = [];
    /** 保存を頼んだ回数（最後に頼んだ保存の結果だけを saveError に映すための番号） */
    let saveRequest = 0;

    /** 割り当てを保存する。結果は待たず、失敗は saveError に入れる（Promise の拒否を外に漏らさない） */
    const persist = (assignments: AssignmentMap): void => {
      saveRequest += 1;
      const request = saveRequest;
      const settle = (saveError: string | null): void => {
        // 後から頼んだ保存があれば、その結果に任せる（割り当ては丸ごと置き換えて保存するので、最後の保存の結果が今の状態）
        if (request === saveRequest) set({ saveError });
      };
      try {
        save(eventId, assignments).then(
          () => settle(null),
          (error: unknown) => settle(describeSaveError(error)),
        );
      } catch (error) {
        // 保存の関数がその場で例外を投げても、画面の操作は止めずに保存の失敗として扱う
        settle(describeSaveError(error));
      }
    };

    /**
     * 札を変える。1 隻も変わらなければ何もしない。変わったら前の割り当てを履歴に積んで保存する。
     * 戻り値は割り当てが変わったか
     */
    const reassign = (changes: readonly Reassignment[]): boolean => {
      const current = get().assignments;
      if (changes.every(([uid, fudaId]) => fudaOf(current, uid) === fudaId)) return false;
      const next = applyReassignments(current, changes);
      past = [...past, current].slice(-UNDO_LIMIT);
      set({ assignments: next, canUndo: true });
      persist(next);
      return true;
    };

    /** 札へ移した艦のカードを閉じる（ほかの開いた艦はそのまま） */
    const closeCard = (uid: ShipUid): void => {
      const { openUids } = get();
      if (openUids.includes(uid)) set({ openUids: openUids.filter((open) => open !== uid) });
    };

    return {
      assignments: options.assignments,
      selectedUid: null,
      openUids: [],
      canUndo: false,
      saveError: null,

      pressShip: (uid) => {
        const { selectedUid, openUids } = get();
        if (selectedUid === uid) {
          set({ selectedUid: null, openUids: openUids.filter((open) => open !== uid) });
        } else {
          // ほかの開いた艦は閉じない
          set({ selectedUid: uid, openUids: openUids.includes(uid) ? openUids : [...openUids, uid] });
        }
      },
      clearSelection: () => set({ selectedUid: null }),
      closeAll: () => set({ selectedUid: null, openUids: [] }),
      placeSelected: (fudaId) => {
        const { selectedUid } = get();
        if (selectedUid === null) return;
        reassign([[selectedUid, fudaId]]);
        // 置いた艦のカードは閉じる（モック Assign.dc.html の placeTo は開いたままだが、UI／UX レビュー 2026-10-19 で変えた。
        // ほかの開いた艦は閉じない）
        set({ selectedUid: null, openUids: get().openUids.filter((open) => open !== selectedUid) });
      },
      // ドラッグ中の艦は画面（dnd-kit）が持つ。ストアは選択を外すだけ
      startDrag: () => set({ selectedUid: null }),
      dropOnFuda: (uid, fudaId) => {
        // 今の札に落としただけ（移っていない）なら、開閉も変えない
        if (reassign([[uid, fudaId]])) closeCard(uid);
      },
      dropOnShip: (uid, targetUid) => {
        if (uid === targetUid) return;
        const { assignments } = get();
        const destination = fudaOf(assignments, targetUid);
        // 控えどうし・同じ札どうしなら札は変わらない（reassign が何もしない）
        const changed = reassign([
          [uid, destination],
          [targetUid, fudaOf(assignments, uid)],
        ]);
        // ドラッグした艦が札へ移ったときだけ閉じる（相手が控えで、自分が控えに戻ったときは閉じない）
        if (changed && destination !== undefined) closeCard(uid);
      },
      dropOnTray: (uid) => reassign([[uid, undefined]]),
      replaceAssignments: (assignments) => {
        past = [];
        // 置き換える前に頼んだ保存の結果は映さない（番号を進めると、その結果は settle で捨てられる）。
        // 置き換えた割り当ては外ですでに保存されているので、保存の失敗の知らせも消す
        saveRequest += 1;
        set({ assignments, canUndo: false, saveError: null });
      },
      undo: () => {
        const previous = past.at(-1);
        if (previous === undefined) return;
        past = past.slice(0, -1);
        set({ assignments: previous, canUndo: past.length > 0 });
        persist(previous);
      },
    };
  });
}
