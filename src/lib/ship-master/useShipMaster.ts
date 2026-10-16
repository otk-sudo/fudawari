// 画面から艦船マスタを使うフック（roadmap T1-5・T2-1、U1）
//
// - 状態は 3 つ：読み込み中（loading）・成功（success、艦 ID から引ける索引つき）・失敗（error、理由つき）。
// - 同じ画面で複数の部品が呼んでも、取得は 1 回にする（useLatestDefinition〔src/lib/definition〕と同じ作り：
//   モジュールに 1 つの状態を持ち、useSyncExternalStore で共有する）。
//   最初の部品が購読したときに取得を始め、2 回目以降の購読（開発時の StrictMode で effect が 2 回走るときを含む）では取得しない。
// - 静的書き出しのビルド（サーバーでの描画）では取得せず、読み込み中として書き出す。取得はブラウザで行う。
import { useSyncExternalStore } from "react";
import type { ShipMaster } from "@/domain/master";
import { loadShipMaster, type ShipMasterLoadError } from "./load";

/** 艦船マスタの読み込みの状態 */
export type ShipMasterState =
  | { status: "loading" }
  | { status: "success"; master: ShipMaster }
  | { status: "error"; error: ShipMasterLoadError };

/** 読み込み中（初期の状態。サーバーでの描画とハイドレーションもこの状態で行う） */
const LOADING: ShipMasterState = { status: "loading" };

// ---- 共有の読み込みの状態（モジュールに 1 つ） ----

/** 今の状態 */
let current: ShipMasterState = LOADING;
/** 取得を始めたか */
let started = false;
/** 状態を初期に戻した回数。戻す前に始めた取得の結果を、戻した後の状態に混ぜないために使う */
let generation = 0;
/** 状態が変わったときに知らせる先（購読している部品） */
const listeners = new Set<() => void>();

function publish(next: ShipMasterState): void {
  current = next;
  for (const listener of listeners) {
    listener();
  }
}

/** まだ始めていなければ取得を始める（結果は状態に入れ、購読している部品に知らせる） */
function startLoading(): void {
  if (started) return;
  started = true;
  const startedGeneration = generation;
  // loadShipMaster は例外を投げず、失敗も結果として返す
  void loadShipMaster().then((result) => {
    if (startedGeneration !== generation) return;
    publish(result.ok ? { status: "success", master: result.master } : { status: "error", error: result.error });
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  startLoading();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ShipMasterState {
  return current;
}

function getServerSnapshot(): ShipMasterState {
  return LOADING;
}

/**
 * 艦船マスタを返す。初めて使われたときに loadShipMaster で取得し、結果を共有する。
 */
export function useShipMaster(): ShipMasterState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * 共有している読み込みの状態を初期に戻す（次に使われたときに取り直す）。
 * テストの前準備で使う（画面からは呼ばない）。
 * 描画中の部品には知らせない（テストの後片付けで、部品を外す前に呼ばれても描き直しを起こさないため）
 */
export function resetShipMasterCache(): void {
  current = LOADING;
  started = false;
  generation += 1;
}
