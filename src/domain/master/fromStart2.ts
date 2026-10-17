// start2.json（Tibowl/api_start2）から、自前の形式の艦船マスタの行を作る（roadmap T1-5、U1）。純粋な関数
//
// ビルド時の生成（src/lib/ship-master/generateShipMaster.ts）から使う。取得・書き出しはここでは行わない。
import type { BoostNationality, Nationality } from "@/domain/nationality";
import { deriveRemodelInfo } from "./remodel";
import type { ApiMstShipLike, ShipMasterEntry } from "./types";

/** start2.json のうち、マスタの生成に使う部分 */
export interface Start2Like {
  api_mst_ship: readonly ApiMstShipLike[];
}

/** 味方艦の艦 ID の上限（この値未満が味方艦。1500 以上は深海棲艦） */
export const FRIENDLY_SHIP_ID_LIMIT = 1500;

/** 艦型の名前を補うときに、艦名の後ろに付ける文字 */
const CLASS_NAME_SUFFIX = "型";

/** 国籍の対応表にない艦型の艦の国籍 */
const UNKNOWN_NATIONALITY: Nationality = "unknown";

/** 値がオブジェクト（null・配列を除く）か */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 有限の数か */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 有限の数なら、その数。ほかは undefined */
function finiteNumberOrUndefined(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

/**
 * 配列の先頭から、有限の数が続く分だけを写す（最初の数でない要素の位置で止める）。
 * 数でない要素を飛ばして詰めると、[null, 69] の最大値 69 が運の初期値の位置に来てしまうため、位置をずらさない
 */
function leadingFiniteNumbers(values: readonly unknown[]): number[] {
  const result: number[] = [];
  for (const value of values) {
    if (!isFiniteNumber(value)) break;
    result.push(value);
  }
  return result;
}

/** api_mst_ship の 1 行を、使う項目だけの ApiMstShipLike にする。艦 ID・艦名が読めない行は null */
function readMstShipRow(value: unknown): ApiMstShipLike | null {
  if (!isRecord(value)) return null;
  const id = value.api_id;
  const name = value.api_name;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || typeof name !== "string") return null;

  const row: ApiMstShipLike = { api_id: id, api_name: name };
  if (typeof value.api_yomi === "string") row.api_yomi = value.api_yomi;
  const stype = finiteNumberOrUndefined(value.api_stype);
  if (stype !== undefined) row.api_stype = stype;
  const ctype = finiteNumberOrUndefined(value.api_ctype);
  if (ctype !== undefined) row.api_ctype = ctype;
  const sortno = finiteNumberOrUndefined(value.api_sortno);
  if (sortno !== undefined) row.api_sortno = sortno;
  if (Array.isArray(value.api_luck)) row.api_luck = leadingFiniteNumbers(value.api_luck);
  // 実物では文字列。数で入っていても改造先として読めるよう文字列にそろえる
  const after = value.api_aftershipid;
  if (typeof after === "string") row.api_aftershipid = after;
  else if (typeof after === "number" && Number.isSafeInteger(after)) row.api_aftershipid = String(after);
  return row;
}

/**
 * JSON として読んだ start2.json（中身は分からない値）から、マスタの生成に使う部分を取り出す。
 * - api_mst_ship が配列でなければ null
 * - 艦 ID（正の整数）・艦名（文字列）が読めない行は飛ばす。ほかの項目は型が合うものだけを写す
 * - api_luck は先頭から数が続く分だけを写す（0 番目が数でなければ空の配列。最大値を運の初期値の位置に詰めない）
 */
export function readStart2(data: unknown): Start2Like | null {
  if (!isRecord(data) || !Array.isArray(data.api_mst_ship)) return null;
  const rows: ApiMstShipLike[] = [];
  for (const value of data.api_mst_ship) {
    const row = readMstShipRow(value);
    if (row !== null) rows.push(row);
  }
  return { api_mst_ship: rows };
}

/** 味方艦の行で、数でなければならない項目（api_luck は 0 番目〔運の初期値〕が数でなければならない） */
export type InvalidFriendlyRowField = "api_sortno" | "api_stype" | "api_ctype" | "api_luck";

/** マスタに必要な項目が数でない味方艦の行 */
export interface InvalidFriendlyRow {
  /** 艦 ID（api_id） */
  id: number;
  /** 数でなかった項目（api_sortno・api_stype・api_ctype・api_luck の順） */
  fields: InvalidFriendlyRowField[];
}

/**
 * 味方艦（api_id < 1500）の行のうち、api_sortno・api_stype・api_ctype が数でない、または api_luck の 0 番目が数でない行を返す。
 * 生成（generateShipMaster）は、1 行でもあれば 0 で埋めずに失敗する（壊れたマスタを配らない）。深海棲艦の行は見ない
 */
