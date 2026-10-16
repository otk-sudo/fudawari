// 公開定義の取得（fetch）を差し替えるテスト用の部品
//
// 一般の画面は静的ファイル /data/latest-definition.json だけを fetch で取得する（要件 5 章）。
// fetch は外部との境界なので、単体テストでは vi.stubGlobal で差し替える。
// 使ったテストは afterEach で vi.unstubAllGlobals() を呼んで元に戻す。
import { type Mock, vi } from "vitest";
import type { PublicDefinition } from "@/domain/definition";
import { summer2026Definition } from "@/test/fixtures";

/** 差し替えた fetch */
export type FetchMock = Mock<typeof fetch>;

/** globalThis.fetch を差し替える（応答は返し方の関数で決める） */
export function stubFetch(): FetchMock {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** 本文が文字列の応答 */
export function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 公開定義を JSON にして返す（呼ばれるたびに新しい応答を作る。応答の本文は 1 回しか読めないため） */
export function respondWithDefinition(
  fetchMock: FetchMock,
  definition: PublicDefinition = summer2026Definition,
): void {
  fetchMock.mockImplementation(async () => textResponse(JSON.stringify(definition)));
}

/** 指定した状態コード（404 など）の応答を返す */
export function respondWithStatus(fetchMock: FetchMock, status: number): void {
  fetchMock.mockImplementation(async () => new Response("Not Found", { status }));
}

/** 通信そのものに失敗させる（ブラウザの fetch はネットワークの失敗で TypeError を投げる） */
export function failNetwork(fetchMock: FetchMock): void {
  fetchMock.mockImplementation(async () => {
    throw new TypeError("Failed to fetch");
  });
}

/** 待たせた fetch の結果を後から決める操作 */
export type HeldFetch = {
  /** 応答を返す（呼ばれた fetch すべてに、makeResponse で作った新しい応答を返す） */
  respond: (makeResponse: () => Response) => void;
  /** 通信の失敗にする */
  fail: (error: unknown) => void;
};

/**
 * fetch を待たせる（読み込み中の状態を確かめるため）。結果は返した操作で後から決める。
 * fetch が呼ばれる前に結果を決めてもよい
 */
export function holdFetch(fetchMock: FetchMock): HeldFetch {
  let settle: (outcome: () => Response) => void = () => {};
  const outcome = new Promise<() => Response>((resolve) => {
    settle = resolve;
  });
  fetchMock.mockImplementation(async () => (await outcome)());
  return {
    respond: (makeResponse) => settle(makeResponse),
    fail: (error) =>
      settle(() => {
        throw error;
      }),
  };
}

/** fetch に渡された URL のパス（"/data/latest-definition.json" など）の一覧。文字列・URL・Request のどれで渡されてもよい */
export function requestedPaths(fetchMock: FetchMock): string[] {
  return fetchMock.mock.calls.map(([input]) => {
    const url = input instanceof Request ? input.url : String(input);
    return new URL(url, "http://localhost").pathname;
  });
}
