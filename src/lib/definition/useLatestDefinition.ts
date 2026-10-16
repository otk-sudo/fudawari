// 画面から最新イベントの公開定義を使うフック（roadmap T2-3）
//
// - 状態は 3 つ：読み込み中（loading）・成功（success、定義つき）・失敗（error、理由つき）。
// - 同じ画面で複数の部品が呼んでも、取得は 1 回にする（モジュールのストアなどで共有する）。
//   開発時の StrictMode で effect が 2 回走っても 1 回にする。
//
// TODO(T2-3 実装担当)：中身はまだない（テストを先に書いた段階。useLatestDefinition.test.tsx を参照）
import type { PublicDefinition } from "@/domain/definition";
import type { DefinitionLoadError } from "./load";

/** 最新イベントの公開定義の読み込みの状態 */
export type LatestDefinitionState =
  | { status: "loading" }
  | { status: "success"; definition: PublicDefinition }
  | { status: "error"; error: DefinitionLoadError };

/**
 * 最新イベントの公開定義を返す。初めて使われたときに loadLatestDefinition で取得し、結果を共有する。
 */
export function useLatestDefinition(): LatestDefinitionState {
  throw new Error("未実装");
}

/**
 * 共有している読み込みの状態を初期に戻す（次に使われたときに取り直す）。
 * テストの前準備で使う（画面からは呼ばない）
 */
export function resetLatestDefinitionCache(): void {
  // TODO(T2-3 実装担当)：共有の状態を持たせたら、ここで初期に戻す
}
