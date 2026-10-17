// 共有の下書きの検証（要件 3.7「共有の下書き」「新規作成」、roadmap T3-6）
//
// 共有の下書きは、新規作成の直後などにイベント名・開始日時・版の日付が空のことがある。
// 公開用の検証（validatePublicDefinition）とは別に、下書きを保存するときに使う。
// - イベント名・開始日時・版の日付の空文字は通す（項目がない・文字列でないのは公開用と同じく誤り）
// - 開始日時が空のときは、終了日時の前後を比べない（終了日時の形式は確かめる）
// - それ以外（イベント ID、終了日時、海域・札・段階・特効グループの形、参照・重複・倍率など）は公開用と同じ規則・同じ code と path で弾く
// - 結果の形は公開用の検証と同じ（DefinitionValidationResult）
//
// 作り方：規則を二重に持たないよう、公開用の検証をそのまま使う。
// 1. 空の欄を、公開用の規則に合う仮の値に置き換える（空の欄がなければ、公開用の検証の結果をそのまま返す）
// 2. 開始日時が空で、終了日時が読める日時なら、終了日時も null に置き換える。公開用の検証で終了日時に残る確認は
//    開始日時との前後の比較だけなので、これで比較だけを省ける（読めない値・文字列でない値はそのまま渡し、公開用と同じエラーにする）
// 3. 置き換えた文書を公開用の検証にかける。置き換えた欄は公開用の規則に合うので、エラーは公開用のエラーから
//    空の欄のエラーを除いたものと同じ（並びも同じ）になる
// 4. 通ったら、置き換えた欄を元の値（空文字・終了日時）に戻して作り直し、凍結する（公開用の検証の値は凍結されているため）
import { deepFreeze } from "@/domain/definition/freeze";
import type { DefinitionValidationResult, EventInfo } from "@/domain/definition/types";
import { validatePublicDefinition } from "@/domain/definition/validate";
import { parseDateTime } from "./datetime";

/** JSON のオブジェクト（中身はまだ分からない） */
type JsonObject = Readonly<Record<string, unknown>>;

/** 下書きでだけ空文字を通す欄 */
type RelaxedField = "name" | "startAt" | "versionDate";

const RELAXED_FIELDS: readonly RelaxedField[] = ["name", "startAt", "versionDate"];

/** 空の欄の代わりに公開用の検証に渡す仮の値（公開用の規則に合う値。検証の後で空文字に戻すので、値に意味はない） */
const PLACEHOLDERS: Readonly<Record<RelaxedField, string>> = {
  name: "（下書き）",
  startAt: "2000-01-01T00:00+09:00",
  versionDate: "2000-01-01",
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 自分自身の項目だけを読む（公開用の検証と同じく、Object.prototype の項目を拾わない）。ない項目は undefined */
function readField(obj: JsonObject, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

/**
 * 共有の下書きを検証する。例外は投げず、結果で返す。
 * 通った値は、公開用の検証と同じく作り直して凍結した値で、空だったイベント名・開始日時・版の日付は空文字のまま
 * （そのままでは公開できない。公開の前に validatePublicDefinition で確かめる）
 */
export function validateDraftDefinition(input: unknown): DefinitionValidationResult {
  const event = isRecord(input) ? readField(input, "event") : undefined;
  // ルート・イベントがオブジェクトでなければ、公開用の検証と同じエラーにする
  if (!isRecord(input) || !isRecord(event)) return validatePublicDefinition(input);

  const emptyFields = RELAXED_FIELDS.filter((key) => readField(event, key) === "");
  if (emptyFields.length === 0) return validatePublicDefinition(input);
  const isEmpty = (key: RelaxedField): boolean => emptyFields.includes(key);

  // 1・2. 空の欄を仮の値に、開始日時が空なら読める終了日時を null に置き換える
  const checkedEvent: Record<string, unknown> = { ...event };
  for (const key of emptyFields) {
    checkedEvent[key] = PLACEHOLDERS[key];
  }
  const rawEndAt = readField(event, "endAt");
  const hiddenEndAt =
    isEmpty("startAt") && typeof rawEndAt === "string" && parseDateTime(rawEndAt) !== undefined ? rawEndAt : null;
  if (hiddenEndAt !== null) checkedEvent.endAt = null;

  // 3. 公開用の検証にかける
  const result = validatePublicDefinition({ ...input, event: checkedEvent });
  if (!result.ok) return result;

  // 4. 置き換えた欄を元に戻して作り直す
  const checked = result.value.event;
  const restored: EventInfo = {
    ...checked,
    name: isEmpty("name") ? "" : checked.name,
    startAt: isEmpty("startAt") ? "" : checked.startAt,
    versionDate: isEmpty("versionDate") ? "" : checked.versionDate,
    endAt: hiddenEndAt ?? checked.endAt,
  };
  return { ok: true, value: deepFreeze({ ...result.value, event: restored }) };
}
