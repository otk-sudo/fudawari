// 画像で保存の、画像の枚数の分け方とファイル名（要件 3.9、roadmap T2-10）。画面に依存しない純粋な関数
//
// PR-07 のテストを先に書いた段階の空の入れ物（中身は実装の担当が作る）。

/** 1 枚の画像に入れる札の数の上限（要件 3.9：1 枚に入るのは 6 札まで） */
export const FUDAS_PER_IMAGE = 6;

/**
 * 画像に入れる札の ID を、1 枚 6 札ずつに分ける（渡した順のまま。空なら 0 枚）。
 * 例：7 札 → [[1〜6 札目], [7 札目]]
 */
export function splitIntoImagePages(fudaIds: readonly string[]): string[][] {
  void fudaIds;
  return [];
}

/**
 * 保存する PNG のファイル名。
 * - 1 枚のとき：「（イベント名）_札割り.png」（例「2026夏イベ_札割り.png」）
 * - 複数枚のとき：「（イベント名）_札割り_（何枚目）.png」（例「2026夏イベ_札割り_2.png」）
 * - イベント名のうち、ファイル名に使えない文字（\ / : * ? " < > | と制御文字）は「_」にする
 */
export function exportImageFileName(eventName: string, page: number, pageCount: number): string {
  void eventName;
  void page;
  void pageCount;
  return "";
}
