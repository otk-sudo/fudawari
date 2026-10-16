// 画面から札割りのデータを使うフック（roadmap T2-2・T2-5）
//
// - 既定の保存先（openStorage()）を使う共有のストア（createPlanDataStore）をモジュールに 1 つ持つ。
//   同じ画面の複数の部品（控え・札の列・右側のパネルなど）が呼んでも、読み込みは 1 回で、状態を共有する。
// - usePlanData(eventId, fudaIds) は、イベント ID と札 ID の一覧（中身）が変わったときだけ読み込む。
//   札 ID の一覧は中身で比べる（描画のたびに新しい配列を渡しても読み直さない。並び順・重なりも問わない）。
// - イベント ID が null（定義の読み込み中・失敗）のときは読まずに待機中（idle）を返す。
// - イベント ID があるときは、最初の描画から読み込み中（loading）を返す（待機中を挟まない）。
// - 同じ画面の部品には、同じイベント ID・札 ID の一覧を渡す（どれも最新イベントの定義から作る）。
//   部品ごとに違う値を渡すと、後から頼んだ方の読み込みだけが残る。
// - getPlanStorage() は、共有のストアと同じ保存先を包んだものを返す。取り込みの保存・取り込みの確認・
//   取り込んだ艦娘データの削除は、ストアに残っている割り当ての保存がすべて終わってから行う。
import { useEffect, useSyncExternalStore } from "react";
import { type FudawariStorage, openStorage } from "@/lib/storage";
import { createPlanDataStore, type PlanDataStore } from "./store";
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
 * 保存先を包む。取り込みの保存（saveImport）・取り込みの確認（previewImport）・取り込んだ艦娘データの削除
 * （clearImportedShips）は、ストアに残っている割り当ての保存がすべて終わってから行う
 * （保存の途中の割り当てが、取り込みで外した個体の割り当てを保存先に戻さないように）。
 * ほかの操作はそのまま中継する。中継は呼ぶたびに中の保存先のメソッドを読む（テストの vi.spyOn・記録も効く）
 */
function wrapStorage(inner: FudawariStorage, store: PlanDataStore): FudawariStorage {
  return {
    saveImport: (input) => store.afterSaves(() => inner.saveImport(input)),
    previewImport: (input) => store.afterSaves(() => inner.previewImport(input)),
    clearImportedShips: () => store.afterSaves(() => inner.clearImportedShips()),
    loadShips: () => inner.loadShips(),
    loadLastImport: () => inner.loadLastImport(),
    loadAssignments: (eventId) => inner.loadAssignments(eventId),
    saveAssignments: (eventId, assignments) => inner.saveAssignments(eventId, assignments),
    returnOrphanedAssignments: (eventId, fudaIds) => inner.returnOrphanedAssignments(eventId, fudaIds),
    loadSettings: () => inner.loadSettings(),
    saveSettings: (patch) => inner.saveSettings(patch),
    close: () => inner.close(),
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

/** まだ頼んでいない対象なら、ストアに読み込みを頼む（同じ対象を頼んだ後なら何もしない） */
function requestLoad(eventId: string | null, fudaIds: readonly string[], fudaKey: string): void {
  // イベント ID が null の間はストアに触らない（読み込んだデータは、次にイベント ID が決まったときのために残す）
  if (eventId === null) return;
  const current = getShared();
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
 * usePlanData の割り当ての保存がすべて終わってから行う。ほかの操作はそのまま中継する。
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
