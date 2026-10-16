// 画面から艦船マスタを使うフック（roadmap T1-5・T2-1、U1）
//
// - 状態は 3 つ：読み込み中（loading）・成功（success、艦 ID から引ける索引つき）・失敗（error、理由つき）。
// - 同じ画面で複数の部品が呼んでも、取得は 1 回にする（useLatestDefinition〔src/lib/definition〕と同じ作り：
//   モジュールに 1 つの状態を持ち、useSyncExternalStore で共有する）。
// - 静的書き出しのビルド（サーバーでの描画）では取得せず、読み込み中として書き出す。取得はブラウザで行う。
//
// 【未実装】TDD の Red の段階。型と空の入れ物だけを置いている（実装は実装担当が行う）。
import type { ShipMaster } from "@/domain/master";
import type { ShipMasterLoadError } from "./load";

/** 艦船マスタの読み込みの状態 */
export type ShipMasterState =
  | { status: "loading" }
  | { status: "success"; master: ShipMaster }
  | { status: "error"; error: ShipMasterLoadError };

/** 読み込み中（初期の状態。サーバーでの描画とハイドレーションもこの状態で行う） */
const LOADING: ShipMasterState = { status: "loading" };

/**
 * 艦船マスタを返す。初めて使われたときに loadShipMaster で取得し、結果を共有する。
 */
export function useShipMaster(): ShipMasterState {
  // 【未実装】取得せず、読み込み中のまま
  return LOADING;
}

/**
 * 共有している読み込みの状態を初期に戻す（次に使われたときに取り直す）。
 * テストの前準備で使う（画面からは呼ばない）。描画中の部品には知らせない
 */
export function resetShipMasterCache(): void {
  // 【未実装】
}
