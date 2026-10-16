// 共有の下書きの検証（要件 3.7「共有の下書き」「新規作成」、roadmap T3-6）
//
// 共有の下書きは、新規作成の直後などにイベント名・開始日時・版の日付が空のことがある。
// 公開用の検証（validatePublicDefinition）とは別に、下書きを保存するときに使う。
// - イベント名・開始日時・版の日付の空文字は通す（項目がない・文字列でないのは公開用と同じく誤り）
// - 開始日時が空のときは、終了日時の前後を比べない（終了日時の形式は確かめる）
// - それ以外（イベント ID、終了日時、海域・札・段階・特効グループの形、参照・重複・倍率など）は公開用と同じ規則・同じ code と path で弾く
// - 結果の形は公開用の検証と同じ（DefinitionValidationResult）
import { validatePublicDefinition } from "@/domain/definition/validate";
import type { DefinitionValidationResult } from "@/domain/definition/types";

/** 共有の下書きを検証する。例外は投げず、結果で返す */
export function validateDraftDefinition(input: unknown): DefinitionValidationResult {
  // 空の入れ物（PR-09 の指摘対応で実装担当が中身を書く）。今は公開用の検証と同じ結果を返す
  return validatePublicDefinition(input);
}
