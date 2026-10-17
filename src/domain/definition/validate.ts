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
//   nationalities は省略可の配列（v1.1。配列でなければ invalid_type）。要素は BOOST_NATIONALITIES のどれか
//   （文字列以外は invalid_type、選べない値〔"unknown" を含む〕は invalid_value）で、グループの中で重複しない
//   （duplicate_value は 2 つ目以降の場所）。検証後の値は、省略・空の配列なら nationalities の項目を持たず、あれば入力の順のまま
// - 知らない項目は無視してよい（誤りにしない）
// - 見つかった誤りはまとめて返す（最初の 1 件で止めない）
//
// 実装の約束
// - 各要素を読む関数は、誤りを見つけたら必ず errors に記録してから undefined を返す。
//   そのため「どこかが undefined なら errors は 1 件以上」が成り立つ。
// - 日付・日時の実在の確認は、年月日・時分秒を数として自前で確かめる（Date の繰り上げに頼らない）。
// - 海域・札の配列そのものが壊れているときは、段階からの参照の確認（unknown_reference）を省く（誤りが連鎖して増えるのを防ぐ）。
// - 検証を通った値は、入力から読み取った値で作り直したもの（入力のオブジェクト・配列を使い回さない）で、
//   返す前に深く凍結する（特効の計算が定義のオブジェクトごとに索引を覚えるため）。入力の値は凍結せず、書き換えもしない。
import { type BoostNationality, isBoostNationality } from "@/domain/nationality";
import { deepFreeze } from "./freeze";
import { isImportance } from "./importance";
import type {
  Area,
  BoostGroup,
  DefinitionError,
  DefinitionErrorCode,
  DefinitionValidationResult,
  EventInfo,
  Fuda,
  Importance,
  PublicDefinition,
  Stage,
} from "./types";

/** JSON のオブジェクト（中身はまだ分からない） */
type JsonObject = Readonly<Record<string, unknown>>;

/** 見つかった誤りを集める入れ物 */
type Errors = DefinitionError[];

/** 段階を読むときに使う、ID の重複の確認と参照先の一覧 */
interface StageContext {
  /** 読んだ段階の ID（重複の確認） */
  readonly stageIds: Set<string>;
  /** 読んだ特効グループの ID（定義全体での重複の確認） */
  readonly groupIds: Set<string>;
  /** 存在する海域の ID。海域の配列が壊れていれば null（参照の確認を省く） */
  readonly areaIds: ReadonlySet<string> | null;
  /** 存在する札の ID。札の配列が壊れていれば null（参照の確認を省く） */
  readonly fudaIds: ReadonlySet<string> | null;
}

const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** 年・月・日・時・分・秒（任意）・時差（"Z" か ±HH:MM）。小数の秒は認めない */
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

// ---- 場所（path）と誤りの記録 ----

