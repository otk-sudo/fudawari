// 一般の画面が取得する静的ファイル（最新イベントの公開定義・艦船マスタ）の取得を、パスごとに差し替えるテスト用の部品
//
// - 取り込み画面のように、公開定義（/data/latest-definition.json）と艦船マスタ（/data/ship-master.json）の両方を
//   読む画面のテストで使う。どちらか一方だけを読む部品のテストは definition-fetch.ts・ship-master-fetch.ts の補助を使う。
// - fetch の差し替え（stubFetch）と後片付け（vi.unstubAllGlobals）は definition-fetch.ts と同じ。
import { LATEST_DEFINITION_PATH } from "@/lib/definition";
import { SHIP_MASTER_PATH } from "@/lib/ship-master";
import { summer2026Definition } from "@/test/fixtures";
import { type FetchMock, textResponse } from "./definition-fetch";
import { shipMasterFileOf } from "./ship-master-fetch";

/** パスごとの応答の作り方（呼ばれるたびに新しい応答を作る。応答の本文は 1 回しか読めないため） */
export type StaticDataRoutes = Partial<Record<string, () => Response | Promise<Response>>>;

/** fetch に渡された値（文字列・URL・Request）のパス */
function pathOf(input: Parameters<typeof fetch>[0]): string {
  const url = input instanceof Request ? input.url : String(input);
  return new URL(url, "http://localhost").pathname;
}

/**
 * 静的ファイルの取得を、パスごとに応答する。
 * 既定は、公開定義にテスト用の 2026夏イベ、艦船マスタにテスト用の仮マスタ（summer2026MasterEntries）を返す。
 * overrides で、パスごとの応答を差し替える（例：艦船マスタだけ 404 にする）。どちらでもないパスは 404 を返す
 */
export function respondWithStaticData(fetchMock: FetchMock, overrides: StaticDataRoutes = {}): void {
  const routes: StaticDataRoutes = {
    [LATEST_DEFINITION_PATH]: () => textResponse(JSON.stringify(summer2026Definition)),
    [SHIP_MASTER_PATH]: () => textResponse(JSON.stringify(shipMasterFileOf())),
    ...overrides,
  };
  fetchMock.mockImplementation(async (input) => {
    const route = routes[pathOf(input)];
    if (route === undefined) return new Response("Not Found", { status: 404 });
    return route();
  });
}
