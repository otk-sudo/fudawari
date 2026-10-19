// 画面から札割りのデータを使うフック（roadmap T2-2・T2-5）
//
// - 既定の保存先（openStorage()）を使う共有のストア（createPlanDataStore）をモジュールに 1 つ持つ。
//   同じ画面の複数の部品（控え・札の列・右側のパネルなど）が呼んでも、読み込みは 1 回で、状態を共有する。
// - usePlanData(eventId, fudaIds) は、イベント ID と札 ID の一覧（中身）が変わったときだけ読み込む。
//   札 ID の一覧は中身で比べる（描画のたびに新しい配列を渡しても読み直さない。並び順・重なりも問わない）。
// - イベント ID が null（定義の読み込み中・失敗）のときは読まずに待機中（idle）を返す。
//   読み込みを頼んだ後で null に変わったら、ストアを待機中にして進行中の読み込みを無効にする
//   （古い札 ID の一覧で割り当てを控えに戻さない。次にイベント ID が決まったら、前と同じ引数でも読み直す）。
// - イベント ID があるときは、最初の描画から読み込み中（loading）を返す（待機中を挟まない）。
// - 同じ画面の部品には、同じイベント ID・札 ID の一覧を渡す（どれも最新イベントの定義から作る）。
//   部品ごとに違う値を渡すと、後から頼んだ方の読み込みだけが残る。
// - getPlanStorage() は、共有のストアと同じ保存先を包んだものを返す。取り込みの保存・取り込みの確認・
//   取り込んだ艦娘データの削除は、ストアに残っている割り当ての保存がすべて終わってから行う。
//   取り込みを保存したら、ストアに知らせる（それより前に作った割り当ては保存先に書かず、読み直すときに絞って保存し直す）。
//   取り込みの確認・取り込みの保存が返す件数は、保存できていない割り当てが残っていれば、それで外れる件数で数える
//   （取り込みの保存で、数え直すための保存先の割り当てを読めなければ、取り込みは行い、保存先で数えた件数を返す）。
//   取り込みの保存が返す引き継いだ数（keptCountEventId を渡したとき）も同じく、そのイベントに保存できていない割り当てが
//   残っていれば、それで数える（UI／UX の指摘 中7、PR #44 の Codex の指摘）。
//   包みの close は何もしない。
import { useEffect, useSyncExternalStore } from "react";
import type { AssignmentMap } from "@/domain/plan/types";
import type { ShipUid } from "@/domain/ship/types";
import { type FudawariStorage, openStorage, type SaveImportInput, type SaveImportResult } from "@/lib/storage";
import { createPlanDataStore, type PlanDataStore, type UnsavedAssignments } from "./store";
import type { PlanData } from "./types";

/** resetPlanDataCache の引数 */
export interface ResetPlanDataOptions {
  /** 次から使う保存先（テストで fake-indexeddb の別の DB や偽物を渡す）。省略すると既定の保存先（openStorage()） */
  storage?: FudawariStorage;
}

/** 読み込みを頼んだ対象 */
interface LoadRequest {
  eventId: string;
  /** 札 ID の一覧を中身で比べるための鍵（fudaIdsKey） */
  fudaKey: string;
}

/** 共有の札割りのデータ（モジュールに 1 つ。初めて使われたときに作る） */
interface SharedPlanData {
  store: PlanDataStore;
  /** getPlanStorage が返す保存先（ストアと同じ保存先を包んだもの。wrapStorage） */
  storage: FudawariStorage;
  /** 最後にストアへ読み込みを頼んだ対象（まだ頼んでいなければ null） */
  requested: LoadRequest | null;
}

/** 何もしない操作（待機中と、読み込みを頼む前の読み込み中に返す） */
async function doNothing(): Promise<void> {}

/** 何もしない操作（戻り値のない操作の分） */
function doNothingSync(): void {}

/** 待機中（読み込む対象のイベントがない） */
const IDLE: PlanData = {
  status: "idle",
  setAssignments: doNothing,
  reload: doNothing,
  acknowledgeReturned: doNothingSync,
};

/** 読み込み中（読み込みをストアに頼む前の、最初の描画で返す） */
const LOADING: PlanData = {
  status: "loading",
  setAssignments: doNothing,
  reload: doNothing,
  acknowledgeReturned: doNothingSync,
};

