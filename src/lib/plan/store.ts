// 札割りのデータのストア（Zustand の vanilla ストア）
//
// - 保存の入口（FudawariStorage）を外から渡して作る（テストでは fake-indexeddb の保存先や偽物を渡す）。
// - load(eventId, fudaIds) で読み込む：今の定義の札 ID にない札の割り当てを控えに戻し（storage.returnOrphanedAssignments。U17）、
//   取り込んだ艦・最終取り込み・残った割り当て・戻した件数を状態に入れる。
// - 古い読み込みの結果（別のイベント ID に切り替えた後に届いたもの）で、新しい状態を上書きしない。
// - 読み込み・保存の失敗は例外にせず、状態（error／saveError）に理由を入れる。
//
// 【未実装】TDD の Red の段階。型と空の入れ物だけを置いている（実装は実装担当が行う）。
import { createStore, type StoreApi } from "zustand/vanilla";
import type { FudawariStorage } from "@/lib/storage";
import type { PlanDataActions, PlanDataState } from "./types";

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

/** 札割りのデータのストアを作る。最初は待機中（idle）で、load を呼ぶまで保存先を読まない */
export function createPlanDataStore(storage: FudawariStorage): PlanDataStore {
  // 【未実装】保存先を使わず、待機中のまま何もしない
  void storage;
  return createStore<PlanDataStoreState>(() => ({
    status: "idle",
    load: async () => {},
    reload: async () => {},
    setAssignments: async () => {},
  }));
}
