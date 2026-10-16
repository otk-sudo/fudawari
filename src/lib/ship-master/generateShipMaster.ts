// ビルド時に艦船マスタを生成する処理（roadmap T1-5、U1）
//
// - start2.json（Tibowl/api_start2）を取得し、buildShipMasterEntries で必要な項目だけを抜き出して
//   public/data/ship-master.json に書き出す（生成物はコミットしない）。
// - 取得・書き出しは引数で受け取る（テストでは差し替える。scripts/ の生成スクリプトは
//   Node の fetch とファイルの書き込みを渡して呼ぶだけにする）。
// - 取得・解析に失敗したら、理由を入れた Error で失敗する（ファイルは書かない）。スクリプトはそれを表示してビルドを止める。
import { buildShipMasterEntries, readStart2 } from "@/domain/master/fromStart2";
import { SHIP_CLASS_NAMES } from "@/domain/master/shipClassNames";
import type { ShipMasterEntry } from "@/domain/master/types";

/** start2.json の取得元 */
export const START2_URL = "https://raw.githubusercontent.com/Tibowl/api_start2/master/start2.json";

/** 書き出し先（プロジェクトのルートからの相対パス） */
export const SHIP_MASTER_OUTPUT_PATH = "public/data/ship-master.json";

/** 艦船マスタのファイルの形式の版。形を変えるときに上げる */
export const SHIP_MASTER_FILE_SCHEMA_VERSION = 1;

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
  /** 書き出し先。省略すると SHIP_MASTER_OUTPUT_PATH */
  outputPath?: string;
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
 * 次のときは理由を入れた Error で失敗し、書き出さない：
 * 取得の失敗（通信の失敗・HTTP の失敗の状態）、JSON として読めない、api_mst_ship がない、味方艦が 1 隻もない。
 * Error の文には、何の処理で失敗したかが分かるよう「start2.json」（取得元の URL でもよい）と、
 * 元の理由（通信の失敗の文、HTTP の状態の番号など）を入れる
 */
export async function generateShipMaster(deps: GenerateShipMasterDeps): Promise<GenerateShipMasterResult> {
  const outputPath = deps.outputPath ?? SHIP_MASTER_OUTPUT_PATH;
  const classNames = deps.classNames ?? SHIP_CLASS_NAMES;

  // 取得
  let response: FetchResponseLike;
  try {
    response = await deps.fetch(START2_URL);
  } catch (error) {
    throw fetchFailure(messageOf(error), error);
  }
  if (!response.ok) {
    throw fetchFailure(`HTTP の状態 ${response.status}`);
  }
  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    throw fetchFailure(messageOf(error), error);
  }

  // 解析
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

  // 変換（味方艦が 1 隻もなければ、壊れたマスタを配らないよう止める）
  const ships = buildShipMasterEntries(start2, classNames);
  if (ships.length === 0) {
    throw new Error("start2.json の api_mst_ship に味方艦が 1 隻もありません");
  }

  // 書き出し
  const file: ShipMasterFile = { schemaVersion: SHIP_MASTER_FILE_SCHEMA_VERSION, ships };
  await deps.writeFile(outputPath, JSON.stringify(file));
  return { outputPath, shipCount: ships.length };
}

/** 取得の失敗の Error（取得元と元の理由を入れる） */
function fetchFailure(reason: string, cause?: unknown): Error {
  return new Error(`start2.json の取得に失敗しました（${START2_URL}）：${reason}`, { cause });
}

/** 失敗の理由の文（Error ならその文、ほかは文字列にしたもの） */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
