/* eslint-disable @typescript-eslint/no-unused-vars -- 実装前の空の入れ物。実装するときにこの行を消す */
// 保存の記録の文と、未公開の変更の一覧（要件 3.7「保存の記録」「状態の表示」の提案、roadmap T3-8・T3-10）
//
// before と after の差分から、記録の内容の文と絞り込み用の海域を作る。
// - 保存の記録：before は保存先の今の内容（衝突の確認の後なら相手が保存した内容）、after は保存する内容
// - 未公開の変更（「未公開の変更 n 件（主な変更 ほか）」）：before は公開中の版、after は共有の下書き
//
// 差分の単位と比べ方は merge.ts と同じ（段階・特効グループ・札・海域・イベントの情報。並び順は 3 つすべてにあるものの順）。
// 文の形（名前は before のもの。before にないものは after のもの）
// - 段階の項目：「E2 ゲージ3 の大事さを「難所」→「重要」」「E3 ゲージ3 の札を「第六艦隊」→「ウルシー攻撃部隊」」
//   「E2 ゲージ1 輸送 の段階名を「ゲージ1 輸送」→「ゲージ1」」
// - 段階の追加・削除：「E3 の段階を追加（新しい段階）」「E3 の段階を削除（ギミック）」
// - 別の海域への移動：「E3 ギミック を E2 へ移動」（areaIds は移す前と後）
// - 段階の並び順：「E2 の段階の並び順を変更」
// - 特効グループの追加・削除：「E3 ゲージ4 の特効を追加（第二十七駆逐隊 ×1.20）」「E2 ゲージ3 の特効を削除（連合艦隊B）」
// - 特効グループの項目：「E2 ゲージ3 の特効「連合艦隊C」の倍率を「×1.27」→「×1.30」」、名前も同じ形、
//   艦名：「E2 ゲージ3 の特効「連合艦隊C」の艦名を変更（追加：時雨、雪風／削除：響）」
// - 札：「札を追加（機動部隊）」「札を削除（予備の札）」「札「連合艦隊」の名前を「連合艦隊」→「連合艦隊（後段）」」、
//   色・札番号も同じ形、「札の並び順を変更」
// - 海域：「E4 を追加」「E4 を外す」。イベント：「イベント名を「…」→「…」」、日時も同じ形（未定は「未定」）
// - 倍率は小数第 2 位まで（×1.20）
// 一覧の順：イベント → 海域 → 札 → 段階（after の海域の順、その中の段階の順。削除した段階は before の位置）
import type { DefinitionDoc } from "@/domain/definition-edit/types";
import type { DefinitionChange, SaveSummary } from "./types";

/** before から after への変更の一覧（変更がなければ空） */
export function describeChanges(before: DefinitionDoc, after: DefinitionDoc): DefinitionChange[] {
  throw new Error("未実装");
}

/**
 * 1 回の保存の記録の内容。
 * - text：変更が 1 件ならその文、2 件以上なら「（最初の変更の文） ほか n 件」（n は残りの件数）、なければ「変更なし」
 * - areaIds：変更のあった海域の ID（重複なし。after の海域の順、after にない海域は before の順で後ろ）
 */
export function summarizeSave(before: DefinitionDoc, after: DefinitionDoc): SaveSummary {
  throw new Error("未実装");
}
