// 保存の記録（要件 3.7「保存の記録」、roadmap T3-10、plan-v1 の PR-12）の型
//
// - 記録は save_logs 表（docs/design/database.md 2.6）。書くのは save_draft（kind 'save'）と publish_definition（kind 'publish'）の RPC だけ
// - 画面は、開いたイベントの記録を新しい順にすべて読み（SaveLogLoader）、絞り込み・件数・8 件ずつの表示は画面側の純粋な関数（view.ts）で行う

/** 記録の種類（save_logs.kind）。画面のバッジは save →「下書き保存」、publish →「公開」 */
export type SaveLogKind = "save" | "publish";

/** 保存の記録の 1 件 */
export interface SaveLogEntry {
  /** save_logs.id（連番） */
  readonly id: number;
  /** 記録した日時（同じ時刻の日本時間の「秒の小数のない時差つき」。例 "2026-10-15T22:52:00+09:00"） */
  readonly createdAt: string;
  /** 保存・公開した人の ID（save_logs.user_id。古い記録などで分からなければ null）。「誰が」の絞り込みに使う */
  readonly userId: string | null;
  /** 誰が（保存・公開した人の表示名） */
  readonly userName: string;
  /** 種類 */
  readonly kind: SaveLogKind;
  /** 絞り込み用の海域の表示名（例 "E2"）。公開・海域によらない変更は null */
  readonly mapLabel: string | null;
  /** 内容（例「E2 ゲージ3 の大事さを「難所」→「重要」」） */
  readonly summary: string;
}

/**
 * イベントの保存の記録を、新しい順（created_at の新しい順、同じなら id の大きい順）にすべて読む。
 * 失敗したときは、画面に出す理由の文（日本語）を message に持つ Error で reject する
 */
export type SaveLogLoader = (eventId: string) => Promise<readonly SaveLogEntry[]>;
