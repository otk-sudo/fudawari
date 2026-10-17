// 艦船マスタの読み込み（loadShipMaster）のテスト
//
// - fetch は外部との境界なので vi.stubGlobal で差し替える（src/test/definition-fetch.ts）。
// - ファイルの中身は generateShipMaster.ts が書き出す形（{ schemaVersion: 1, ships: ShipMasterEntry[] }）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookupShip, type ShipMasterEntry } from "@/domain/master";
import {
  loadShipMaster,
  SHIP_MASTER_PATH,
  type ShipMasterLoadError,
  type ShipMasterLoadResult,
} from "@/lib/ship-master";
import { SHIP_MASTER_OUTPUT_PATH } from "@/lib/ship-master/generateShipMaster";
import {
  failNetwork,
  type FetchMock,
  requestedPaths,
  respondWithStatus,
  stubFetch,
  textResponse,
} from "@/test/definition-fetch";
import { summer2026MasterEntries } from "@/test/fixtures";
import {
  brokenBodyResponse,
  respondWithShipMaster,
  shipMasterFileOf,
} from "@/test/ship-master-fetch";

// 失敗の結果から理由を取り出す（成功なら、その時点でテストを失敗させる）
function expectFailure(result: ShipMasterLoadResult): ShipMasterLoadError {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("読み込みが成功してしまった（失敗を期待していた）");
  }
  return result.error;
}

// 仮マスタの行（時雨改三。艦 ID 961）
function shigureKai3(): ShipMasterEntry {
  const found = summer2026MasterEntries.find((entry) => entry.id === 961);
  if (found === undefined) throw new Error("仮マスタに時雨改三（961）がありません");
  return found;
}

// 行の必須の項目（どれが欠けても形の誤りにする）
const REQUIRED_FIELDS = [
  "id",
  "name",
  "yomi",
  "baseName",
  "shipTypeId",
  "shipClassId",
  "shipClassName",
  "remodelStage",
  "sortNo",
  "luckBase",
] as const satisfies readonly (keyof ShipMasterEntry)[];

/** 2 行目（ships[1]）の項目を書き換えたファイルの中身 */
function fileWithSecondRow(change: (row: Record<string, unknown>) => void): unknown {
  const file = shipMasterFileOf();
  const rows = file.ships as unknown as Record<string, unknown>[];
  change(rows[1]);
  return file;
}

