// 札割りのデータのストア（Zustand の vanilla ストア）
//
// - 保存の入口（FudawariStorage）を外から渡して作る（テストでは fake-indexeddb の保存先や偽物を渡す）。
// - load(eventId, fudaIds) で読み込む：今の定義の札 ID にない札の割り当てを控えに戻し（storage.returnOrphanedAssignments。U17）、
//   取り込んだ艦・最終取り込み・残った割り当て・戻した件数を状態に入れる。
// - 読み込みは 1 つずつ順に行う。艦と最終取り込みを並べて読み、両方がそろってから、その読み込みが最新かを確かめる。
//   後から別の読み込みを頼まれていたら（待機中にしたときを含む）保存先に触らずに捨てる（古い札 ID の一覧で割り当てを控えに戻さない）。
//   艦か最終取り込みの読み取りが失敗していたら、控えに戻す処理（保存先を書き換える）をせずに失敗の状態にする
//   （読み込みが失敗するのに控えに戻して、戻した件数を知らせ損ねない）。
// - 古い読み込みの結果（別のイベント ID に切り替えた後・後から始めた読み込みがあるときに届いたもの）で、新しい状態を上書きしない。
// - 割り当ての保存は 1 つずつ順に行う（続けて変えても、保存先が前の割り当てに戻らない）。
//   読み込みは、その時点で残っている保存が終わってから保存先を読む（保存の途中の割り当てを読み落とさない）。
//   取り込みの保存・削除なども afterSaves で同じ列に入れ、割り当ての保存と重ねない（usePlanData の getPlanStorage が使う）。
// - 取り込みの番号（importSeq）は取り込みを保存するたびに進める（noteImport。getPlanStorage の取り込みの保存が呼ぶ）。
//   割り当ては、もとにした取り込みの番号を持つ。その後に取り込んでいたら保存先に書かず（取り込みで外した個体の割り当てを
//   書き戻さない）、未保存として残し、読み直すときに取り込みの後の艦で絞ってから保存し直す。
// - 同じイベントで保存できていない割り当て（保存に失敗した・取り込みで保存を見送った）が残っていれば、読み直しても消さずに残し、
//   保存し直す。ただし、その割り当てを作った後に個体 ID がない形式（古い形式）で取り込み直していたら、残さずに保存先の値を使う（U9）。
//   古い形式の取り込みは、取り込みの番号（noteImport で知らせたもの）と最終取り込みの日時の、どちらかで分かれば捨てる
//   （日時は、保存先へ直接取り込んだときや、別のタブで取り込んだときへの備え）。
// - 控えに戻した件数は、同じイベントの間は足していき、acknowledgeReturned で 0 に戻す（別のイベント・待機中では 0 から）。
// - 読み込み・保存の失敗は例外にせず、状態（error／saveError）に理由を入れる。
//   購読者が例外を投げても、ほかの購読者への知らせと、読み込み・保存の列は止めない（例外は console.error に出す）。
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
   * eventId が null なら読まずに待機中（idle）にする（進行中の読み込みの結果は捨てる）。
   * fudaIds は今の定義の札 ID の一覧（これにない札の割り当ては控えに戻す）。
   * 呼ぶとすぐに読み込み中（loading）になる。同じイベントで保存できていない割り当て（保存に失敗した・取り込みで保存を見送った）が
   * 残っていれば、それを残して保存し直す。
   * 例外は投げない
   */
  load(eventId: string | null, fudaIds: readonly string[]): Promise<void>;
}

/** ストアの中身（状態と操作） */
export type PlanDataStoreState = PlanDataState & PlanDataStoreActions;

/** 保存できないまま残っている割り当て（unsavedAssignments の戻り値） */
export interface UnsavedAssignments {
  /** 割り当てのイベントの ID */
  eventId: string;
  /** 保存できなかった割り当て（保存に失敗した・取り込みで保存を見送った割り当て。画面に出ている割り当て） */
  assignments: AssignmentMap;
}

