// ビルド時に艦船マスタを生成する処理（roadmap T1-5、U1）
//
// - start2.json（Tibowl/api_start2）を取得し、buildShipMasterEntries で必要な項目だけを抜き出して
//   public/data/ship-master.json に書き出す（生成物はコミットしない）。
// - 取得・書き出しは引数で受け取る（テストでは差し替える。scripts/ の生成スクリプトは
//   Node の fetch とファイルの書き込みを渡して呼ぶだけにする）。
// - 取得・解析に失敗したら、理由を入れた Error で失敗する（ファイルは書かない）。スクリプトはそれを表示してビルドを止める。
// - 取得の一時的な失敗（通信の失敗、5xx など）は、少し待って再試行する。
// - 壊れたマスタを配らないよう、味方艦の隻数の下限と、味方艦の行の数の項目（図鑑番号・艦種・艦型・運の初期値）を確かめる。
import { buildShipMasterEntries, findInvalidFriendlyRows, readStart2 } from "@/domain/master/fromStart2";
import { SHIP_CLASS_NAMES, SHIP_CLASS_NATIONALITIES } from "@/domain/master/shipClassNames";
import type { ShipMasterEntry } from "@/domain/master/types";
import type { BoostNationality } from "@/domain/nationality";

/** start2.json の取得元 */
export const START2_URL = "https://raw.githubusercontent.com/Tibowl/api_start2/master/start2.json";

/** 書き出し先（プロジェクトのルートからの相対パス） */
export const SHIP_MASTER_OUTPUT_PATH = "public/data/ship-master.json";

/**
 * 艦船マスタのファイルの形式の版。形を変えるときに上げる。
 * v1.1 の国籍（nationality）は項目を足すだけなので 1 のまま（読み込みは、国籍のない古い行を unknown として読む）
 */
export const SHIP_MASTER_FILE_SCHEMA_VERSION = 1;

/** 味方艦の隻数の下限の既定値（2026-10 の実データは 866 隻） */
const DEFAULT_MIN_SHIP_COUNT = 800;

/** 取得の再試行の回数の既定値（最初の 1 回とは別に数える） */
const DEFAULT_RETRIES = 3;

/** 再試行の前に待つ時間の既定値（ミリ秒） */
const DEFAULT_RETRY_DELAY_MS = 2000;

/** 書き出す艦船マスタのファイルの形 */
export interface ShipMasterFile {
  schemaVersion: typeof SHIP_MASTER_FILE_SCHEMA_VERSION;
  /** 味方艦の行（艦 ID の昇順） */
  ships: ShipMasterEntry[];
}

/** 取得の応答のうち、使う部分（Node・ブラウザの fetch の Response と同じ形） */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** 生成に必要な外部とのやり取り */
export interface GenerateShipMasterDeps {
  /** URL を取得する（Node の fetch をそのまま渡せる） */
  fetch: (url: string) => Promise<FetchResponseLike>;
  /** ファイルに書き出す（書き出し先のフォルダがなければ作るのは、渡す側の役目） */
  writeFile: (path: string, content: string) => Promise<void>;
  /** 艦型の名前の対応表。省略すると SHIP_CLASS_NAMES（src/domain/master/shipClassNames.ts） */
  classNames?: ReadonlyMap<number, string>;
  /** 艦型の国籍の対応表（v1.1）。省略すると SHIP_CLASS_NATIONALITIES（src/domain/master/shipClassNames.ts） */
  classNationalities?: ReadonlyMap<number, BoostNationality>;
  /** 書き出し先。省略すると SHIP_MASTER_OUTPUT_PATH */
  outputPath?: string;
  /**
   * 味方艦の隻数の下限（省略すると 800。2026-10 の実データは 866 隻）。
   * 下回れば壊れたマスタとみなし、理由を入れた Error で失敗して書き出さない。テストでは小さい値を渡す
   */
  minShipCount?: number;
  /**
   * 取得に失敗（例外、または ok でない応答）したときに再試行する回数（省略すると 3。最初の 1 回とは別に数える）。
   * すべて失敗したら、最後の失敗の理由で失敗する。
   * 再試行しても直らない HTTP の状態（408・429 を除く 4xx）と、JSON として読めない本文は再試行しない
   */
  retries?: number;
  /** 再試行の前に待つ時間（ミリ秒。省略すると 2000。テストでは 0） */
  retryDelayMs?: number;
}

/** 生成の結果（スクリプトが表示に使う） */
export interface GenerateShipMasterResult {
  /** 書き出したパス */
  outputPath: string;
  /** 書き出した艦の数 */
  shipCount: number;
}

/**
 * start2.json を取得して艦船マスタを生成し、書き出す。
 * 取得に失敗（通信の失敗・ok でない応答）したときは、retryDelayMs 待って retries 回まで再試行する。
 * ただし、再試行しても直らない HTTP の状態（408・429 を除く 4xx）はすぐに失敗にする。
 * 次のときは理由を入れた Error で失敗し、書き出さない：
 * 取得の失敗（再試行してもすべて失敗。理由は最後の失敗のもの）、JSON として読めない（再試行しない）、api_mst_ship がない、
 * 味方艦の行で図鑑番号・艦種・艦型・運の初期値が数でない（艦 ID をすべて入れる）、味方艦が 1 隻もない、
 * 味方艦が minShipCount 隻に満たない（隻数と下限を入れる）。
 * Error の文には、何の処理で失敗したかが分かるよう「start2.json」（取得元の URL でもよい）と、
 * 元の理由（通信の失敗の文、HTTP の状態の番号など）を入れる
 */
