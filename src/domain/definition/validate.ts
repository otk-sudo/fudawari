/* eslint-disable @typescript-eslint/no-unused-vars -- 実装前の空の入れ物。実装するときにこの行を消す */
// 公開定義 JSON の検証（roadmap T1-2）
// 画面・保存の仕組み・通信に依存しない純粋な関数にする。例外は投げず、結果（DefinitionValidationResult）で返す。
//
// 検証の規則（エラーの code は types.ts の DefinitionErrorCode。path は types.ts の DefinitionError を参照）
// - ルートはオブジェクト（違えば invalid_type、path ""）
// - schemaVersion：必須。1 だけ（数で 1 以外は unsupported_version）
// - event：必須のオブジェクト
//   - id・name：必須。空でない文字列
//   - startAt：必須。ISO 8601 の時差つき（"YYYY-MM-DDTHH:mm" ＋任意の秒 ＋ "Z" か "+09:00" など）。形式違いは invalid_value
//   - endAt：省略可（null として扱う）。null か startAt と同じ形式で、startAt より後（以前なら invalid_value）
//   - versionDate：必須。"YYYY-MM-DD" の実在する日付（2026-02-30 などは invalid_value）
// - areas・fudas・stages：必須の配列
// - 海域：id・name は必須の空でない文字列。id は海域どうしで重複しない（duplicate_id は 2 つ目以降の場所）
// - 札：id・name は必須の空でない文字列。color は必須の "#RRGGBB"。
//   gameNumber は省略可（null として扱う）。null か 1 以上の整数（文字列などは invalid_type、0・小数・負は invalid_value）。
//   null 以外の gameNumber は札どうしで重複しない（duplicate_value）。id は札どうしで重複しない
// - 段階：id・name は必須の空でない文字列。areaId・fudaId は必須で、存在する海域・札の ID（なければ unknown_reference）。
//   importance は必須で "normal"／"important"／"hard" のどれか（文字列で違う値は invalid_value、文字列以外は invalid_type）。
//   boosts は必須の配列（空でもよい）。id は段階どうしで重複しない
// - 特効グループ：id は必須の空でない文字列で、定義全体（すべての段階）で重複しない。name は必須の文字列（空でもよい）。
//   multiplier は必須の有限の数（数でない・NaN・Infinity は invalid_type）で 1 以上（1 未満は invalid_value）。
//   shipNames は必須の配列。要素は空でない文字列（文字列以外は invalid_type、空は invalid_value）
// - 知らない項目は無視してよい（誤りにしない）
// - 見つかった誤りはまとめて返す（最初の 1 件で止めない）
import type { DefinitionValidationResult } from "./types";

/**
 * JSON として読み込み済みの値を検証し、型付きの公開定義にする。
 * - 正しければ { ok: true, value }（value はゲーム内の札番号の省略を null にそろえた値）
 * - 不正なら { ok: false, errors }（見つかった問題をまとめて返す。1 件以上）
 */
export function validatePublicDefinition(input: unknown): DefinitionValidationResult {
  throw new Error("未実装");
}

/**
 * JSON の文字列を読み込んで検証する。JSON として読めなければ code "invalid_json"（path ""）のエラーを返す。
 * 読めた後の検証は validatePublicDefinition と同じ
 */
export function parsePublicDefinition(text: string): DefinitionValidationResult {
  throw new Error("未実装");
}
