// ビルド時に艦船マスタを生成する処理（roadmap T1-5、U1）
//
// - start2.json（Tibowl/api_start2）を取得し、buildShipMasterEntries で必要な項目だけを抜き出して
//   public/data/ship-master.json に書き出す（生成物はコミットしない）。
// - 取得・書き出しは引数で受け取る（テストでは差し替える。scripts/ の生成スクリプトは
//   Node の fetch とファイルの書き込みを渡して呼ぶだけにする）。
// - 取得・解析に失敗したら、理由を入れた Error で失敗する（ファイルは書かない）。スクリプトはそれを表示してビルドを止める。
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
  void deps;
  throw new Error("未実装");
}
