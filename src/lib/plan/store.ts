// 札割りのデータのストア（Zustand の vanilla ストア）
//
// - 保存の入口（FudawariStorage）を外から渡して作る（テストでは fake-indexeddb の保存先や偽物を渡す）。
// - load(eventId, fudaIds) で読み込む：今の定義の札 ID にない札の割り当てを控えに戻し（storage.returnOrphanedAssignments。U17）、
//   取り込んだ艦・最終取り込み・残った割り当て・戻した件数を状態に入れる。
// - 読み込みは 1 つずつ順に行う。控えに戻す処理（保存先を書き換える）の直前に、その読み込みが最新かを確かめ、
//   後から別の読み込みを頼まれていたら保存先に触らずに捨てる（古い札 ID の一覧で割り当てを控えに戻さない）。
// - 古い読み込みの結果（別のイベント ID に切り替えた後・後から始めた読み込みがあるときに届いたもの）で、新しい状態を上書きしない。
// - 割り当ての保存は 1 つずつ順に行う（続けて変えても、保存先が前の割り当てに戻らない）。
//   読み込みは、その時点で残っている保存が終わってから保存先を読む（保存の途中の割り当てを読み落とさない）。
//   取り込みの保存・削除なども afterSaves で同じ列に入れ、割り当ての保存と重ねない（usePlanData の getPlanStorage が使う）。
// - 同じイベントで保存に失敗した割り当てが残っていれば、読み直しても消さずに残し、保存し直す。
// - 控えに戻した件数は、同じイベントの間は足していき、acknowledgeReturned で 0 に戻す（別のイベント・待機中では 0 から）。
// - 読み込み・保存の失敗は例外にせず、状態（error／saveError）に理由を入れる。
import { createStore, type StoreApi } from "zustand/vanilla";
import { returnOrphanedAssignments, type ReturnOrphanedAssignmentsResult } from "@/domain/plan/orphan";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip, ShipUid } from "@/domain/ship/types";
import type { FudawariStorage, ImportRecord } from "@/lib/storage";
import type { AssignmentUpdate, PlanDataActions, PlanDataError, PlanDataState } from "./types";

/** ストアの操作（画面から使う操作に、読み込みの開始を加えたもの） */
export interface PlanDataStoreActions extends PlanDataActions {
  /**
   * イベントの札割りのデータを読み込む。
   * eventId が null なら読まずに待機中（idle）にする。fudaIds は今の定義の札 ID の一覧（これにない札の割り当ては控えに戻す）。
   * 呼ぶとすぐに読み込み中（loading）になる。同じイベントで保存に失敗した割り当てが残っていれば、それを残して保存し直す。
   * 例外は投げない
   */
  load(eventId: string | null, fudaIds: readonly string[]): Promise<void>;
}

/** ストアの中身（状態と操作） */
export type PlanDataStoreState = PlanDataState & PlanDataStoreActions;

/** 札割りのデータのストア */
export interface PlanDataStore extends StoreApi<PlanDataStoreState> {
  /**
   * ストアに残っている割り当ての保存がすべて終わってから task を行い、その結果を返す（task の失敗はそのまま返す）。
   * task の後に頼んだ割り当ての保存・読み込みは、task が終わってから保存先に触る。
   * 取り込みの保存・取り込んだ艦娘データの削除などを、割り当ての保存と重ねないために使う
   */
  afterSaves<T>(task: () => Promise<T>): Promise<T>;
}

/** 読み込みの失敗の理由の文 */
const LOAD_FAILED_MESSAGE =
  "このブラウザに保存した札割りのデータを読み込めませんでした（ブラウザ内の保存を使えない可能性があります）";

/** 読み込みの失敗の状態 */
const LOAD_FAILED: PlanDataState = { status: "error", error: { operation: "load", message: LOAD_FAILED_MESSAGE } };

/** 割り当ての保存の失敗の理由の文 */
const SAVE_FAILED_MESSAGE =
  "割り当てをこのブラウザに保存できませんでした（ブラウザ内の保存の空きが足りない・使えない可能性があります）";

/** 読み込む対象（load で決める） */
interface LoadTarget {
  eventId: string;
  fudaIds: readonly string[];
}

/** 保存が済んでいない割り当て（最後に変えた割り当て） */
interface PendingSave {
  eventId: string;
  /** 変えたときの番号（assignmentSeq）。この番号の保存の結果だけを見る */
  seq: number;
  assignments: AssignmentMap;
  /** 保存に失敗したときの理由（保存の結果を待つ間は null） */
  saveError: PlanDataError | null;
}

/** 読み込みの結果で上書きせずに残す割り当て */
interface KeptAssignments {
  assignments: AssignmentMap;
  saveError: PlanDataError | null;
  /** 保存に失敗したままか（そうなら保存し直す） */
  failed: boolean;
}