describe("艦船マスタの読み込み（loadShipMaster）", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("置き場所は /data/ship-master.json で、ビルド時の書き出し先（public/data/ship-master.json）と対応する", () => {
    // 検証：生成（generateShipMaster.ts）とそろえる契約の値
    expect(SHIP_MASTER_PATH).toBe("/data/ship-master.json");
    expect(`public${SHIP_MASTER_PATH}`).toBe(SHIP_MASTER_OUTPUT_PATH);
  });

  describe("取得に成功したとき", () => {
    it("静的ファイル /data/ship-master.json を 1 回だけ取得する", async () => {
      // 準備
      respondWithShipMaster(fetchMock);

      // 実行
      await loadShipMaster();

      // 検証
      expect(requestedPaths(fetchMock)).toEqual(["/data/ship-master.json"]);
    });

    it("艦 ID から引ける索引を返す（ファイルのすべての行が引ける）", async () => {
      // 準備
      respondWithShipMaster(fetchMock);

      // 実行
      const result = await loadShipMaster();

      // 検証
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.master.byId.size).toBe(summer2026MasterEntries.length);
        expect(lookupShip(result.master, 961)).toEqual({ known: true, ...shigureKai3() });
      }
    });

    it("ファイルにない艦 ID は、引くと「名前が分からない艦」になる（索引は createShipMaster と同じ扱い）", async () => {
      // 準備
      respondWithShipMaster(fetchMock);

      // 実行
      const result = await loadShipMaster();

      // 検証
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(lookupShip(result.master, 99999)).toEqual({
          known: false,
          id: 99999,
          name: "名前が分からない艦",
        });
      }
    });

    it("同じ艦 ID の行が 2 つあるときは、先の行を使う", async () => {
      // 準備：時雨改三の行の後に、名前だけ違う同じ艦 ID の行を足す
      const first = shigureKai3();
      respondWithShipMaster(fetchMock, shipMasterFileOf([first, { ...first, name: "後の行" }]));

      // 実行
      const result = await loadShipMaster();

      // 検証
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.master.byId.get(961)?.name).toBe("時雨改三");
      }
    });
  });

  describe("取得に失敗したとき（kind: fetch）", () => {
    it("404 なら、例外を投げずに状態コード 404 つきの取得の失敗を返し、理由の文に 404 を含める", async () => {
      // 準備
      respondWithStatus(fetchMock, 404);

      // 実行
      const error = expectFailure(await loadShipMaster());

      // 検証
      expect(error).toMatchObject({ kind: "fetch", status: 404 });
      expect(error.message).toContain("404");
    });

    it("500 など 404 以外の失敗の状態コードも、その状態コードつきの取得の失敗にする", async () => {
      // 準備
      respondWithStatus(fetchMock, 500);

      // 実行
      const error = expectFailure(await loadShipMaster());

      // 検証
      expect(error).toMatchObject({ kind: "fetch", status: 500 });
      expect(error.message).toContain("500");
    });

    it("通信の失敗（fetch が失敗する）なら、例外を投げずに状態コード null の取得の失敗を返す", async () => {
      // 準備
      failNetwork(fetchMock);

      // 実行
      const result = loadShipMaster();

      // 検証：例外にならず、結果として返る
      await expect(result).resolves.toMatchObject({
        ok: false,
        error: { kind: "fetch", status: null },
      });
    });

    it("通信の失敗にも、画面に出せる理由の文（空でない）を付ける", async () => {
      // 準備
      failNetwork(fetchMock);

      // 実行
      const error = expectFailure(await loadShipMaster());

      // 検証
      expect(error.message.trim()).not.toBe("");
    });

    it("状態コードは成功でも本文を最後まで受け取れなければ、状態コード null の取得の失敗にする", async () => {
      // 準備
      fetchMock.mockImplementation(async () => brokenBodyResponse());

      // 実行
      const result = loadShipMaster();

      // 検証
      await expect(result).resolves.toMatchObject({
        ok: false,
        error: { kind: "fetch", status: null },
      });
    });
  });

  describe("形が違うとき（kind: invalid）", () => {
    it("JSON として読めなければ、例外を投げずに invalid_json（場所はルート）の形の誤りを返す", async () => {
      // 準備
      fetchMock.mockImplementation(async () => textResponse('{"schemaVersion": 1, "ships": ['));

      // 実行
      const result = loadShipMaster();

      // 検証
      await expect(result).resolves.toMatchObject({
        ok: false,
        error: { kind: "invalid", reason: "invalid_json", path: "" },
      });
    });

    it.each([
      ["2（新しい形式）", 2],
      ["0", 0],
      ['文字列の "1"', "1"],
    ])("schemaVersion が %s なら、unsupported_version の形の誤り（場所は schemaVersion）にする", async (_label, version) => {
      // 準備
      respondWithShipMaster(fetchMock, { ...shipMasterFileOf(), schemaVersion: version });

      // 実行
      const error = expectFailure(await loadShipMaster());

      // 検証
      expect(error).toMatchObject({ kind: "invalid", reason: "unsupported_version", path: "schemaVersion" });
    });

    it("schemaVersion がなければ、unsupported_version の形の誤りにする", async () => {
      // 準備
      respondWithShipMaster(fetchMock, { ships: shipMasterFileOf().ships });

      // 実行
      const error = expectFailure(await loadShipMaster());

      // 検証
      expect(error).toMatchObject({ kind: "invalid", reason: "unsupported_version", path: "schemaVersion" });
    });

    it("ルートがオブジェクトでない（配列）なら、invalid_shape の形の誤り（場所はルート）にする", async () => {
      // 準備：行の配列だけを置いた古い形を想定
      respondWithShipMaster(fetchMock, shipMasterFileOf().ships);

      // 実行
      const error = expectFailure(await loadShipMaster());

      // 検証
      expect(error).toMatchObject({ kind: "invalid", reason: "invalid_shape", path: "" });
    });

    it.each([
      ["オブジェクト", { 961: shigureKai3() }],
      ["null", null],
      ["ない", undefined],
    ])("ships が配列でない（%s）なら、invalid_shape の形の誤り（場所は ships）にする", async (_label, ships) => {
      // 準備
      respondWithShipMaster(fetchMock, { schemaVersion: 1, ships });

      // 実行
      const error = expectFailure(await loadShipMaster());

      // 検証
      expect(error).toMatchObject({ kind: "invalid", reason: "invalid_shape", path: "ships" });
    });

    it("ships が空の配列なら、invalid_shape の形の誤り（場所は ships）にする（生成は 0 隻のマスタを書き出さないため、壊れたファイルとみなす）", async () => {
      // 準備
      respondWithShipMaster(fetchMock, { schemaVersion: 1, ships: [] });

      // 実行
      const error = expectFailure(await loadShipMaster());

      // 検証
      expect(error).toMatchObject({ kind: "invalid", reason: "invalid_shape", path: "ships" });
    });

    it.each(REQUIRED_FIELDS)("2 行目の %s が欠けていれば、その場所（ships[1].項目名）つきの invalid_shape にする", async (field) => {
      // 準備
      respondWithShipMaster(
        fetchMock,
        fileWithSecondRow((row) => {
          delete row[field];
        }),
      );

      // 実行
      const error = expectFailure(await loadShipMaster());

      // 検証
      expect(error).toMatchObject({ kind: "invalid", reason: "invalid_shape", path: `ships[1].${field}` });
    });

    it.each([
      ["id が文字列", "id", "961"],
      ["name が数", "name", 145],
      ["luckBase が null", "luckBase", null],
      ["remodelStage が知らない値", "remodelStage", "converted"],
    ])("2 行目の項目の型・値が違う（%s）なら、その場所つきの invalid_shape にする", async (_label, field, value) => {
      // 準備
      respondWithShipMaster(
        fetchMock,
        fileWithSecondRow((row) => {
          row[field] = value;
        }),
      );

      // 実行
      const error = expectFailure(await loadShipMaster());

      // 検証
      expect(error).toMatchObject({ kind: "invalid", reason: "invalid_shape", path: `ships[1].${field}` });
    });

    describe("国籍（v1.1。nationality）", () => {
      it("国籍のある行は、その国籍のまま引ける（時雨改三は日本）", async () => {
        // 準備
        respondWithShipMaster(fetchMock);

        // 実行
        const result = await loadShipMaster();

        // 検証
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.master.byId.get(961)?.nationality).toBe("japan");
        }
      });

      it("国籍のない行（v1.1 より前に生成したファイル）は、形の誤りにせず unknown として読む", async () => {
        // 準備：2 行目の nationality を消す
        respondWithShipMaster(
          fetchMock,
          fileWithSecondRow((row) => {
            delete row.nationality;
          }),
        );

        // 実行
        const result = await loadShipMaster();

        // 検証
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.master.byId.get(summer2026MasterEntries[1].id)?.nationality).toBe("unknown");
          expect(result.master.byId.get(961)?.nationality).toBe("japan");
        }
      });

      it("すべての行に国籍がない（古い形の）ファイルも読め、すべて unknown になる", async () => {
        // 準備
        const file = shipMasterFileOf();
        const rows = file.ships as unknown as Record<string, unknown>[];
        for (const row of rows) delete row.nationality;
        respondWithShipMaster(fetchMock, file);

        // 実行
        const result = await loadShipMaster();

        // 検証
        expect(result.ok).toBe(true);
        if (result.ok) {
          const nationalities = new Set([...result.master.byId.values()].map((entry) => entry.nationality));
          expect(nationalities).toEqual(new Set(["unknown"]));
        }
      });

      it("国籍が unknown の行は、そのまま unknown として読む（unknown も国籍の値の 1 つ）", async () => {
        // 準備
        respondWithShipMaster(
          fetchMock,
          fileWithSecondRow((row) => {
            row.nationality = "unknown";
          }),
        );

        // 実行
        const result = await loadShipMaster();

        // 検証
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.master.byId.get(summer2026MasterEntries[1].id)?.nationality).toBe("unknown");
        }
      });

      it.each<[string, unknown]>([
        ["知らない国籍の文字列", "china"],
        ["表示名（日本語）", "アメリカ"],
        ["空の文字列", ""],
        ["数", 1],
        ["null", null],
        ["配列", ["usa"]],
      ])(
        "国籍が国籍のどれでもない値（%s）なら、その場所（ships[1].nationality）つきの invalid_shape にする",
        async (_label, value) => {
          // 準備
          respondWithShipMaster(
            fetchMock,
            fileWithSecondRow((row) => {
              row.nationality = value;
            }),
          );

          // 実行
          const error = expectFailure(await loadShipMaster());

          // 検証
          expect(error).toMatchObject({ kind: "invalid", reason: "invalid_shape", path: "ships[1].nationality" });
        },
      );
    });

    it("行がオブジェクトでない（数）なら、その行の場所（ships[1]）つきの invalid_shape にする", async () => {
      // 準備
      const file = shipMasterFileOf();
      respondWithShipMaster(fetchMock, { ...file, ships: [file.ships[0], 961, ...file.ships.slice(1)] });

      // 実行
      const error = expectFailure(await loadShipMaster());

      // 検証
      expect(error).toMatchObject({ kind: "invalid", reason: "invalid_shape", path: "ships[1]" });
    });

    it.each([
      ["JSON として読めない", '{"schemaVersion": 1, "ships": ['],
      ["schemaVersion が 2", JSON.stringify({ ...shipMasterFileOf(), schemaVersion: 2 })],
      ["ships が配列でない", JSON.stringify({ schemaVersion: 1, ships: {} })],
      ["項目が欠けた行がある", JSON.stringify(fileWithSecondRow((row) => delete row.name))],
    ])("形の誤り（%s）にも、画面に出せる理由の文（空でない）を付ける", async (_label, body) => {
      // 準備
      fetchMock.mockImplementation(async () => textResponse(body));

      // 実行
      const error = expectFailure(await loadShipMaster());

      // 検証
      expect(error.kind).toBe("invalid");
      expect(error.message.trim()).not.toBe("");
    });
  });
});
