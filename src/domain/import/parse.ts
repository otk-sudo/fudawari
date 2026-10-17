// 取り込みデータ（制空権シミュ形式）の解析。通信しない純粋な関数
//
// 形式の仕様は docs/research/import-and-master.md と要件 3.4（U8・U9）。
// 実装で決めたこと（仕様にない、壊れた入力への備え）
// - 個体 ID（svdata・api_ship の配列の api_id、新しい短縮形式の id）が読めない要素は、同じ個体と判定できないため飛ばす。
// - 同じ個体 ID の要素が複数あるときは、先の要素だけを取り込む（個体 ID が重ならないようにする）。
// - JSON 配列で、艦を表すオブジェクト（api_ship_id・id・ship_id のどれかを持つ）が 1 つもない配列（空の配列も含む）は
//   「想定外の形」（unexpectedShape）として失敗にする（関係のない JSON 配列を貼り付けたと分かるようにする）。
// - 形式としては読めたが、取り込む範囲で絞り込んだ後に 1 隻も残らないとき（svdata の api_ship が空の配列、
//   読める要素が 1 つもないときも含む）は「取り込む艦がない」（noShips）として失敗にする
//   （0 隻の取り込みを保存して、割り当てが知らせずに全部外れるのを防ぐ）。
// - 数の項目は、数か数字だけの文字列を受け付ける。Lv が欠けている・読めない艦は Lv 1 として扱う。
import type { ShipMaster } from "@/domain/master/types";
import type { OwnedShip, ShipUid } from "@/domain/ship/types";
import type { ImportFailure, ImportFailureReason, ImportFilter, ImportFormat, ImportParseResult } from "./types";

/** ゲームの API 応答の接頭辞 */
const SVDATA_PREFIX = "svdata=";

/** 近代化改修の配列（api_kyouka／st）のうち、運の位置（火力・雷装・対空・装甲・運・耐久・対潜） */
const KYOUKA_LUCK_INDEX = 4;

/** 古い短縮形式で振る個体 ID の接頭辞（取り込みデータの個体 ID は数字だけなので重ならない） */
const LEGACY_UID_PREFIX = "legacy-";

/** 要素から読み取った 1 隻（絞り込みの前） */
interface ParsedShip {
  ship: OwnedShip;
  /** ロック済みか（ロックの情報がない形式では false） */
  locked: boolean;
}

/** 値がオブジェクト（null・配列を除く）か */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(reason: ImportFailureReason): ImportFailure {
  return { ok: false, reason };
}

/** JSON として読む。読めなければ undefined（JSON の null は null として返る） */
function parseJson(text: string): { value: unknown } | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return { value };
  } catch {
    return undefined;
  }
}