/** 札割りのデータのストア */
export interface PlanDataStore extends StoreApi<PlanDataStoreState> {
  /**
   * ストアに残っている割り当ての保存がすべて終わってから task を行い、その結果を返す（task の失敗はそのまま返す）。
   * task の後に頼んだ割り当ての保存・読み込みは、task が終わってから保存先に触る。
   * 取り込みの保存・取り込んだ艦娘データの削除などを、割り当ての保存と重ねないために使う
   */
  afterSaves<T>(task: () => Promise<T>): Promise<T>;
  /**
   * 保存できないまま残っている割り当て（最後に変えた割り当ての保存が失敗した、または作った後の取り込みで保存を見送ったもの）。
   * なければ null。読み直すと、これを保存先の値で上書きせずに残す（個体 ID がない形式で取り込み直した後を除く）。
   * 個体 ID がない形式で取り込み直した後は、読み直す前でも null（読み直すときに捨てるため）。
   * 取り込みの確認（previewImport）・取り込みの保存（saveImport）で、保存先の古い割り当てではなく、これで外れる件数を数えるために使う
   */
  unsavedAssignments(): UnsavedAssignments | null;
  /**
   * 取り込みを保存したことを知らせる（取り込みの番号を進める）。hasUid は、その取り込みに個体 ID があったか。
   * これより前に作った割り当ては、保存先に書かずに未保存として残し、読み直すときに取り込みの後の艦で絞ってから保存し直す
   * （個体 ID がない形式なら、読み直すときに捨てる。U9）。
   * 割り当ての保存の列（afterSaves）の中で、取り込みの保存を終えた直後に呼ぶ（並んでいる割り当ての保存より先に番号を進める）
   */
  noteImport(hasUid: boolean): void;
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
  /**
   * 割り当てを変えたときの最終取り込みの日時（取り込んでいなければ null）。
   * その後に個体 ID がない形式で取り込み直したかを、読み直すときに確かめるために使う（U9）
   */
  importedAt: string | null;
  /**
   * 割り当てのもとにした取り込みの番号（importSeq）。これより後に取り込んでいたら保存先に書かず、
   * 古い形式で取り込んでいたら（legacyImportSeq がこれより大きければ）読み直すときに捨てる（U9）
   */
  importSeq: number;
  /** 保存先に書けなかったか（保存に失敗した・取り込みで保存を見送った。保存の結果を待つ間は false） */
  unsaved: boolean;
  /** 保存に失敗したときの理由（保存の結果を待つ間と、取り込みで保存を見送ったときは null） */
  saveError: PlanDataError | null;
}

/** 読み込みの結果で上書きせずに残す割り当て（の候補） */
interface KeptAssignments {
  assignments: AssignmentMap;
  saveError: PlanDataError | null;
  /** 保存できないままか（保存に失敗した・取り込みで保存を見送った。そうなら保存し直す） */
  failed: boolean;
  /** 読み始めた後に割り当てを変えたか（変えた割り当ての保存が、読んだ後の保存先に入っているかもしれない） */
  changed: boolean;
  /** 残す割り当てを作ったときの最終取り込みの日時（取り込んでいなければ null） */
  importedAt: string | null;
  /** 残す割り当てのもとにした取り込みの番号（importSeq） */
  importSeq: number;
}

/** 保存先の読み書きの結果（失敗しても例外にしない） */
type Settled<T> = { ok: true; value: T } | { ok: false };

/** 結果を捨てる（列の Promise を失敗させないために使う） */
function ignore(): void {}

/**
 * 保存先の読み書きを呼び、結果を失敗しても例外にしない形で受ける
 * （Promise を返さずにその場で例外を投げても、失敗として受ける）
 */
function settle<T>(run: () => Promise<T>): Promise<Settled<T>> {
  return new Promise<T>((resolve) => {
    resolve(run());
  }).then(
    (value): Settled<T> => ({ ok: true, value }),
    (): Settled<T> => ({ ok: false }),
  );
}

/** 最終取り込みの日時（取り込んでいない・削除した後は null） */
function importedAtOf(lastImport: ImportRecord | null): string | null {
  return lastImport?.importedAt ?? null;
}