// ---- 共有の保存先とストア（モジュールに 1 つ） ----

/** 使う保存先（null なら、次に使うときに既定の保存先を開く） */
let storage: FudawariStorage | null = null;
/** 保存先をここで開いたか（resetPlanDataCache で閉じるのは、ここで開いたものだけ） */
let ownsStorage = false;
/** 共有のストア（null なら、次に使うときに作る） */
let shared: SharedPlanData | null = null;

/** 使う保存先（中身）を返す（まだなければ既定の保存先を開く） */
function getStorage(): FudawariStorage {
  if (storage === null) {
    storage = openStorage();
    ownsStorage = true;
  }
  return storage;
}

/**
 * その取り込みを保存したら、割り当てのうち外れる件数
 * （保存先の previewImport・saveImport と同じ規則：個体 ID がある形式は取り込みにいない個体の割り当て、
 * ない形式はすべての割り当て。U9）
 */
function countRemovedByImport(assignments: AssignmentMap, input: SaveImportInput): number {
  return countByImport(assignments, input, false);
}

/**
 * その取り込みを保存したら、割り当てのうち残る（引き継ぐ）件数（countRemovedByImport と同じ規則。
 * 個体 ID がない形式では引き継がないので 0。U9）
 */
function countKeptByImport(assignments: AssignmentMap, input: SaveImportInput): number {
  return countByImport(assignments, input, true);
}

/** 割り当てのうち、取り込みの後に残る（kept が true）／外れる（false）件数 */
function countByImport(assignments: AssignmentMap, input: SaveImportInput, kept: boolean): number {
  const keepUids: ReadonlySet<ShipUid> = input.hasUid ? new Set(input.ships.map((ship) => ship.uid)) : new Set();
  let count = 0;
  for (const [uid, fudaId] of Object.entries(assignments)) {
    // 控え（undefined）は割り当てではないので数えない
    if (typeof fudaId === "string" && keepUids.has(uid) === kept) count += 1;
  }
  return count;
}

/**
 * 保存先で数えた引き継いだ数を、保存できていない割り当てがあるイベントなら、その割り当て（画面に出ている割り当て。
 * 読み直すと残す）で数え直す。引き継いだ数を頼んでいない・別のイベントなら、保存先の結果のまま
 */
function withKeptFromUnsaved(
  result: SaveImportResult,
  unsaved: UnsavedAssignments | null,
  input: SaveImportInput,
): SaveImportResult {
  if (unsaved === null || result.keptAssignmentCount === undefined || unsaved.eventId !== input.keptCountEventId) {
    return result;
  }
  return { ...result, keptAssignmentCount: countKeptByImport(unsaved.assignments, input) };
}

/**
 * 保存先で数えた外れる件数（すべてのイベントの合計）のうち、保存できていない割り当てがあるイベントの分を、
 * 保存先の割り当て（saved）の分から、保存できていない割り当て（画面に出ている割り当て。読み直すと残す）の分に置き換える
 */
function recountWithUnsaved(
  storedCount: number,
  saved: AssignmentMap,
  unsaved: UnsavedAssignments,
  input: SaveImportInput,
): SaveImportResult {
  return {
    removedAssignmentCount:
      storedCount - countRemovedByImport(saved, input) + countRemovedByImport(unsaved.assignments, input),
  };
}

/**
 * 取り込みの確認。ストアに保存できていない割り当て（保存に失敗した・取り込みで保存を見送った）が残っていれば、
 * そのイベントは保存先の古い割り当てではなく、残っている割り当てで外れる件数を数える。なければ保存先で数える
 */
async function previewImportWithUnsaved(
  inner: FudawariStorage,
  store: PlanDataStore,
  input: SaveImportInput,
): Promise<SaveImportResult> {
  const unsaved = store.unsavedAssignments();
  if (unsaved === null) return inner.previewImport(input);
  const [preview, saved] = await Promise.all([inner.previewImport(input), inner.loadAssignments(unsaved.eventId)]);
  return recountWithUnsaved(preview.removedAssignmentCount, saved, unsaved, input);
}