/** 数、または数として読める文字列なら、その数。ほかは null */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 正の整数（艦の ID・個体 ID）なら、その数。0・欠けている・読めない値は null */
function toPositiveInteger(value: unknown): number | null {
  const n = toFiniteNumber(value);
  return n !== null && Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Lv。Lv 0（と負の値・欠けている・読めない値）は 1 として扱う */
function toLevel(value: unknown): number {
  const n = toFiniteNumber(value);
  return n === null ? 1 : Math.max(1, Math.floor(n));
}

/** 近代化改修の運（なければ 0） */
function toLuckUp(kyouka: unknown): number {
  if (!Array.isArray(kyouka)) return 0;
  return toFiniteNumber(kyouka[KYOUKA_LUCK_INDEX]) ?? 0;
}

/** 出撃札。値をそのまま持つ（解釈しない）。ない・偽の値・数でない値は 0 */
function toSallyArea(value: unknown): number {
  return toFiniteNumber(value) ?? 0;
}

/** 運の表示値＝マスタの運の初期値（マスタにない艦は 0）＋近代化改修の運 */
function luckOf(master: ShipMaster, shipId: number, luckUp: number): number {
  return (master.byId.get(shipId)?.luckBase ?? 0) + luckUp;
}

/** svdata 形式の 1 要素を読む（読めない・飛ばす要素は null） */
function readSvdataShip(value: unknown, master: ShipMaster): ParsedShip | null {
  if (!isRecord(value)) return null;
  const shipId = toPositiveInteger(value.api_ship_id);
  const uid = toPositiveInteger(value.api_id);
  if (shipId === null || uid === null) return null;
  return {
    ship: {
      uid: String(uid),
      shipId,
      level: toLevel(value.api_lv),
      luck: luckOf(master, shipId, toLuckUp(value.api_kyouka)),
      sallyArea: toSallyArea(value.api_sally_area),
    },
    locked: value.api_locked === 1 || value.api_locked === true,
  };
}

/** 新しい短縮形式の 1 要素を読む（読めない・飛ばす要素は null） */
function readCompactShip(value: unknown, master: ShipMaster): ParsedShip | null {
  if (!isRecord(value)) return null;
  const shipId = toPositiveInteger(value.ship_id);
  const uid = toPositiveInteger(value.id);
  if (shipId === null || uid === null) return null;
  return {
    ship: {
      uid: String(uid),
      shipId,
      level: toLevel(value.lv),
      luck: luckOf(master, shipId, toLuckUp(value.st)),
      sallyArea: toSallyArea(value.area),
    },
    locked: false,
  };
}

/** 古い短縮形式の 1 要素を読む（id が艦の ID。個体 ID は呼ぶ側が振る） */
function readLegacyShip(value: unknown, master: ShipMaster, uid: ShipUid): ParsedShip | null {
  if (!isRecord(value)) return null;
  const shipId = toPositiveInteger(value.id);
  if (shipId === null) return null;
  return {
    ship: {
      uid,
      shipId,
      level: toLevel(value.lv),
      luck: luckOf(master, shipId, toLuckUp(value.st)),
      sallyArea: toSallyArea(value.area),
    },
    locked: false,
  };
}

/** 個体 ID のある形式の要素を順に読み、読めない要素と、先に出た個体 ID の要素を飛ばす */
function readShipsWithUid(
  elements: readonly unknown[],
  read: (value: unknown) => ParsedShip | null,
): ParsedShip[] {
  const seen = new Set<ShipUid>();
  const result: ParsedShip[] = [];
  for (const element of elements) {
    const parsed = read(element);
    if (parsed === null || seen.has(parsed.ship.uid)) continue;
    seen.add(parsed.ship.uid);
    result.push(parsed);
  }
  return result;
}

/** 古い短縮形式の要素を順に読み、個体 ID を連番（入力の順に 1 から。飛ばした要素は数えない）で振る */
function readLegacyShips(elements: readonly unknown[], master: ShipMaster): ParsedShip[] {
  const result: ParsedShip[] = [];
  for (const element of elements) {
    const parsed = readLegacyShip(element, master, `${LEGACY_UID_PREFIX}${result.length + 1}`);
    if (parsed !== null) result.push(parsed);
  }
  return result;
}

/** 取り込む範囲で絞り込み、件数を数えて成功の結果にする（絞り込んだ後に 1 隻も残らなければ noShips で失敗） */
function toSuccess(
  format: ImportFormat,
  parsed: readonly ParsedShip[],
  master: ShipMaster,
  filter: ImportFilter,
  hasLockInfo: boolean = format === "svdata",
): ImportParseResult {
  const filterByLock = filter.lockedOnly && hasLockInfo;

  const ships: OwnedShip[] = [];
  let unknownShipCount = 0;
  let taggedShipCount = 0;
  for (const { ship, locked } of parsed) {
    if (ship.level < filter.minLevel) continue;
    if (filterByLock && !locked) continue;
    ships.push(ship);
    if (!master.byId.has(ship.shipId)) unknownShipCount += 1;
    if (ship.sallyArea !== 0) taggedShipCount += 1;
  }
  if (ships.length === 0) return failure("noShips");

  return {
    ok: true,
    format,
    ships,
    unknownShipCount,
    taggedShipCount,
    hasUid: format !== "compactLegacy",
    hasLockInfo,
    lockFilterIgnored: filter.lockedOnly && !hasLockInfo,
  };
}

/** `svdata=` の後ろ（API 応答の JSON）を解析する */
function parseSvdata(body: string, master: ShipMaster, filter: ImportFilter): ImportParseResult {
  const json = parseJson(body);
  if (json === undefined) return failure("invalidJson");
  const response = json.value;
  if (!isRecord(response) || !isRecord(response.api_data)) return failure("unexpectedShape");
  const apiShip = response.api_data.api_ship;
  if (!Array.isArray(apiShip)) return failure("unexpectedShape");

  const parsed = readShipsWithUid(apiShip, (value) => readSvdataShip(value, master));
  return toSuccess("svdata", parsed, master, filter);
}

/**
 * JSON 配列を解析する。
 * - api_ship_id を持つ要素が 1 つでもあれば、api_ship の配列（svdata 形式の要素を並べたもの）として読む
 * - ship_id を持つ要素が 1 つでもあれば新しい短縮形式、なければ古い短縮形式
 */
function parseCompact(elements: readonly unknown[], master: ShipMaster, filter: ImportFilter): ImportParseResult {
  const records = elements.filter(isRecord);
  if (records.some((r) => Object.hasOwn(r, "api_ship_id"))) {
    const parsed = readShipsWithUid(elements, (value) => readSvdataShip(value, master));
    // ロックの情報は、読めた艦のすべてに api_locked があるときだけ使う（一部だけなら、分からない艦を「ロックなし」として外さない）
    const accepted = records.filter((r) => readSvdataShip(r, master) !== null);
    const hasLockInfo = accepted.length > 0 && accepted.every((r) => Object.hasOwn(r, "api_locked"));
    return toSuccess("apiShipArray", parsed, master, filter, hasLockInfo);
  }
  if (!records.some((r) => Object.hasOwn(r, "id") || Object.hasOwn(r, "ship_id"))) {
    return failure("unexpectedShape");
  }

  if (records.some((r) => Object.hasOwn(r, "ship_id"))) {
    const parsed = readShipsWithUid(elements, (value) => readCompactShip(value, master));
    return toSuccess("compact", parsed, master, filter);
  }
  return toSuccess("compactLegacy", readLegacyShips(elements, master), master, filter);
}

/**
 * 貼り付けられた文字列を解析し、取り込む艦の個体の一覧と件数を返す（要件 3.4、U8・U9）。
 * - `svdata=` で始まる文字列、api_ship の配列、短縮形式の JSON 配列（新しい形式・古い形式）を受け付ける
 * - 艦の ID が 0・欠けている要素、オブジェクトでない要素は飛ばす
 * - 空・壊れた JSON・想定外の形・取り込む艦が 0 隻でも例外を投げず、{ ok: false, reason } を返す
 */
export function parseImportText(text: string, master: ShipMaster, filter: ImportFilter): ImportParseResult {
  // 貼り付けたときに混ざる前後の空白・改行は無視する
  const trimmed = text.trim();
  if (trimmed === "") return failure("empty");
  if (trimmed.startsWith(SVDATA_PREFIX)) {
    return parseSvdata(trimmed.slice(SVDATA_PREFIX.length), master, filter);
  }

  const json = parseJson(trimmed);
  if (json === undefined) return failure("invalidJson");
  if (!Array.isArray(json.value)) return failure("unexpectedShape");
  return parseCompact(json.value, master, filter);
}