function fieldPath(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`;
}

function itemPath(parent: string, index: number): string {
  return `${parent}[${index}]`;
}

function report(errors: Errors, code: DefinitionErrorCode, path: string, reason: string): void {
  const place = path === "" ? "定義全体" : path;
  errors.push({ code, path, message: `${place}：${reason}` });
}

// ---- 値の読み取りの部品 ----

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 自分自身の項目だけを読む（Object.prototype の項目を拾わない）。ない項目は undefined */
function readField(obj: JsonObject, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

/** 必須の文字列。allowEmpty が false なら空の文字列を invalid_value にする */
function readRequiredString(
  errors: Errors,
  obj: JsonObject,
  parent: string,
  key: string,
  allowEmpty: boolean,
): string | undefined {
  const path = fieldPath(parent, key);
  const value = readField(obj, key);
  if (value === undefined) {
    report(errors, "missing_field", path, "必須の項目がありません");
    return undefined;
  }
  if (typeof value !== "string") {
    report(errors, "invalid_type", path, "文字列にしてください");
    return undefined;
  }
  if (!allowEmpty && value === "") {
    report(errors, "invalid_value", path, "空にはできません");
    return undefined;
  }
  return value;
}

/** 必須の配列。要素の中身はまだ確かめない */
function readRequiredArray(
  errors: Errors,
  obj: JsonObject,
  parent: string,
  key: string,
): readonly unknown[] | undefined {
  const path = fieldPath(parent, key);
  const value = readField(obj, key);
  if (value === undefined) {
    report(errors, "missing_field", path, "必須の項目がありません");
    return undefined;
  }
  if (!Array.isArray(value)) {
    report(errors, "invalid_type", path, "配列（[ … ]）にしてください");
    return undefined;
  }
  return value;
}

/**
 * 配列の要素をすべて読む（途中で止めない）。1 つでも読めなければ undefined。
 * 穴のある配列も、穴を undefined の要素として読む（Array.from は穴を飛ばさない）
 */
function readItems<T>(
  raw: readonly unknown[],
  parent: string,
  readItem: (value: unknown, path: string) => T | undefined,
): T[] | undefined {
  const items = Array.from(raw, (value, index) => readItem(value, itemPath(parent, index)));
  const valid = items.filter((item): item is T => item !== undefined);
  return valid.length === items.length ? valid : undefined;
}

/** 要素がオブジェクトであることを確かめる */
function requireRecord(errors: Errors, value: unknown, path: string): JsonObject | undefined {
  if (!isRecord(value)) {
    report(errors, "invalid_type", path, "オブジェクト（{ … }）にしてください");
    return undefined;
  }
  return value;
}

/** 必須の ID（空でない文字列）を読み、同じ種類の中で重複していないか確かめる */
function readUniqueId(
  errors: Errors,
  obj: JsonObject,
  parent: string,
  seen: Set<string>,
  kind: string,
): string | undefined {
  const id = readRequiredString(errors, obj, parent, "id", false);
  if (id === undefined) return undefined;
  if (seen.has(id)) {
    report(errors, "duplicate_id", fieldPath(parent, "id"), `${kind}の ID「${id}」が重複しています`);
    return undefined;
  }
  seen.add(id);
  return id;
}

// ---- 日付・日時 ----

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isRealDate(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** 1970-01-01 からの日数（先発グレゴリオ暦。H. Hinnant の days_from_civil）。Date を使わずに日時を比べるため */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const monthFromMarch = (month + 9) % 12;
  const dayOfYear = Math.floor((153 * monthFromMarch + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** "YYYY-MM-DD" の実在する日付か */
function isValidDateText(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (match === null) return false;
  return isRealDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/**
 * ISO 8601 の時差つきの日時を、比べるための通算の秒（UTC）にする。
 * 形式が違う、または実在しない日時（2026-02-30、25 時など）は undefined
 */
function toEpochSeconds(text: string): number | undefined {
  const match = DATE_TIME_PATTERN.exec(text);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  const offsetSign = match[7] === "-" ? -1 : 1;
  const offsetHour = Number(match[8] ?? "0");
  const offsetMinute = Number(match[9] ?? "0");
  if (!isRealDate(year, month, day)) return undefined;
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return undefined;
  const localSeconds = daysFromCivil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second;
  return localSeconds - offsetSign * (offsetHour * 3600 + offsetMinute * 60);
}

const DATE_TIME_HINT = "ISO 8601 の時差つきの日時（例 2026-08-07T12:00:00+09:00）にしてください";

// ---- 各部分の検証 ----

function readSchemaVersion(errors: Errors, root: JsonObject): 1 | undefined {
  const path = "schemaVersion";
  const value = readField(root, path);
  if (value === undefined) {
    report(errors, "missing_field", path, "必須の項目がありません");
    return undefined;
  }
  if (typeof value !== "number") {
    report(errors, "invalid_type", path, "数にしてください");
    return undefined;
  }
  if (value !== 1) {
    report(errors, "unsupported_version", path, `対応していない形式の版（${value}）です。対応している版は 1 です`);
    return undefined;
  }
  return value;
}

function readEvent(errors: Errors, root: JsonObject): EventInfo | undefined {
  const path = "event";
  const raw = readField(root, path);
  if (raw === undefined) {
    report(errors, "missing_field", path, "必須の項目がありません");
    return undefined;
  }
  const event = requireRecord(errors, raw, path);
  if (event === undefined) return undefined;

  const id = readRequiredString(errors, event, path, "id", false);
  const name = readRequiredString(errors, event, path, "name", false);

  // 開始日時（必須）
  let startAt: string | undefined;
  let startSeconds: number | undefined;
  const startText = readRequiredString(errors, event, path, "startAt", true);
  if (startText !== undefined) {
    startSeconds = toEpochSeconds(startText);
    if (startSeconds === undefined) {
      report(errors, "invalid_value", fieldPath(path, "startAt"), DATE_TIME_HINT);
    } else {
      startAt = startText;
    }
  }

  // 終了日時（任意。省略は null）
  let endAt: string | null | undefined;
  const endPath = fieldPath(path, "endAt");
  const endRaw = readField(event, "endAt");
  if (endRaw === undefined || endRaw === null) {
    endAt = null;
  } else if (typeof endRaw !== "string") {
    report(errors, "invalid_type", endPath, "null か日時の文字列にしてください");
  } else {
    const endSeconds = toEpochSeconds(endRaw);
    if (endSeconds === undefined) {
      report(errors, "invalid_value", endPath, DATE_TIME_HINT);
    } else if (startSeconds !== undefined && endSeconds <= startSeconds) {
      report(errors, "invalid_value", endPath, "開始日時より後にしてください");
    } else {
      endAt = endRaw;
    }
  }

  // 版の日付（必須）
  let versionDate: string | undefined;
  const versionText = readRequiredString(errors, event, path, "versionDate", true);
  if (versionText !== undefined) {
    if (isValidDateText(versionText)) {
      versionDate = versionText;
    } else {
      report(
        errors,
        "invalid_value",
        fieldPath(path, "versionDate"),
        "実在する日付の YYYY-MM-DD（例 2026-08-04）にしてください",
      );
    }
  }

  if (
    id === undefined ||
    name === undefined ||
    startAt === undefined ||
    endAt === undefined ||
    versionDate === undefined
  ) {
    return undefined;
  }
  return { id, name, startAt, endAt, versionDate };
}

function readArea(errors: Errors, value: unknown, path: string, seenIds: Set<string>): Area | undefined {
  const area = requireRecord(errors, value, path);
  if (area === undefined) return undefined;
  const id = readUniqueId(errors, area, path, seenIds, "海域");
  const name = readRequiredString(errors, area, path, "name", false);
  if (id === undefined || name === undefined) return undefined;
  return { id, name };
}

/** ゲーム内の札番号。省略・null は null。誤りは undefined */
function readGameNumber(
  errors: Errors,
  fuda: JsonObject,
  parent: string,
  seenNumbers: Set<number>,
): number | null | undefined {
  const path = fieldPath(parent, "gameNumber");
  const value = readField(fuda, "gameNumber");
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    report(errors, "invalid_type", path, "null か数にしてください");
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1) {
    report(errors, "invalid_value", path, "1 以上の整数にしてください");
    return undefined;
  }
  if (seenNumbers.has(value)) {
    report(errors, "duplicate_value", path, `ゲーム内の札番号 ${value} がほかの札と重複しています`);
    return undefined;
  }
  seenNumbers.add(value);
  return value;
}

function readFuda(
  errors: Errors,
  value: unknown,
  path: string,
  seenIds: Set<string>,
  seenNumbers: Set<number>,
): Fuda | undefined {
  const fuda = requireRecord(errors, value, path);
  if (fuda === undefined) return undefined;
  const id = readUniqueId(errors, fuda, path, seenIds, "札");
  const name = readRequiredString(errors, fuda, path, "name", false);

  let color: string | undefined;
  const colorText = readRequiredString(errors, fuda, path, "color", true);
  if (colorText !== undefined) {
    if (COLOR_PATTERN.test(colorText)) {
      color = colorText;
    } else {
      report(errors, "invalid_value", fieldPath(path, "color"), "#RRGGBB の形（例 #4C8DF6）にしてください");
    }
  }

  const gameNumber = readGameNumber(errors, fuda, path, seenNumbers);
  if (id === undefined || name === undefined || color === undefined || gameNumber === undefined) {
    return undefined;
  }
  return { id, name, color, gameNumber };
}

/** 海域・札への参照。参照先の一覧が null（配列が壊れている）なら存在の確認を省く */
function readReference(
  errors: Errors,
  obj: JsonObject,
  parent: string,
  key: string,
  known: ReadonlySet<string> | null,
  kind: string,
): string | undefined {
  const value = readRequiredString(errors, obj, parent, key, true);
  if (value === undefined) return undefined;
  if (known !== null && !known.has(value)) {
    report(errors, "unknown_reference", fieldPath(parent, key), `存在しない${kind}「${value}」を参照しています`);
    return undefined;
  }
  return value;
}

function readImportance(errors: Errors, stage: JsonObject, parent: string): Importance | undefined {
  const path = fieldPath(parent, "importance");
  const value = readField(stage, "importance");
  if (value === undefined) {
    report(errors, "missing_field", path, "必須の項目がありません");
    return undefined;
  }
  if (typeof value !== "string") {
    report(errors, "invalid_type", path, "文字列（normal／important／hard）にしてください");
    return undefined;
  }
  if (!isImportance(value)) {
    report(errors, "invalid_value", path, "normal（普通）／important（重要）／hard（難所）のどれかにしてください");
    return undefined;
  }
  return value;
}

function readMultiplier(errors: Errors, group: JsonObject, parent: string): number | undefined {
  const path = fieldPath(parent, "multiplier");
  const value = readField(group, "multiplier");
  if (value === undefined) {
    report(errors, "missing_field", path, "必須の項目がありません");
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    report(errors, "invalid_type", path, "有限の数にしてください");
    return undefined;
  }
  if (value < 1) {
    report(errors, "invalid_value", path, "1 以上にしてください");
    return undefined;
  }
  return value;
}

function readShipName(errors: Errors, value: unknown, path: string): string | undefined {
  if (typeof value !== "string") {
    report(errors, "invalid_type", path, "艦名は文字列にしてください");
    return undefined;
  }
  if (value === "") {
    report(errors, "invalid_value", path, "艦名は空にはできません");
    return undefined;
  }
  return value;
}

/** 国籍の要素を 1 つ読む。選べる国籍（BOOST_NATIONALITIES のどれか）だけを通す */
function readNationality(errors: Errors, value: unknown, path: string): BoostNationality | undefined {
  if (typeof value !== "string") {
    report(errors, "invalid_type", path, "国籍は文字列にしてください");
    return undefined;
  }
  if (!isBoostNationality(value)) {
    report(errors, "invalid_value", path, "国籍は japan・usa・uk などの選べる国籍にしてください（unknown は選べません）");
    return undefined;
  }
  return value;
}

/**
 * 特効グループの国籍（省略可。v1.1）を読む。省略なら空の配列。
 * 同じグループの中で同じ国籍が 2 回以上あれば、2 つ目以降の場所を duplicate_value にする（読めなかった要素は重複の確認に入れない）
 */
function readNationalities(errors: Errors, group: JsonObject, parent: string): BoostNationality[] | undefined {
  const path = fieldPath(parent, "nationalities");
  const value = readField(group, "nationalities");
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    report(errors, "invalid_type", path, "配列（[ … ]）にしてください");
    return undefined;
  }
  const seen = new Set<BoostNationality>();
  return readItems(value, path, (item, childPath) => {
    const nationality = readNationality(errors, item, childPath);
    if (nationality === undefined) return undefined;
    if (seen.has(nationality)) {
      report(errors, "duplicate_value", childPath, `国籍「${nationality}」が重複しています`);
      return undefined;
    }
    seen.add(nationality);
    return nationality;
  });
}

function readBoostGroup(
  errors: Errors,
  value: unknown,
  path: string,
  seenIds: Set<string>,
): BoostGroup | undefined {
  const group = requireRecord(errors, value, path);
  if (group === undefined) return undefined;
  const id = readUniqueId(errors, group, path, seenIds, "特効グループ");
  const name = readRequiredString(errors, group, path, "name", true);
  const multiplier = readMultiplier(errors, group, path);

  let shipNames: string[] | undefined;
  const rawNames = readRequiredArray(errors, group, path, "shipNames");
  if (rawNames !== undefined) {
    const namesPath = fieldPath(path, "shipNames");
    shipNames = readItems(rawNames, namesPath, (item, childPath) => readShipName(errors, item, childPath));
  }
  const nationalities = readNationalities(errors, group, path);

  if (
    id === undefined ||
    name === undefined ||
    multiplier === undefined ||
    shipNames === undefined ||
    nationalities === undefined
  ) {
    return undefined;
  }
  // 国籍がなければ項目ごと持たない（v1 の定義と同じ形のまま）
  return nationalities.length > 0
    ? { id, name, multiplier, shipNames, nationalities }
    : { id, name, multiplier, shipNames };
}

function readStage(errors: Errors, value: unknown, path: string, context: StageContext): Stage | undefined {
  const stage = requireRecord(errors, value, path);
  if (stage === undefined) return undefined;
  const id = readUniqueId(errors, stage, path, context.stageIds, "段階");
  const areaId = readReference(errors, stage, path, "areaId", context.areaIds, "海域");
  const name = readRequiredString(errors, stage, path, "name", false);
  const fudaId = readReference(errors, stage, path, "fudaId", context.fudaIds, "札");
  const importance = readImportance(errors, stage, path);

  let boosts: BoostGroup[] | undefined;
  const rawBoosts = readRequiredArray(errors, stage, path, "boosts");
  if (rawBoosts !== undefined) {
    boosts = readItems(rawBoosts, fieldPath(path, "boosts"), (item, childPath) =>
      readBoostGroup(errors, item, childPath, context.groupIds),
    );
  }

  if (
    id === undefined ||
    areaId === undefined ||
    name === undefined ||
    fudaId === undefined ||
    importance === undefined ||
    boosts === undefined
  ) {
    return undefined;
  }
  return { id, areaId, name, fudaId, importance, boosts };
}

// ---- 入口 ----

/**
 * JSON として読み込み済みの値を検証し、型付きの公開定義にする。
 * - 正しければ { ok: true, value }（value はゲーム内の札番号・終了日時の省略を null にそろえて作り直し、
 *   入れ子まで凍結した値。入力の値は凍結しない）
 * - 不正なら { ok: false, errors }（見つかった問題をまとめて返す。1 件以上）
 */
export function validatePublicDefinition(input: unknown): DefinitionValidationResult {
  const errors: Errors = [];
  if (!isRecord(input)) {
    report(errors, "invalid_type", "", "オブジェクト（{ … }）にしてください");
    return { ok: false, errors };
  }

  const schemaVersion = readSchemaVersion(errors, input);
  const event = readEvent(errors, input);

  // 海域・札（段階から参照するため先に読む）
  const areaIds = new Set<string>();
  const rawAreas = readRequiredArray(errors, input, "", "areas");
  const areas =
    rawAreas === undefined
      ? undefined
      : readItems(rawAreas, "areas", (item, path) => readArea(errors, item, path, areaIds));

  const fudaIds = new Set<string>();
  const gameNumbers = new Set<number>();
  const rawFudas = readRequiredArray(errors, input, "", "fudas");
  const fudas =
    rawFudas === undefined
      ? undefined
      : readItems(rawFudas, "fudas", (item, path) => readFuda(errors, item, path, fudaIds, gameNumbers));

  // 段階（特効グループを含む）
  const context: StageContext = {
    stageIds: new Set<string>(),
    groupIds: new Set<string>(),
    areaIds: rawAreas === undefined ? null : areaIds,
    fudaIds: rawFudas === undefined ? null : fudaIds,
  };
  const rawStages = readRequiredArray(errors, input, "", "stages");
  const stages =
    rawStages === undefined
      ? undefined
      : readItems(rawStages, "stages", (item, path) => readStage(errors, item, path, context));

  // 読めなかった部分があれば errors は 1 件以上ある（各関数の約束）
  if (
    errors.length > 0 ||
    schemaVersion === undefined ||
    event === undefined ||
    areas === undefined ||
    fudas === undefined ||
    stages === undefined
  ) {
    return { ok: false, errors };
  }
  const value: PublicDefinition = deepFreeze({ schemaVersion, event, areas, fudas, stages });
  return { ok: true, value };
}

/**
 * JSON の文字列を読み込んで検証する。JSON として読めなければ code "invalid_json"（path ""）のエラーを返す。
 * 読めた後の検証は validatePublicDefinition と同じ
 */
export function parsePublicDefinition(text: string): DefinitionValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const errors: Errors = [];
    report(errors, "invalid_json", "", "JSON として読めません");
    return { ok: false, errors };
  }
  return validatePublicDefinition(parsed);
}
