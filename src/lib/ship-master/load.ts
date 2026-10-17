// 艦船マスタの読み込み（roadmap T1-5・T2-1、U1、要件 5 章）
//
// - 一般の画面は、ビルド時に生成した静的ファイル（public/data/ship-master.json。generateShipMaster.ts の出力）だけを読む。
// - 取得した文字列の形（{ schemaVersion: 1, ships: ShipMasterEntry[] }）を確かめてから、createShipMaster（@/domain/master）で
//   艦 ID から引ける形にして返す。
// - 例外は投げず、結果（ShipMasterLoadResult）で返す。取得の失敗と形の誤りは kind で区別する（src/lib/definition/load.ts と同じ粒度）。
import { createShipMaster, type RemodelStage, type ShipMaster, type ShipMasterEntry } from "@/domain/master";
import { isNationality, type Nationality } from "@/domain/nationality";

/** 艦船マスタの置き場所（ファイルは public/data/ship-master.json。generateShipMaster.ts の SHIP_MASTER_OUTPUT_PATH と対応する） */
export const SHIP_MASTER_PATH = "/data/ship-master.json";

/**
 * 艦船マスタのファイルの形の誤りの種類
 * - "invalid_json"：JSON として読めない
 * - "unsupported_version"：形式の版（schemaVersion）が 1 でない（ない・数でないを含む）
 * - "invalid_shape"：形が違う（ルートがオブジェクトでない、ships が配列でない・空、項目が欠けた行・型の違う行がある）
 *   国籍（nationality。v1.1）は欠けていてもよい（unknown として読む）。あって国籍でない値は誤り
 */
export type ShipMasterInvalidReason = "invalid_json" | "unsupported_version" | "invalid_shape";

/** 読み込みの失敗の理由 */
export type ShipMasterLoadError =
  /**
   * 取得の失敗。status は HTTP の状態コード（404 など）。
   * 通信そのものに失敗した（fetch が失敗した・本文を最後まで受け取れなかった）ときは null。
   * message は画面に出す理由の文（日本語。状態コードがあれば含める）
   */
  | { kind: "fetch"; status: number | null; message: string }
  /**
   * 形の誤り。reason は誤りの種類。
   * path は誤りの場所：ルートは ""、それ以外は "schemaVersion"、"ships"、"ships[1].name" の形（最初に見つけた 1 か所）。
   * message は画面に出す理由の文（日本語）
   */
  | { kind: "invalid"; reason: ShipMasterInvalidReason; path: string; message: string };

/** 読み込みの結果。成功なら艦 ID から引ける索引（createShipMaster の戻り値）を返す */
export type ShipMasterLoadResult =
  | { ok: true; master: ShipMaster }
  | { ok: false; error: ShipMasterLoadError };

/**
 * 読める形式の版。生成（generateShipMaster.ts）の SHIP_MASTER_FILE_SCHEMA_VERSION と対応する
 * （生成の処理を画面のコードに含めないよう、値はここに置く）
 */
const SUPPORTED_SCHEMA_VERSION = 1;

// 型の値をすべて並べる（型に値が増えたら、ここが型の誤りになって気付ける）
const REMODEL_STAGES: Readonly<Record<RemodelStage, true>> = {
  unremodeled: true,
  intermediate: true,
  final: true,
};

/** 取得の失敗の結果を作る */
function fetchFailure(status: number | null, message: string): ShipMasterLoadResult {
  return { ok: false, error: { kind: "fetch", status, message } };
}

/** 形の誤りの理由の文 */
function invalidMessage(reason: ShipMasterInvalidReason, path: string): string {
  switch (reason) {
    case "invalid_json":
      return "艦船マスタのファイルを JSON として読めませんでした";
    case "unsupported_version":
      return `艦船マスタのファイルの形式の版（schemaVersion）に対応していません（読めるのは ${SUPPORTED_SCHEMA_VERSION}）`;
    case "invalid_shape":
      return `艦船マスタのファイルの形が違います（場所：${path === "" ? "ルート" : path}）`;
  }
}

/** 形の誤りの結果を作る */
function invalidFailure(reason: ShipMasterInvalidReason, path: string): ShipMasterLoadResult {
  return { ok: false, error: { kind: "invalid", reason, path, message: invalidMessage(reason, path) } };
}

