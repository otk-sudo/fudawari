/* eslint-disable @typescript-eslint/no-unused-vars -- 実装前の空の入れ物。実装するときにこの行を消す */
// イベントの情報（名前・日時）の編集と検証、終了の判定（要件 3.7「上部の欄」「終了したイベント」、roadmap T3-6）
//
// 日時は ISO 8601 の時差つきの文字列（例 "2026-08-07T12:00+09:00"、秒は省略可。PublicDefinition の約束）。
// 前後の比較は文字列ではなく時刻で行う（時差の書き方が違っても正しく比べる）。
import type { DefinitionDoc, EditResult, EventInfoError, EventInfoInput, EventPatch } from "./types";

/**
 * イベントの名前・開始日時・終了日時を変える（指定した項目だけ）。検証と権限の確認はしない
 * （validateEventInfo・checkUpdatePermission で行う）。
 */
export function updateEvent(doc: DefinitionDoc, patch: EventPatch): EditResult {
  throw new Error("未実装");
}

/**
 * イベントの情報を検証し、エラーの一覧を返す（問題がなければ空の配列）。
 * - イベント名：空（空白だけを含む）→ required（新規・更新とも）
 * - 開始日時：空 → required、形式違い → invalid_format（新規・更新とも）
 * - 終了日時（任意。null・空文字は未定として扱い、エラーにしない）。1 つの欄に出すエラーは 1 件まで、優先順は次のとおり
 *   1. 形式違い → invalid_format
 *   2. 開始日時以前（同じ時刻を含む）→ end_before_start「終了日時は開始日時より後にしてください」
 *      （開始日時が空・形式違いのときは比べない）
 *   3. 更新のときだけ、今以前（同じ時刻を含む）→ end_in_past
 *      「終了日時は今より後にしてください（過去の日時にすると、その場で更新できなくなるため）」
 * - required のメッセージは欄ごと（「イベント名を入力してください」など）。2 つまとめた文
 *  （「イベント名と開始日時を入力してください」）は画面で組み立てる
 */
export function validateEventInfo(input: EventInfoInput): EventInfoError[] {
  throw new Error("未実装");
}

/**
 * 最新のイベントが終了しているか。保存済みの終了日時（DB の値。編集中の値ではない）で判定する。
 * 終了日時が null（未定）なら false。終了日時が今以前（同じ時刻を含む）なら true。
 */
export function isEventEnded(savedEndAt: string | null, now: Date): boolean {
  throw new Error("未実装");
}
