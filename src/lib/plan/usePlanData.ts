// 画面から札割りのデータを使うフック（roadmap T2-2・T2-5）
//
// - 既定の保存先（openStorage()）を使う共有のストア（createPlanDataStore）をモジュールに 1 つ持つ。
//   同じ画面の複数の部品（控え・札の列・右側のパネルなど）が呼んでも、読み込みは 1 回で、状態を共有する。
// - usePlanData(eventId, fudaIds) は、イベント ID と札 ID の一覧（中身）が変わったときだけ読み込む。
//   札 ID の一覧は中身で比べる（描画のたびに新しい配列を渡しても読み直さない）。
// - イベント ID が null（定義の読み込み中・失敗）のときは読まずに待機中（idle）を返す。
// - イベント ID があるときは、最初の描画から読み込み中（loading）を返す（待機中を挟まない）。
//
// 【未実装】TDD の Red の段階。型と空の入れ物だけを置いている（実装は実装担当が行う）。
import { type FudawariStorage, openStorage } from "@/lib/storage";
import type { PlanData } from "./types";

/** resetPlanDataCache の引数 */
export interface ResetPlanDataOptions {
  /** 次から使う保存先（テストで fake-indexeddb の別の DB や偽物を渡す）。省略すると既定の保存先（openStorage()） */
  storage?: FudawariStorage;
}

/**
 * 最新イベントの札割りのデータ（取り込んだ艦・最終取り込み・割り当て）と、その操作を返す。
 * @param eventId 最新イベントの ID（定義の読み込み中・失敗なら null）
 * @param fudaIds 今の定義の札 ID の一覧（これにない札の割り当ては、読み込むときに控えに戻す。U17）
 */
export function usePlanData(eventId: string | null, fudaIds: readonly string[]): PlanData {
  // 【未実装】読み込まず、待機中のまま
  void eventId;
  void fudaIds;
  return {
    status: "idle",
    setAssignments: async () => {},
    reload: async () => {},
  };
}

/**
 * usePlanData が読み書きする保存先を返す（何度呼んでも同じもの）。
 * 取り込み画面の取り込みの保存（saveImport）、設定の「取り込んだ艦娘データを削除」（clearImportedShips）などに使い、
 * その後で usePlanData の reload を呼ぶ
 */
export function getPlanStorage(): FudawariStorage {
  // 【未実装】呼ぶたびに新しく開いている（共有していない）
  return openStorage();
}

/**
 * 共有している札割りのデータを捨てる（次に使われたときに読み直す）。storage を渡すと、次からその保存先を使う。
 * テストの前準備・後片付けで使う（画面からは呼ばない）。描画中の部品には知らせない
 */
export function resetPlanDataCache(options: ResetPlanDataOptions = {}): void {
  // 【未実装】
  void options;
}