/**
 * 読み直した艦にいない個体の割り当てを除く（除いた件数つき）。
 * 艦が 0 隻（取り込んだ艦娘データの削除の後）なら除かない（削除しても割り当ては残す約束のため）
 */
function keepLoadedShips(
  assignments: AssignmentMap,
  ships: readonly OwnedShip[],
): { assignments: AssignmentMap; removedCount: number } {
  if (ships.length === 0) return { assignments, removedCount: 0 };
  const uids = new Set(ships.map((ship) => ship.uid));
  const kept: Record<ShipUid, string> = {};
  let removedCount = 0;
  for (const [uid, fudaId] of Object.entries(assignments)) {
    // 控え（undefined）は割り当てではないので飛ばす
    if (typeof fudaId !== "string") continue;
    if (uids.has(uid)) {
      kept[uid] = fudaId;
    } else {
      removedCount += 1;
    }
  }
  return { assignments: kept, removedCount };
}

/** 札割りのデータのストアを作る。最初は待機中（idle）で、load を呼ぶまで保存先を読まない */
export function createPlanDataStore(storage: FudawariStorage): PlanDataStore {
  /** 読み込む対象（reload で読み直す対象）。待機中は null */
  let target: LoadTarget | null = null;
  /** 読み込みの番号。読み込みを頼むたび・待機中にするたびに増やす（古い読み込みを捨てるために使う） */
  let loadSeq = 0;
  /** 割り当てを変えた回数。読み直しの間に変えた割り当てを、読んだ値で上書きしないために使う */
  let assignmentSeq = 0;
  /**
   * 割り当ての保存の列（前の保存が終わってから次の保存をする。afterSaves で頼んだ処理も入る）。
   * 失敗しても列は止めない。この Promise は失敗しない
   */
  let saving: Promise<void> = Promise.resolve();
  /** 読み込みの列（前の読み込みが終わってから次の読み込みをする。この Promise は失敗しない） */
  let loading: Promise<void> = Promise.resolve();
  /** 保存が済んでいない割り当て（最後に変えた割り当て）。その保存に成功したら null に戻す */
  let pending: PendingSave | null = null;
  /** 控えに戻した件数を数えているイベント（待機中は null） */
  let returnedEventId: string | null = null;
  /** 控えに戻した件数（知らせ終えるまで足していく） */
  let returnedCount = 0;

  function afterSaves<T>(task: () => Promise<T>): Promise<T> {
    const run = saving.then(task);
    saving = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  const store = createStore<PlanDataStoreState>((set, get) => {
    /** 状態を丸ごと置き換える（前の状態の項目を残さない。操作はそのまま） */
    function replace(next: PlanDataState): void {
      set({ ...next, load, reload, setAssignments, acknowledgeReturned }, true);
    }

    /** 控えに戻した件数を、別のイベントなら 0 から数え直す */
    function countReturnedFor(eventId: string): void {
      if (returnedEventId === eventId) return;
      returnedEventId = eventId;
      returnedCount = 0;
    }

    /**
     * 読み込みの結果で上書きせずに残す割り当て（なければ null）。
     * 読み込みの間に変えた割り当てと、同じイベントで保存に失敗したままの割り当て
     * （load で読み込み中にした後でも、覚えておいた割り当てを使う）
     */
    function keptAssignments(eventId: string, assignmentSeqAtStart: number): KeptAssignments | null {
      const state = get();
      const failed = pending !== null && pending.eventId === eventId && pending.saveError !== null;
      const changed = assignmentSeq !== assignmentSeqAtStart;
      if (state.status === "ready" && state.eventId === eventId && (failed || changed)) {
        return { assignments: state.assignments, saveError: state.saveError, failed };
      }
      if (pending !== null && failed) {
        return { assignments: pending.assignments, saveError: pending.saveError, failed };
      }
      return null;
    }

    /** 読み込みを列に入れる（前の読み込みが終わってから保存先を読む） */
    function read(current: LoadTarget): Promise<void> {
      const seq = ++loadSeq;
      const done = loading.then(() => readNow(current, seq));
      loading = done;
      return done;
    }

    /** 保存先を読んで準備完了にする（失敗なら失敗の状態にする）。後から別の読み込みを頼まれていたら、結果を捨てる */
    async function readNow(current: LoadTarget, seq: number): Promise<void> {
      if (seq !== loadSeq) return;
      const assignmentSeqAtStart = assignmentSeq;
      try {
        await saving;
        // 控えに戻す処理（保存先を書き換える）の直前に、最新の読み込みかを確かめる（古い札 ID の一覧で控えに戻さない）
        if (seq !== loadSeq) return;
        // 次の読み込みと重ならないよう、失敗した操作があっても全部が終わるまで待つ
        const [ships, lastImport, orphan] = await Promise.allSettled([
          storage.loadShips(),
          storage.loadLastImport(),
          storage.returnOrphanedAssignments(current.eventId, current.fudaIds),
        ]);
        if (seq !== loadSeq) return;
        if (ships.status === "rejected" || lastImport.status === "rejected" || orphan.status === "rejected") {
          replace(LOAD_FAILED);
          return;
        }
        apply(current, assignmentSeqAtStart, ships.value, lastImport.value, orphan.value);
      } catch {
        if (seq !== loadSeq) return;
        replace(LOAD_FAILED);
      }
    }

    /** 読み込んだ結果を状態に入れる（保存できていない割り当てがあれば、それを残して保存し直す） */
    function apply(
      current: LoadTarget,
      assignmentSeqAtStart: number,
      ships: readonly OwnedShip[],
      lastImport: ImportRecord | null,
      orphan: ReturnOrphanedAssignmentsResult,
    ): void {
      const { eventId } = current;
      countReturnedFor(eventId);
      const kept = keptAssignments(eventId, assignmentSeqAtStart);
      if (kept === null) {
        // 別のイベントの保存できなかった割り当ては持ち越さない
        if (pending !== null && pending.eventId !== eventId) pending = null;
        returnedCount += orphan.returnedCount;
        replace({
          status: "ready",
          eventId,
          ships,
          lastImport,
          assignments: orphan.assignments,
          returnedCount,
          saveError: null,
        });
        return;
      }

      // 残す割り当ても、今の定義の札 ID にない札の割り当ては控えに戻し、読み直した艦にいない個体の割り当ては除く
      const orphanPass = returnOrphanedAssignments(kept.assignments, current.fudaIds);
      const shipPass = keepLoadedShips(orphanPass.assignments, ships);
      returnedCount += orphanPass.returnedCount;
      replace({
        status: "ready",
        eventId,
        ships,
        lastImport,
        assignments: shipPass.assignments,
        returnedCount,
        saveError: kept.saveError,
      });
      // 保存に失敗したまま・除いた割り当てがあるなら保存し直す（読み直しの間に変えただけなら、列に入っている保存に任せる）
      if (kept.failed || orphanPass.returnedCount > 0 || shipPass.removedCount > 0) {
        void queueSave(eventId, shipPass.assignments);
      }
    }

    /** 割り当てを保存し、結果を saveError に入れる（保存した後に別のイベントへ切り替えていたら、状態には入れない） */
    async function save(eventId: string, next: AssignmentMap, seq: number): Promise<void> {
      let saveError: PlanDataError | null = null;
      try {
        await storage.saveAssignments(eventId, next);
      } catch {
        saveError = { operation: "save", message: SAVE_FAILED_MESSAGE };
      }
      // 最後に変えた割り当ての保存なら、結果を覚える（成功なら済み。失敗なら、読み直すときに残して保存し直す）
      if (pending !== null && pending.seq === seq) {
        pending = saveError === null ? null : { ...pending, saveError };
      }
      const state = get();
      if (state.status === "ready" && state.eventId === eventId) {
        set({ saveError });
      }
    }

    /** 割り当ての保存を列に入れ、最後に変えた割り当てとして覚える（状態は呼ぶ側で変えておく） */
    function queueSave(eventId: string, next: AssignmentMap): Promise<void> {
      assignmentSeq += 1;
      const seq = assignmentSeq;
      pending = { eventId, seq, assignments: next, saveError: null };
      const saved = saving.then(() => save(eventId, next, seq));
      saving = saved;
      return saved;
    }

    async function load(eventId: string | null, fudaIds: readonly string[]): Promise<void> {
      if (eventId === null) {
        target = null;
        loadSeq += 1;
        returnedEventId = null;
        returnedCount = 0;
        replace({ status: "idle" });
        return;
      }
      countReturnedFor(eventId);
      target = { eventId, fudaIds: [...fudaIds] };
      replace({ status: "loading" });
      await read(target);
    }

    async function reload(): Promise<void> {
      if (target === null) return;
      // 準備完了なら、読み直す間も今のデータを見せたままにする（取り込みの後などに画面が読み込み中に戻らない）
      if (get().status !== "ready") replace({ status: "loading" });
      await read(target);
    }

    function setAssignments(update: AssignmentUpdate): Promise<void> {
      const state = get();
      if (state.status !== "ready") return Promise.resolve();
      // 関数なら、ストアの今の割り当て（同じ処理の中で前に変えた分を含む）から作る
      const next = typeof update === "function" ? update(state.assignments) : update;
      set({ assignments: next });
      return queueSave(state.eventId, next);
    }

    function acknowledgeReturned(): void {
      const state = get();
      if (state.status !== "ready") return;
      returnedEventId = state.eventId;
      returnedCount = 0;
      set({ returnedCount: 0 });
    }

    return { status: "idle", load, reload, setAssignments, acknowledgeReturned };
  });

  return { ...store, afterSaves };
}