/** 値がオブジェクト（null・配列を除く）か */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 値が有限の数か */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 値が改造状態のどれかか */
function isRemodelStage(value: unknown): value is RemodelStage {
  return typeof value === "string" && Object.hasOwn(REMODEL_STAGES, value);
}

/** 行の読み取りの結果。失敗なら誤りの場所（"ships[1]"、"ships[1].name" の形） */
type EntryReadResult = { ok: true; entry: ShipMasterEntry } | { ok: false; path: string };

/**
 * ships の 1 行を読む。項目は ShipMasterEntry のものだけを写す（ほかの項目は捨てる）。
 * 項目は ShipMasterEntry の並びの順に確かめ、最初に見つけた誤りの場所を返す
 */
function readEntry(value: unknown, path: string): EntryReadResult {
  if (!isRecord(value)) return { ok: false, path };
  const at = (field: keyof ShipMasterEntry): EntryReadResult => ({ ok: false, path: `${path}.${field}` });

  const { id, name, yomi, baseName, shipTypeId, shipClassId, shipClassName, nationality, remodelStage, sortNo, luckBase } =
    value;
  // 艦 ID は索引のキーなので整数に限る（生成は正の整数だけを書き出す）
  if (typeof id !== "number" || !Number.isSafeInteger(id)) return at("id");
  if (typeof name !== "string") return at("name");
  if (typeof yomi !== "string") return at("yomi");
  if (typeof baseName !== "string") return at("baseName");
  if (!isFiniteNumber(shipTypeId)) return at("shipTypeId");
  if (!isFiniteNumber(shipClassId)) return at("shipClassId");
  if (typeof shipClassName !== "string") return at("shipClassName");
  // 国籍は v1.1 で足した項目。ない行（それより前に生成したファイル）は unknown として読み、あって国籍でない値は誤り
  if (nationality !== undefined && !isNationality(nationality)) return at("nationality");
  const readNationality: Nationality = nationality ?? "unknown";
  if (!isRemodelStage(remodelStage)) return at("remodelStage");
  if (!isFiniteNumber(sortNo)) return at("sortNo");
  if (!isFiniteNumber(luckBase)) return at("luckBase");

  return {
    ok: true,
    entry: {
      id,
      name,
      yomi,
      baseName,
      shipTypeId,
      shipClassId,
      shipClassName,
      nationality: readNationality,
      remodelStage,
      sortNo,
      luckBase,
    },
  };
}

/** 取得した文字列を艦船マスタとして読む（形を確かめ、艦 ID から引ける索引にする） */
function parseShipMaster(text: string): ShipMasterLoadResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return invalidFailure("invalid_json", "");
  }

  if (!isRecord(data)) return invalidFailure("invalid_shape", "");
  if (data.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return invalidFailure("unsupported_version", "schemaVersion");
  // 生成は 0 隻のマスタを書き出さないため、空の配列は壊れたファイルとみなす
  if (!Array.isArray(data.ships) || data.ships.length === 0) return invalidFailure("invalid_shape", "ships");

  const entries: ShipMasterEntry[] = [];
  for (const [index, row] of data.ships.entries()) {
    const result = readEntry(row, `ships[${index}]`);
    if (!result.ok) return invalidFailure("invalid_shape", result.path);
    entries.push(result.entry);
  }
  return { ok: true, master: createShipMaster(entries) };
}

/**
 * 艦船マスタを静的ファイル（SHIP_MASTER_PATH）から取得し、形を確かめて返す。
 * 呼ぶたびに取得する（取得を 1 回にまとめるのは useShipMaster の役目）。例外は投げない。
 */
export async function loadShipMaster(): Promise<ShipMasterLoadResult> {
  let response: Response;
  try {
    response = await fetch(SHIP_MASTER_PATH);
  } catch {
    // ブラウザの fetch は、通信そのものの失敗（オフラインなど）で TypeError を投げる
    return fetchFailure(null, "艦船マスタのファイルを取得できませんでした（通信に失敗しました）");
  }

  if (!response.ok) {
    return fetchFailure(
      response.status,
      `艦船マスタのファイルを取得できませんでした（状態コード ${response.status}）`,
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    // 本文の受信の途中で通信が切れたときなど。状態コードは成功でも、通信の失敗として扱う
    return fetchFailure(null, "艦船マスタのファイルを最後まで受け取れませんでした（通信に失敗しました）");
  }

  return parseShipMaster(text);
}
