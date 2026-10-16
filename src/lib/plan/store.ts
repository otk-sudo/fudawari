// 札割りのデータのストア（Zustand の vanilla ストア）
//
// - 保存の入口（FudawariStorage）を外から渡して作る（テストでは fake-indexeddb の保存先や偽物を渡す）。
// - load(eventId, fudaIds) で読み込む：今の定義の札 ID にない札の割り当てを控えに戻し（storage.returnOrphanedAssignments。U17）、
//   取り込んだ艦・最終取り込み・残った割り当て・戻した件数を状態に入れる。
// - 古い読み込みの結果（別のイベント ID に切り替えた後・後から始めた読み込みがあるときに届いたもの）で、新しい状態を上書きしない。
// - 割り当ての保存は 1 つずつ順に行う（続けて変えても、保存先が前の割り当てに戻らない）。
//   読み込みは、その時点で残っている保存が終わってから保存先を読む（保存の途中の割り当てを読み落とさない）。
// - 読み込み・保存の失敗は例外にせず、状態（error／saveError）に理由を入れる。
import { createStore, type StoreApi } from "zustand/vanilla";
import type { AssignmentMap } from "@/domain/plan/types";
import type { FudawariStorage } from "@/lib/storage";
import type { PlanDataActions, PlanDataError, PlanDataState } from "./types";

/** ストアの操作（画面から使う操作に、読み込みの開始を加えたもの） */
export interface PlanDataStoreActions extends PlanDataActions {
  /**
   * イベントの札割りのデータを読み込む。
   * eventId が null なら読まずに待機中（idle）にする。fudaIds は今の定義の札 ID の一覧（これにない札の割り当ては控えに戻す）。
   * 呼ぶとすぐに読み込み中（loading）になる。例外は投げない
   */
  load(eventId: string | null, fudaIds: readonly string[]): Promise<void>;
}

/** ストアの中身（状態と操作） */
export type PlanDataStoreState = PlanDataState & PlanDataStoreActions;

/** 札割りのデータのストア */
export type PlanDataStore = StoreApi<PlanDataStoreState>;

/** 読み込みの失敗の理由の文 */
const LOAD_FAILED_MESSAGE =
  "このブラウザに保存した札割りのデータを読み込めませんでした（ブラウザ内の保存を使えない可能性があります）";

/** 割り当ての保存の失敗の理由の文 */
const SAVE_FAILED_MESSAGE =
  "割り当てをこのブラウザに保存できませんでした（ブラウザ内の保存の空きが足りない・使えない可能性があります）";

/** 読み込む対象（load で決める） */
interface LoadTarget {
  eventId: string;
  fudaIds: readonly string[];
}

/** 札割りのデータのストアを作る。最初は待機中（idle）で、load を呼ぶまで保存先を読まない */
export function createPlanDataStore(storage: FudawariStorage): PlanDataStore {
  /** 読み込む対象（reload で読み直す対象）。待機中は null */
  let target: LoadTarget | null = null;
  /** 読み込みの番号。読み込みを始めるたび・待機中にするたびに増やす（古い読み込みの結果を捨てるために使う） */
  let loadSeq = 0;
  /** 割り当てを変えた回数。読み直しの間に変えた割り当てを、読んだ値で上書きしないために使う */
  let assignmentSeq = 0;
  /** 割り当ての保存の列（前の保存が終わってから次の保存をする。失敗しても列は止めない。この Promise は失敗しない） */
  let saving: Promise<void> = Promise.resolve();

  return createStore<PlanDataStoreState>((set, get) => {
    /** 状態を丸ごと置き換える（前の状態の項目を残さない。操作はそのまま） */
    function replace(next: PlanDataState): void {
      set({ ...next, load, reload, setAssignments }, true);
    }

    /** 保存先を読んで準備完了にする（失敗なら失敗の状態にする）。後から別の読み込みを始めていたら、結果を捨てる */
    async function read(current: LoadTarget): Promise<void> {
      const seq = ++loadSeq;
      const assignmentSeqAtStart = assignmentSeq;
      try {
        await saving;
        const [ships, lastImport, orphan] = await Promise.all([
          storage.loadShips(),
          storage.loadLastImport(),
          storage.returnOrphanedAssignments(current.eventId, current.fudaIds),
        ]);
        if (seq !== loadSeq) return;

        // 読み直しの間に割り当てを変えていたら、変えた割り当て（保存の列に入っている）を残す
        const state = get();
        const keepCurrent =
          assignmentSeq !== assignmentSeqAtStart && state.status === "ready" && state.eventId === current.eventId;
        replace({
          status: "ready",
          eventId: current.eventId,
          ships,
          lastImport,
          assignments: keepCurrent ? state.assignments : orphan.assignments,
          returnedCount: orphan.returnedCount,
          saveError: keepCurrent ? state.saveError : null,
        });
      } catch {
        if (seq !== loadSeq) return;
        replace({ status: "error", error: { operation: "load", message: LOAD_FAILED_MESSAGE } });
      }
    }

    /** 割り当てを保存し、結果を saveError に入れる（保存した後に別のイベントへ切り替えていたら、状態には入れない） */
    async function save(eventId: string, next: AssignmentMap): Promise<void> {
      let saveError: PlanDataError | null = null;
      try {
        await storage.saveAssignments(eventId, next);
      } catch {
        saveError = { operation: "save", message: SAVE_FAILED_MESSAGE };
      }
      const state = get();
      if (state.status === "ready" && state.eventId === eventId) {
        set({ saveError });
      }
    }

    async function load(eventId: string | null, fudaIds: readonly string[]): Promise<void> {
      if (eventId === null) {
        target = null;
        loadSeq += 1;
        replace({ status: "idle" });
        return;
      }
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

    function setAssignments(next: AssignmentMap): Promise<void> {
      const state = get();
      if (state.status !== "ready") return Promise.resolve();
      const { eventId } = state;
      assignmentSeq += 1;
      set({ assignments: next });
      const saved = saving.then(() => save(eventId, next));
      saving = saved;
      return saved;
    }

    return { status: "idle", load, reload, setAssignments };
  });
}