/**
 * 取り込みの保存。保存を終えたら、すぐにストアに知らせる（並んでいる割り当ての保存より先に取り込みの番号を進め、
 * 取り込みより前に作った割り当てを保存先に書き戻さない）。
 * 返す外した件数は、取り込みの確認（previewImportWithUnsaved）と同じく、保存できていない割り当てが残っていれば、
 * そのイベントは残っている割り当てで数える。
 * 数え直しの準備（取り込みの前の保存先の割り当ての読み取り）が失敗しても、取り込みは行い、保存先で数えた件数を返す
 */
async function saveImportWithUnsaved(
  inner: FudawariStorage,
  store: PlanDataStore,
  input: SaveImportInput,
): Promise<SaveImportResult> {
  const unsaved = store.unsavedAssignments();
  // 数え直すために、取り込みで変わる前の保存先の割り当てを読んでおく（読めなければ数え直さない）
  const saved = unsaved === null ? null : await loadAssignmentsOrNull(inner, unsaved.eventId);
  const stored = await inner.saveImport(input);
  store.noteImport(input.hasUid);
  // 引き継いだ数は、保存できていない割り当てがあれば、それだけで数え直せる（保存先の割り当ては要らない）
  const result = withKeptFromUnsaved(stored, unsaved, input);
  // 保存できていない割り当てがない・保存先の割り当てを読めなかったときは、保存先で数えた外した件数を返す
  if (unsaved === null || saved === null) return result;
  return { ...result, ...recountWithUnsaved(result.removedAssignmentCount, saved, unsaved, input) };
}

/**
 * 保存先の割り当てを読む。読めなければ null（例外にしない）。
 * 取り込みの保存の前の数え直しの準備に使い、読めなくても取り込みそのものは行う
 */
async function loadAssignmentsOrNull(inner: FudawariStorage, eventId: string): Promise<AssignmentMap | null> {
  try {
    return await inner.loadAssignments(eventId);
  } catch {
    return null;
  }
}

/**
 * 保存先を包む。取り込みの保存（saveImport）・取り込みの確認（previewImport）・取り込んだ艦娘データの削除
 * （clearImportedShips）は、ストアに残っている割り当ての保存がすべて終わってから行う
 * （保存の途中の割り当てが、取り込みで外した個体の割り当てを保存先に戻さないように）。
 * 取り込みを保存したらストアに知らせる。取り込みの確認・取り込みの保存が返す件数は、保存できていない割り当てが
 * 残っていれば、それで外れる件数で数える。
 * close は何もしない（ストアが使い続ける保存先を、受け取った側が閉じないように）。
 * ほかの操作はそのまま中継する。中継は呼ぶたびに中の保存先のメソッドを読む（テストの vi.spyOn・記録も効く）
 */
function wrapStorage(inner: FudawariStorage, store: PlanDataStore): FudawariStorage {
  return {
    saveImport: (input) => store.afterSaves(() => saveImportWithUnsaved(inner, store, input)),
    previewImport: (input) => store.afterSaves(() => previewImportWithUnsaved(inner, store, input)),
    clearImportedShips: () => store.afterSaves(() => inner.clearImportedShips()),
    loadShips: () => inner.loadShips(),
    // 最終取り込みも保存の列の後に読む（列に並んだ削除・取り込みより前の古い記録を返さない。PR-14b）
    loadLastImport: () => store.afterSaves(() => inner.loadLastImport()),
    loadAssignments: (eventId) => inner.loadAssignments(eventId),
    saveAssignments: (eventId, assignments) => inner.saveAssignments(eventId, assignments),
    returnOrphanedAssignments: (eventId, fudaIds) => inner.returnOrphanedAssignments(eventId, fudaIds),
    loadSettings: () => inner.loadSettings(),
    saveSettings: (patch) => inner.saveSettings(patch),
    // 閉じるのは resetPlanDataCache（ここで開いた既定の保存先）か、保存先を渡した側
    close: () => {},
  };
}

function getShared(): SharedPlanData {
  if (shared === null) {
    const inner = getStorage();
    const store = createPlanDataStore(inner);
    shared = { store, storage: wrapStorage(inner, store), requested: null };
  }
  return shared;
}

/** 札 ID の一覧を中身で比べるための鍵（並び順・重なりを問わない） */
function fudaIdsKey(fudaIds: readonly string[]): string {
  return JSON.stringify([...new Set(fudaIds)].sort());
}