/**
 * 読み直した艦にいない個体の割り当てを除く（除いた件数つき）。
 * 取り込んだ艦娘データを削除した後（最終取り込みがなく、艦が 0 隻）なら除かない（削除しても割り当ては残す約束のため）。
 * 最終取り込みがあれば、艦が 0 隻でも除く（取り込みにいない個体の割り当ては、保存先でも取り込みのときに外れている）
 */
function keepLoadedShips(
  assignments: AssignmentMap,
  ships: readonly OwnedShip[],
  lastImport: ImportRecord | null,
): { assignments: AssignmentMap; removedCount: number } {
  if (lastImport === null && ships.length === 0) return { assignments, removedCount: 0 };
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
  /** 取り込みの番号。取り込みを保存するたびに増やす（noteImport。取り込みより前に作った割り当てを保存先に書かないために使う） */
  let importSeq = 0;
  /** 最後に個体 ID がない形式（古い形式）で取り込んだときの取り込みの番号（まだなければ 0） */
  let legacyImportSeq = 0;
  /**
   * 状態の割り当て（画面に出ている割り当て）のもとにした取り込みの番号。
   * 読み込みで状態に入れたときと、割り当てを変えたときに決める（画面の割り当てから作った割り当ては、この番号を持つ）
   */
  let assignmentsImportSeq = 0;
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
    saving = run.then(ignore, ignore);
    return run;
  }

  /**
   * 割り当てを作った（もとにした取り込みの番号が importSeqOfAssignments の）後に、古い形式で取り込んだか（U9）。
   * 古い形式の個体 ID は取り込みの並び順の連番なので、取り込み直すと同じ個体 ID が別の艦を指すことがある
   */
  function legacyImportedSince(importSeqOfAssignments: number): boolean {
    return legacyImportSeq > importSeqOfAssignments;
  }

  /**
   * 残す割り当てを引き継がないか（作った後に古い形式で取り込み直したか。U9）。
   * 取り込みの番号（noteImport で知らせたもの）と、最終取り込みの日時（保存先へ直接取り込んだときや、
   * 別のタブで取り込んだときへの備え）の、どちらかで古い形式と分かれば引き継がない
   * （保存先の割り当ても、古い形式の取り込みのときに消えている）
   */
  function supersededByLegacyImport(kept: KeptAssignments, lastImport: ImportRecord | null): boolean {
    if (legacyImportedSince(kept.importSeq)) return true;
    return lastImport !== null && !lastImport.hasUid && lastImport.importedAt !== kept.importedAt;
  }

  function unsavedAssignments(): UnsavedAssignments | null {
    if (pending === null || !pending.unsaved) return null;
    // 作った後に古い形式で取り込んでいたら、読み直すときに捨てるので含めない（U9）
    if (legacyImportedSince(pending.importSeq)) return null;
    return { eventId: pending.eventId, assignments: pending.assignments };
  }

  function noteImport(hasUid: boolean): void {
    importSeq += 1;
    if (!hasUid) legacyImportSeq = importSeq;
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
     * 読み込みの間に変えた割り当てと、同じイベントで保存できないままの割り当て
     * （load で読み込み中にした後でも、覚えておいた割り当てを使う）
     */
    function keptAssignments(eventId: string, assignmentSeqAtStart: number): KeptAssignments | null {
      const state = get();
      const ownPending = pending !== null && pending.eventId === eventId ? pending : null;
      const failed = ownPending !== null && ownPending.unsaved;
      const changed = assignmentSeq !== assignmentSeqAtStart;
      if (state.status === "ready" && state.eventId === eventId && (failed || changed)) {
        // 画面の割り当ては、覚えている割り当てを作ったときの最終取り込み（保存に成功して覚えていなければ、
        // 画面に出ている最終取り込み）のもとで作ったもの
        const importedAt = ownPending !== null ? ownPending.importedAt : importedAtOf(state.lastImport);
        return {
          assignments: state.assignments,
          saveError: state.saveError,
          failed,
          changed,
          importedAt,
          importSeq: assignmentsImportSeq,
        };
      }
      if (ownPending !== null && failed) {
        return {
          assignments: ownPending.assignments,
          saveError: ownPending.saveError,
          failed,
          changed,
          importedAt: ownPending.importedAt,
          importSeq: ownPending.importSeq,
        };
      }
      return null;
    }

    /** 読み込みを列に入れる（前の読み込みが終わってから保存先を読む） */
    function read(current: LoadTarget): Promise<void> {
      const seq = ++loadSeq;
      const done = loading.then(() => readNow(current, seq)).then(ignore, ignore);
      loading = done;
      return done;
    }

    /** 保存先を読んで準備完了にする（失敗なら失敗の状態にする）。後から別の読み込みを頼まれていたら、結果を捨てる */
    async function readNow(current: LoadTarget, seq: number): Promise<void> {
      if (seq !== loadSeq) return;
      const assignmentSeqAtStart = assignmentSeq;
      try {
        await saving;
        if (seq !== loadSeq) return;
        // 読む艦・最終取り込みは、ここまでに保存を終えた取り込みのもの
        const importSeqAtRead = importSeq;
        // 艦（多いと時間がかかる）と最終取り込み（1 行）を並べて読み、両方が終わるまで待つ
        // （片方が先に失敗しても、次の読み込みと重ならないよう、もう片方が終わるまで待つ）
        const [ships, lastImport] = await Promise.all([
          settle(() => storage.loadShips()),
          settle(() => storage.loadLastImport()),
        ]);
        // 控えに戻す処理（保存先を書き換える）の前に、最新の読み込みかを確かめる（古い札 ID の一覧で控えに戻さない）
        if (seq !== loadSeq) return;
        // 読み取りが失敗していたら控えに戻さない（失敗の状態の間に控えに戻して、戻した件数を知らせ損ねない）
        if (!ships.ok || !lastImport.ok) {
          replace(LOAD_FAILED);
          return;
        }
        const orphan = await settle(() => storage.returnOrphanedAssignments(current.eventId, current.fudaIds));
        if (seq !== loadSeq) return;
        if (!orphan.ok) {
          replace(LOAD_FAILED);
          return;
        }
        apply(current, assignmentSeqAtStart, importSeqAtRead, ships.value, lastImport.value, orphan.value);
      } catch {
        if (seq !== loadSeq) return;
        replace(LOAD_FAILED);
      }
    }

    /**
     * 読み込んだ結果を状態に入れる（保存できていない割り当てがあれば、それを残して保存し直す）。
     * importSeqAtRead は、読んだ艦・最終取り込みのもとになった取り込みの番号
     */
    function apply(
      current: LoadTarget,
      assignmentSeqAtStart: number,
      importSeqAtRead: number,
      ships: readonly OwnedShip[],
      lastImport: ImportRecord | null,
      orphan: ReturnOrphanedAssignmentsResult,
    ): void {
      const { eventId } = current;
      countReturnedFor(eventId);
      const kept = keptAssignments(eventId, assignmentSeqAtStart);

      /** 読んだ値（保存先の割り当て）で準備完了にする */
      function replaceWithLoaded(): void {
        returnedCount += orphan.returnedCount;
        assignmentsImportSeq = importSeqAtRead;
        replace({
          status: "ready",
          eventId,
          ships,
          lastImport,
          assignments: orphan.assignments,
          returnedCount,
          saveError: null,
        });
      }

      if (kept === null) {
        // 別のイベントの保存できなかった割り当ては持ち越さない
        if (pending !== null && pending.eventId !== eventId) pending = null;
        replaceWithLoaded();
        return;
      }

      if (supersededByLegacyImport(kept, lastImport)) {
        // 古い形式で取り込み直した後は、残す割り当てを引き継がず、保存先の値を使う（保存の失敗も残さない。U9）
        pending = null;
        replaceWithLoaded();
        // 読み始めた後に変えていたら、その保存が保存先に入っているかもしれないので、読んだ値で保存し直してそろえる
        if (kept.changed) void queueSave(eventId, orphan.assignments, importedAtOf(lastImport), importSeqAtRead);
        return;
      }

      // 残す割り当ても、今の定義の札 ID にない札の割り当ては控えに戻し、読み直した艦にいない個体の割り当ては除く
      // （作った後に個体 ID がある形式で取り込んでいたら、ここで取り込みの後の艦で絞る）
      const orphanPass = returnOrphanedAssignments(kept.assignments, current.fudaIds);
      const shipPass = keepLoadedShips(orphanPass.assignments, ships, lastImport);
      returnedCount += orphanPass.returnedCount;
      assignmentsImportSeq = importSeqAtRead;
      replace({
        status: "ready",
        eventId,
        ships,
        lastImport,
        assignments: shipPass.assignments,
        returnedCount,
        saveError: kept.saveError,
      });
      // 保存できないまま・除いた割り当てがあるなら保存し直す（読み直しの間に変えただけなら、列に入っている保存に任せる）
      if (kept.failed || orphanPass.returnedCount > 0 || shipPass.removedCount > 0) {
        void queueSave(eventId, shipPass.assignments, importedAtOf(lastImport), importSeqAtRead);
      }
    }

    /**
     * 割り当てを保存し、結果を saveError に入れる（保存した後に別のイベントへ切り替えていたら、状態には入れない）。
     * 割り当てのもとにした取り込みの番号（importSeqOfAssignments）より後に取り込んでいたら、保存先に書かずに未保存として残す
     */
    async function save(
      eventId: string,
      next: AssignmentMap,
      seq: number,
      importSeqOfAssignments: number,
    ): Promise<void> {
      if (importSeqOfAssignments < importSeq) {
        // 取り込みで外した個体の割り当てを、保存先に書き戻さない。読み直すときに取り込みの後の艦で絞ってから保存し直す
        // （保存の失敗ではないので saveError は出さない）
        if (pending !== null && pending.seq === seq) pending = { ...pending, unsaved: true };
        return;
      }
      let saveError: PlanDataError | null = null;
      try {
        await storage.saveAssignments(eventId, next);
      } catch {
        saveError = { operation: "save", message: SAVE_FAILED_MESSAGE };
      }
      // 最後に変えた割り当ての保存なら、結果を覚える（成功なら済み。失敗なら、読み直すときに残して保存し直す）
      if (pending !== null && pending.seq === seq) {
        pending = saveError === null ? null : { ...pending, unsaved: true, saveError };
      }
      const state = get();
      if (state.status === "ready" && state.eventId === eventId) {
        set({ saveError });
      }
    }

    /**
     * 割り当ての保存を列に入れ、最後に変えた割り当てとして覚える（状態は呼ぶ側で変えておく）。
     * importedAt は、その割り当てを作ったときの最終取り込みの日時。importSeqOfAssignments は、もとにした取り込みの番号。
     * 返す Promise は失敗しない
     */
    function queueSave(
      eventId: string,
      next: AssignmentMap,
      importedAt: string | null,
      importSeqOfAssignments: number,
    ): Promise<void> {
      assignmentSeq += 1;
      const seq = assignmentSeq;
      pending = {
        eventId,
        seq,
        assignments: next,
        importedAt,
        importSeq: importSeqOfAssignments,
        unsaved: false,
        saveError: null,
      };
      const saved = saving.then(() => save(eventId, next, seq, importSeqOfAssignments)).then(ignore, ignore);
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
      // 画面の割り当てから作ったので、もとにした取り込みは画面の割り当てと同じ（読み直す前の取り込みの後なら、保存を見送る）
      return queueSave(state.eventId, next, importedAtOf(state.lastImport), assignmentsImportSeq);
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

  /**
   * 購読する。購読者が例外を投げても、ほかの購読者への知らせと、状態を変えた操作（読み込み・保存の列）は止めない。
   * 状態は知らせる前に変わっているため、購読者の例外は console.error に出して続ける
   */
  const subscribe: PlanDataStore["subscribe"] = (listener) =>
    store.subscribe((state, previous) => {
      try {
        listener(state, previous);
      } catch (error) {
        // 購読者の例外はその購読者の不具合。ここで投げ直すと、読み込み・保存の列や afterSaves の処理が止まる
        console.error("札割りのデータの購読者が例外を投げました", error);
      }
    });

  return { ...store, subscribe, afterSaves, unsavedAssignments, noteImport };
}