export function findInvalidFriendlyRows(start2: Start2Like): InvalidFriendlyRow[] {
  const result: InvalidFriendlyRow[] = [];
  for (const row of start2.api_mst_ship) {
    if (row.api_id >= FRIENDLY_SHIP_ID_LIMIT) continue;
    const fields: InvalidFriendlyRowField[] = [];
    if (!isFiniteNumber(row.api_sortno)) fields.push("api_sortno");
    if (!isFiniteNumber(row.api_stype)) fields.push("api_stype");
    if (!isFiniteNumber(row.api_ctype)) fields.push("api_ctype");
    if (!isFiniteNumber(row.api_luck?.[0])) fields.push("api_luck");
    if (fields.length > 0) result.push({ id: row.api_id, fields });
  }
  return result;
}

/** 図鑑番号の比べやすい値。図鑑番号がない・0 以下の艦は後回しにする（未実装の艦の行などを艦型の名前に使わない） */
function sortNoKey(row: ApiMstShipLike): number {
  const sortno = row.api_sortno;
  return sortno !== undefined && sortno > 0 ? sortno : Number.POSITIVE_INFINITY;
}

/**
 * 艦型ごとに、名前を補うときに使う艦（図鑑番号が最も小さい艦。同じなら艦 ID の小さい艦）を選ぶ
 */
function representativeByClass(rows: readonly ApiMstShipLike[]): Map<number, ApiMstShipLike> {
  const result = new Map<number, ApiMstShipLike>();
  for (const row of rows) {
    const classId = row.api_ctype ?? 0;
    const current = result.get(classId);
    if (
      current === undefined ||
      sortNoKey(row) < sortNoKey(current) ||
      (sortNoKey(row) === sortNoKey(current) && row.api_id < current.api_id)
    ) {
      result.set(classId, row);
    }
  }
  return result;
}

/**
 * start2.json の api_mst_ship から、味方艦（api_id < 1500）だけの ShipMasterEntry の配列を作る。
 * - 項目は ShipMasterEntry のものだけ（ゲームの画像やほかの項目は入れない）
 * - 改装段階を問わない艦名・改造状態は改造の連鎖（deriveRemodelInfo）から求める。コンバート改装の輪の艦はすべて最終改造
 * - 艦型の名前は classNames（艦型の番号 → 名前）を優先する。対応表にない艦型は
 *   「その艦型で図鑑番号が最も小さい艦の、改装段階を問わない艦名＋型」で補う
 * - 国籍は classNationalities（艦型の番号 → 国籍）から入れる。対応表にない艦型（省略時はすべての艦型）は "unknown"
 * - 結果は艦 ID の昇順（入力の順に左右されない）
 * - 同じ艦 ID の行が複数あるときは先の行を使う（deriveRemodelInfo と同じ）
 * - 項目が欠けている行は、文字は空、数は 0 で埋める
 *   （生成〔generateShipMaster〕は、数の項目が欠けた味方艦の行を findInvalidFriendlyRows で見つけて、埋める前に止める）
 */
export function buildShipMasterEntries(
  start2: Start2Like,
  classNames: ReadonlyMap<number, string>,
  classNationalities: ReadonlyMap<number, BoostNationality> = new Map(),
): ShipMasterEntry[] {
  // 味方艦だけ（同じ艦 ID は先の行）
  const friendly = new Map<number, ApiMstShipLike>();
  for (const row of start2.api_mst_ship) {
    if (row.api_id < FRIENDLY_SHIP_ID_LIMIT && !friendly.has(row.api_id)) {
      friendly.set(row.api_id, row);
    }
  }
  const rows = [...friendly.values()].sort((a, b) => a.api_id - b.api_id);

  const remodel = deriveRemodelInfo(rows);
  const baseNameOf = (row: ApiMstShipLike): string => remodel.get(row.api_id)?.baseName ?? row.api_name;

  // 艦型の番号 → 艦型の名前（対応表を優先し、ない艦型は補う）
  const classNameById = new Map<number, string>();
  for (const [classId, representative] of representativeByClass(rows)) {
    classNameById.set(classId, classNames.get(classId) ?? `${baseNameOf(representative)}${CLASS_NAME_SUFFIX}`);
  }

  return rows.map((row): ShipMasterEntry => {
    const shipClassId = row.api_ctype ?? 0;
    return {
      id: row.api_id,
      name: row.api_name,
      yomi: row.api_yomi ?? "",
      baseName: baseNameOf(row),
      shipTypeId: row.api_stype ?? 0,
      shipClassId,
      shipClassName: classNameById.get(shipClassId) ?? "",
      nationality: classNationalities.get(shipClassId) ?? UNKNOWN_NATIONALITY,
      remodelStage: remodel.get(row.api_id)?.remodelStage ?? "unremodeled",
      sortNo: row.api_sortno ?? 0,
      luckBase: row.api_luck?.[0] ?? 0,
    };
  });
}
