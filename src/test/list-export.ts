// 一覧（src/features/list、/list）と画像で保存（src/features/export-image）のテストで使うデータと取得の差し替え
//
// - 定義・艦・割り当ての元は共通のテスト用データ（src/test/fixtures）。ここでは一覧・画像で保存の場面に必要な形を足す
//   - definitionWithEightFudas()：札が 8 つ（E4 と札 3 つを足した）定義。6 札を超えて画像が 2 枚に分かれる場面に使う
//   - eightFudaAssignments：上の定義で 8 札すべてに艦がいる割り当て
//   - manyShipsOnRengo(count)：連合艦隊に Lv の違う艦を count 隻置く（画像の列に入らない隻数。U15）
// - 一覧の画面は公開定義と艦船マスタの 2 つの静的ファイルを読むため、fetch をパスで振り分けて差し替える
//   （src/test/definition-fetch.ts の respondWithDefinition は、どのパスにも公開定義を返す）。
//   fetch の差し替え（stubFetch）と後片付け（vi.unstubAllGlobals）は src/test/definition-fetch.ts のものを使う。
//   割り振りの画面のブランチ（PR-05）の src/test/latest-data-fetch.ts と同じ役目。両方を取り込んだ後でまとめてよい
import type { PublicDefinition } from "@/domain/definition";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import { LATEST_DEFINITION_PATH } from "@/lib/definition";
import { SHIP_MASTER_PATH } from "@/lib/ship-master";
import { cloneSummer2026Definition, summer2026Assignments, summer2026Definition } from "@/test/fixtures";
import { type FetchMock, textResponse } from "./definition-fetch";
import { shipMasterFileOf } from "./ship-master-fetch";

// ---- 定義・艦・割り当て ----

/**
 * 札が 8 つの定義（2026夏イベの複製に、海域 E4 と札 3 つ・段階 3 つを足したもの）。
 * 足した札：fr3（仏第3艦隊）・frmed（仏地中海艦隊）・eurocomb（欧州連合艦隊）。札の順は s31, tago, rengo, ulithi, sixth, fr3, frmed, eurocomb。
 * 足した段階：E4-1「ゲージ1」（fr3・普通）、E4-2「ゲージ2」（frmed・重要）、E4-3「ゲージ3」（eurocomb・難所）。特効はない
 */
export function definitionWithEightFudas(): PublicDefinition {
  const definition = cloneSummer2026Definition();
  definition.areas.push({ id: "E4", name: "E4" });
  definition.fudas.push(
    { id: "fr3", name: "仏第3艦隊", color: "#2BB3B1", gameNumber: 6 },
    { id: "frmed", name: "仏地中海艦隊", color: "#E07A5F", gameNumber: 7 },
    { id: "eurocomb", name: "欧州連合艦隊", color: "#E5484D", gameNumber: 8 },
  );
  definition.stages.push(
    { id: "E4-1", areaId: "E4", name: "ゲージ1", fudaId: "fr3", importance: "normal", boosts: [] },
    { id: "E4-2", areaId: "E4", name: "ゲージ2", fudaId: "frmed", importance: "important", boosts: [] },
    { id: "E4-3", areaId: "E4", name: "ゲージ3", fudaId: "eurocomb", importance: "hard", boosts: [] },
  );
  return definition;
}

/** definitionWithEightFudas の 8 札すべてに艦がいる割り当て（一覧の割り当てに、控えの 浜波改・利根改二・日向改二 を足した札へ置く） */
export const eightFudaAssignments: AssignmentMap = {
  ...summer2026Assignments,
  hamanami: "fr3",
  tone: "frmed",
  hyuga: "eurocomb",
};

/** manyShipsOnRengo の戻り値 */
export interface ManyShips {
  /** 個体（時雨改二。Lv は 100 から 1 ずつ上がる。個体 ID は "many-01" から） */
  ships: OwnedShip[];
  /** すべて連合艦隊（rengo）に置く割り当て */
  assignments: AssignmentMap;
}

/** 連合艦隊に時雨改二（艦 ID 145）を count 隻置く。Lv は 100〜（100 + count − 1）ですべて違う */
export function manyShipsOnRengo(count: number): ManyShips {
  const ships: OwnedShip[] = Array.from({ length: count }, (_, i) => ({
    uid: `many-${String(i + 1).padStart(2, "0")}`,
    shipId: 145,
    level: 100 + i,
    luck: 20,
    sallyArea: 0,
  }));
  const assignments: AssignmentMap = Object.fromEntries(ships.map((ship) => [ship.uid, "rengo"]));
  return { ships, assignments };
}

// ---- 取得（fetch）の差し替え ----

/** 1 つのパスへの応答の作り方（呼ばれるたびに新しい応答を作る。応答の本文は 1 回しか読めないため） */
export type StaticFileResponder = () => Response | Promise<Response>;

/** listFileResponders の引数 */
export interface ListFileOptions {
  /** 公開定義（省略するとテスト用の 2026夏イベ） */
  definition?: PublicDefinition;
  /** 艦船マスタのファイルの中身（省略するとテスト用の仮マスタ） */
  shipMasterFile?: unknown;
}

/** 公開定義（/data/latest-definition.json）と艦船マスタ（/data/ship-master.json）の応答の作り方 */
export function listFileResponders(options: ListFileOptions = {}): Record<string, StaticFileResponder> {
  const definition = options.definition ?? summer2026Definition;
  const shipMasterFile = options.shipMasterFile ?? shipMasterFileOf();
  return {
    [LATEST_DEFINITION_PATH]: () => textResponse(JSON.stringify(definition)),
    [SHIP_MASTER_PATH]: () => textResponse(JSON.stringify(shipMasterFile)),
  };
}

/** fetch に渡された URL のパス（文字列・URL・Request のどれで渡されてもよい） */
function pathOf(input: Parameters<typeof fetch>[0]): string {
  const url = input instanceof Request ? input.url : String(input);
  return new URL(url, "http://localhost").pathname;
}

/** パスごとに応答を返す。responders にないパスは 404 */
export function respondToPaths(fetchMock: FetchMock, responders: Readonly<Record<string, StaticFileResponder>>): void {
  fetchMock.mockImplementation(async (input) => {
    const path = pathOf(input);
    const responder = Object.hasOwn(responders, path) ? responders[path] : undefined;
    return responder === undefined ? new Response("Not Found", { status: 404 }) : responder();
  });
}

/** 公開定義と艦船マスタを返す（ほかのパスは 404） */
export function respondWithListFiles(fetchMock: FetchMock, options: ListFileOptions = {}): void {
  respondToPaths(fetchMock, listFileResponders(options));
}

/** 結果を後から決める応答（読み込み中を確かめるため） */
export interface HeldStaticFile {
  /** respondToPaths に渡す応答の作り方（release を呼ぶまで待つ） */
  responder: StaticFileResponder;
  /** 待たせている応答を返す（呼ぶ前に来た要求も、後から来た要求も、makeResponse で作った応答を受け取る） */
  release: (makeResponse: () => Response) => void;
}

/** 結果を後から決める応答を作る */
export function holdStaticFile(): HeldStaticFile {
  let settle: (makeResponse: () => Response) => void = () => {};
  const outcome = new Promise<() => Response>((resolve) => {
    settle = resolve;
  });
  return {
    responder: async () => (await outcome)(),
    release: (makeResponse) => settle(makeResponse),
  };
}