/** 頼んだ対象が、今の引数と同じか */
function isRequested(requested: LoadRequest | null, eventId: string, fudaKey: string): boolean {
  return requested !== null && requested.eventId === eventId && requested.fudaKey === fudaKey;
}

/**
 * まだ頼んでいない対象なら、ストアに読み込みを頼む（同じ対象を頼んだ後なら何もしない）。
 * イベント ID が null に変わったら、頼んだ対象を消してストアを待機中にする
 */
function requestLoad(eventId: string | null, fudaIds: readonly string[], fudaKey: string): void {
  const current = getShared();
  if (eventId === null) {
    // まだ何も頼んでいなければストアに触らない
    if (current.requested === null) return;
    // 進行中の読み込みを無効にする（定義を読み込み直す間に、古い札 ID の一覧で割り当てを控えに戻さない）。
    // 頼んだ対象を消すので、次にイベント ID が決まったら、前と同じ引数でも読み直す
    current.requested = null;
    void current.store.getState().load(null, []);
    return;
  }
  if (isRequested(current.requested, eventId, fudaKey)) return;
  current.requested = { eventId, fudaKey };
  // load は例外を投げず、失敗も状態に入れる
  void current.store.getState().load(eventId, fudaIds);
}

/**
 * 最新イベントの札割りのデータ（取り込んだ艦・最終取り込み・割り当て）と、その操作を返す。
 * @param eventId 最新イベントの ID（定義の読み込み中・失敗なら null）
 * @param fudaIds 今の定義の札 ID の一覧（これにない札の割り当ては、読み込むときに控えに戻す。U17）
 */
export function usePlanData(eventId: string | null, fudaIds: readonly string[]): PlanData {
  const fudaKey = fudaIdsKey(fudaIds);
  const current = getShared();
  // サーバーでの描画とハイドレーションは初期の状態（待機中）で行う
  const snapshot = useSyncExternalStore(current.store.subscribe, current.store.getState, current.store.getInitialState);

  // 引数が変わったら読み込みを頼む（札 ID の一覧は鍵で比べるので、同じ中身の新しい配列なら何もしない）
  useEffect(() => {
    requestLoad(eventId, fudaIds, fudaKey);
  }, [eventId, fudaIds, fudaKey]);

  if (eventId === null) return IDLE;
  // 読み込みを頼む前（最初の描画、引数が変わった直後）は、前の対象のデータを見せずに読み込み中にする
  if (!isRequested(current.requested, eventId, fudaKey)) return LOADING;
  return snapshot;
}

/**
 * usePlanData が読み書きする保存先（resetPlanDataCache で渡した保存先、なければ既定の保存先）を包んだものを返す
 * （何度呼んでも同じもの。resetPlanDataCache の後は作り直す）。
 * 取り込みの保存（saveImport）・取り込みの確認（previewImport）・取り込んだ艦娘データの削除（clearImportedShips）は、
 * usePlanData の割り当ての保存がすべて終わってから行う。取り込みを保存したら、それより前に作った割り当ては保存先に書かず、
 * 読み直すときに取り込みの後の艦で絞ってから保存し直す。取り込みの確認・取り込みの保存が返す件数は、割り当てを保存できて
 * いないままなら、画面に出ている割り当てで外れる件数で数える。close は何もしない（共有の保存先を閉じない）。
 * ほかの操作はそのまま中継する。
 * 取り込み画面の取り込みの保存、設定の「取り込んだ艦娘データを削除」などに使い、その後で usePlanData の reload を呼ぶ
 */
export function getPlanStorage(): FudawariStorage {
  return getShared().storage;
}

/**
 * 共有している札割りのデータ（ストアと getPlanStorage が返す包み）を捨てる（次に使われたときに作り直して読み直す）。
 * storage を渡すと、次からその保存先を使う。
 * テストの前準備・後片付けで使う（画面からは呼ばない）。描画中の部品には知らせない。
 * ここで開いた既定の保存先は閉じる（渡された保存先は閉じない。閉じるのは渡した側）
 */
export function resetPlanDataCache(options: ResetPlanDataOptions = {}): void {
  if (storage !== null && ownsStorage) storage.close();
  storage = options.storage ?? null;
  ownsStorage = false;
  shared = null;
}
