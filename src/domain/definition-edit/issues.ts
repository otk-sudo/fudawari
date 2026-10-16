// 文書の問題の検出（3 方向マージの結果の確認、保存ボタンを止める判定。roadmap T3-6・T3-8）
//
// 項目ごとに合わせた結果（マージ）や編集の途中で、文書全体の前提が崩れることがある。次の 3 つを問題として返す。
// - 段階が 1 つもない → no_stages（場所は空）
// - 終了日時が開始日時以前（同じ時刻を含む。どちらも読める日時のときだけ比べ、時刻で比べる）
//   → end_before_start（場所は開始日時・終了日時。文は「終了日時は開始日時より後にしてください」）
// - 別々の札に同じ札番号（null は除く）→ duplicate_game_number（番号ごとに 1 件。場所はその番号の札の札番号を札の並び順で。
//   文には札の名前を入れる）。2 つ以上の番号が重なっていれば、札の並び順で先に出てくる番号から
// 問題の並びは イベント → 札 → 段階。問題がなければ空の配列。日時の形式違いなどは見ない（validateDraftDefinition の役目）。
import type { DefinitionDoc, DocumentIssue } from "./types";

/** 文書の問題の一覧を返す（問題がなければ空の配列）。文書は書き換えない */
export function findDocumentIssues(doc: DefinitionDoc): DocumentIssue[] {
  // 空の入れ物（PR-09 の指摘対応で実装担当が中身を書く）
  void doc;
  return [];
}