export async function generateShipMaster(deps: GenerateShipMasterDeps): Promise<GenerateShipMasterResult> {
  const outputPath = deps.outputPath ?? SHIP_MASTER_OUTPUT_PATH;
  const classNames = deps.classNames ?? SHIP_CLASS_NAMES;
  const classNationalities = deps.classNationalities ?? SHIP_CLASS_NATIONALITIES;
  const minShipCount = deps.minShipCount ?? DEFAULT_MIN_SHIP_COUNT;

  // 取得（一時的な失敗は再試行する）
  const body = await fetchStart2Body(deps.fetch, deps.retries ?? DEFAULT_RETRIES, deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);

  // 解析（JSON として読めないのは取得元の中身の問題なので、再試行しない）
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch (error) {
    throw new Error(`start2.json を JSON として読めませんでした：${messageOf(error)}`, { cause: error });
  }
  const start2 = readStart2(data);
  if (start2 === null) {
    throw new Error("start2.json に api_mst_ship（艦の一覧の配列）がありません");
  }

  // 味方艦の行の項目の確かめ（変換は欠けた項目を 0 で埋めるため、その前に止めて壊れたマスタを配らない）
  const invalidRows = findInvalidFriendlyRows(start2);
  if (invalidRows.length > 0) {
    const list = invalidRows.map((row) => `${row.id}（${row.fields.join("・")}）`).join("、");
    throw new Error(
      `start2.json の味方艦の ${invalidRows.length} 行で、図鑑番号・艦種・艦型・運の初期値のどれかが数ではありません` +
        `（艦 ID と項目：${list}）`,
    );
  }

  // 変換（味方艦が 1 隻もない・下限に満たなければ、壊れたマスタを配らないよう止める）
  const ships = buildShipMasterEntries(start2, classNames, classNationalities);
  if (ships.length === 0) {
    throw new Error("start2.json の api_mst_ship に味方艦が 1 隻もありません");
  }
  if (ships.length < minShipCount) {
    throw new Error(
      `start2.json の味方艦が ${ships.length} 隻しかありません（下限は ${minShipCount} 隻）。壊れたマスタを配らないよう止めました`,
    );
  }

  // 書き出し
  const file: ShipMasterFile = { schemaVersion: SHIP_MASTER_FILE_SCHEMA_VERSION, ships };
  await deps.writeFile(outputPath, JSON.stringify(file));
  return { outputPath, shipCount: ships.length };
}

/** 1 回の取得の結果 */
type FetchAttempt =
  | { ok: true; body: string }
  | {
      ok: false;
      /** 失敗の理由を入れた Error（すべて失敗したときに投げる） */
      error: Error;
      /** 再試行すれば直るかもしれない失敗か */
      retryable: boolean;
    };

/** start2.json を取得して本文を返す。失敗したら retryDelayMs 待って retries 回まで再試行し、すべて失敗なら最後の理由で失敗する */
async function fetchStart2Body(
  fetch: GenerateShipMasterDeps["fetch"],
  retries: number,
  retryDelayMs: number,
): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    const result = await fetchOnce(fetch);
    if (result.ok) return result.body;
    if (!result.retryable || attempt >= retries) throw result.error;
    await wait(retryDelayMs);
  }
}

/** start2.json を 1 回取得する（例外は投げず、結果として返す） */
async function fetchOnce(fetch: GenerateShipMasterDeps["fetch"]): Promise<FetchAttempt> {
  let response: FetchResponseLike;
  try {
    response = await fetch(START2_URL);
  } catch (error) {
    return { ok: false, error: fetchFailure(messageOf(error), error), retryable: true };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: fetchFailure(`HTTP の状態 ${response.status}`),
      retryable: !isPermanentHttpFailure(response.status),
    };
  }
  try {
    return { ok: true, body: await response.text() };
  } catch (error) {
    // 本文を受け取る途中で切れたなど。通信の失敗と同じく再試行する
    return { ok: false, error: fetchFailure(messageOf(error), error), retryable: true };
  }
}

/**
 * 再試行しても直らない HTTP の状態か（4xx。取得元の URL の誤りなど）。
 * 408（Request Timeout）・429（Too Many Requests）は一時的な失敗なので再試行する
 */
function isPermanentHttpFailure(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** ms ミリ秒待つ（0 以下なら待たない） */
function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 取得の失敗の Error（取得元と元の理由を入れる） */
function fetchFailure(reason: string, cause?: unknown): Error {
  return new Error(`start2.json の取得に失敗しました（${START2_URL}）：${reason}`, { cause });
}

/** 失敗の理由の文（Error ならその文、ほかは文字列にしたもの） */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
