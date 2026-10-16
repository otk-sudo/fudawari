// 一般の画面が読む静的ファイル（最新イベントの公開定義・艦船マスタ）の取得を、パスで振り分けて差し替えるテスト用の部品
//
// 割り振り画面のように、公開定義と艦船マスタの両方を読む画面のテストで使う
// （src/test/definition-fetch.ts の respondWithDefinition は、どのパスにも公開定義を返す）。
// fetch の差し替え（stubFetch）と後片付け（vi.unstubAllGlobals）は src/test/definition-fetch.ts のものを使う。
import type { PublicDefinition } from "@/domain/definition";
import { LATEST_DEFINITION_PATH } from "@/lib/definition";
import { SHIP_MASTER_PATH } from "@/lib/ship-master";
import { summer2026Definition } from "@/test/fixtures";
import { type FetchMock, textResponse } from "./definition-fetch";
import { shipMasterFileOf } from "./ship-master-fetch";

/** 1 つのパスへの応答の作り方（呼ばれるたびに新しい応答を作る。応答の本文は 1 回しか読めないため） */
export type PathResponder = () => Response | Promise<Response>;

/** パス → 応答の作り方 */
export type PathResponders = Readonly<Record<string, PathResponder>>;

/** fetch に渡された URL のパス（文字列・URL・Request のどれで渡されてもよい） */
function pathOf(input: Parameters<typeof fetch>[0]): string {
  const url = input instanceof Request ? input.url : String(input);
  return new URL(url, "http://localhost").pathname;
}

/** パスごとに応答を返す。responders にないパスは 404 */
export function respondByPath(fetchMock: FetchMock, responders: PathResponders): void {
  fetchMock.mockImplementation(async (input) => {
    const path = pathOf(input);
    const responder = Object.hasOwn(responders, path) ? responders[path] : undefined;
    return responder === undefined ? new Response("Not Found", { status: 404 }) : responder();
  });
}

/** latestDataResponders の引数 */
export interface LatestDataOptions {
  /** 公開定義（省略するとテスト用の 2026夏イベ） */
  definition?: PublicDefinition;
  /** 艦船マスタのファイルの中身（省略するとテスト用の仮マスタ。shipMasterFileOf で作る） */
  shipMasterFile?: unknown;
}

/** 公開定義（/data/latest-definition.json）と艦船マスタ（/data/ship-master.json）の応答の作り方 */
export function latestDataResponders(options: LatestDataOptions = {}): Record<string, PathResponder> {
  const definition = options.definition ?? summer2026Definition;
  const shipMasterFile = options.shipMasterFile ?? shipMasterFileOf();
  return {
    [LATEST_DEFINITION_PATH]: () => textResponse(JSON.stringify(definition)),
    [SHIP_MASTER_PATH]: () => textResponse(JSON.stringify(shipMasterFile)),
  };
}

/** 公開定義と艦船マスタを返す（ほかのパスは 404） */
export function respondWithLatestData(fetchMock: FetchMock, options: LatestDataOptions = {}): void {
  respondByPath(fetchMock, latestDataResponders(options));
}

/** 結果を後から決める応答（読み込み中を確かめるため） */
export interface HeldResponder {
  /** respondByPath に渡す応答の作り方（release を呼ぶまで待つ） */
  responder: PathResponder;
  /** 待たせている応答を返す（呼ぶ前に来た要求も、後から来た要求も、makeResponse で作った応答を受け取る） */
  release: (makeResponse: () => Response) => void;
}

/** 結果を後から決める応答を作る */
export function holdResponder(): HeldResponder {
  let settle: (makeResponse: () => Response) => void = () => {};
  const outcome = new Promise<() => Response>((resolve) => {
    settle = resolve;
  });
  return {
    responder: async () => (await outcome)(),
    release: (makeResponse) => settle(makeResponse),
  };
}
