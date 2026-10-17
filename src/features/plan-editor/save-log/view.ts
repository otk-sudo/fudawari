// 保存の記録の絞り込み・件数・8 件ずつの表示（純粋な関数）
// 【PR-12 の先行テスト用の空の入れ物】中身は実装担当が作る（テスト：view.test.ts）
import type { SaveLogEntry, SaveLogKind } from "./types";

/** 絞り込みの条件（null は「全員」「すべて」） */
export interface SaveLogFilter {
  /** 誰が（記録の userName と同じ表示名。null は全員） */
  readonly userName: string | null;
  /** 種類（null はすべて） */
  readonly kind: SaveLogKind | null;
  /** 海域の表示名（null はすべて。海域を選ぶと mapLabel が null の記録〔公開など〕は出さない） */
  readonly mapLabel: string | null;
}

/** 表示する記録と件数 */
export interface SaveLogView {
  /** 表示する記録（絞り込んだ記録の先頭から 8 × pages 件。並びは入力のまま） */
  readonly shown: readonly SaveLogEntry[];
  /** 該当件数（絞り込んだ記録の件数） */
  readonly matched: number;
  /** まだ表示していない古い記録があるか（「さらに古い記録を表示」を出すか） */
  readonly hasMore: boolean;
}

/**
 * 記録（新しい順）を条件で絞り込み、先頭から 8 × pages 件を表示する記録として返す。入力は書き換えない
 * @param pages 表示するページ数（開いたとき・絞り込みを変えたときは 1。「さらに古い記録を表示」で 1 増やす）
 */
export function viewSaveLogs(entries: readonly SaveLogEntry[], filter: SaveLogFilter, pages: number): SaveLogView {
  void entries;
  void filter;
  void pages;
  throw new Error("未実装（PR-12）");
}
