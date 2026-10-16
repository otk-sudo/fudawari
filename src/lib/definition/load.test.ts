import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DefinitionLoadError,
  type DefinitionLoadResult,
  LATEST_DEFINITION_PATH,
  loadLatestDefinition,
} from "@/lib/definition";
import {
  failNetwork,
  type FetchMock,
  requestedPaths,
  respondWithDefinition,
  respondWithStatus,
  stubFetch,
  textResponse,
} from "@/test/definition-fetch";
import { cloneSummer2026Definition, summer2026Definition } from "@/test/fixtures";

// 失敗の結果から理由を取り出す（成功なら、その時点でテストを失敗させる）
function expectFailure(result: DefinitionLoadResult): DefinitionLoadError {
  if (result.ok) {
    throw new Error("読み込みが成功してしまった（失敗を期待していた）");
  }
  return result.error;
}

describe("最新イベントの公開定義の読み込み（loadLatestDefinition）", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("置き場所は /data/latest-definition.json（public/data/latest-definition.json）", () => {
    // 検証：ビルド時の生成（PR-13）とそろえる契約の値
    expect(LATEST_DEFINITION_PATH).toBe("/data/latest-definition.json");
  });

  describe("取得に成功したとき", () => {
    it("静的ファイル /data/latest-definition.json を 1 回だけ取得する", async () => {
      // 準備
      respondWithDefinition(fetchMock);

      // 実行
      await loadLatestDefinition();

      // 検証
      expect(requestedPaths(fetchMock)).toEqual(["/data/latest-definition.json"]);
    });

    it("検証を通った公開定義を返す", async () => {
      // 準備
      respondWithDefinition(fetchMock);

      // 実行
      const result = await loadLatestDefinition();

      // 検証
      expect(result).toEqual({ ok: true, definition: summer2026Definition });
    });

    it("省略してよい項目（終了日時・ゲーム内の札番号）は、検証後の値（null）にそろえて返す", async () => {
      // 準備：JSON から endAt と最初の札の gameNumber を省く
      const raw = JSON.parse(JSON.stringify(summer2026Definition)) as {
        event: Record<string, unknown>;
        fudas: Record<string, unknown>[];
      };
      delete raw.event.endAt;
      delete raw.fudas[0].gameNumber;
      fetchMock.mockImplementation(async () => textResponse(JSON.stringify(raw)));

      // 実行
      const result = await loadLatestDefinition();

      // 検証
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.definition.event.endAt).toBeNull();
        expect(result.definition.fudas[0].gameNumber).toBeNull();
      }
    });
  });

  describe("取得に失敗したとき（kind: fetch）", () => {
    it("404 なら、例外を投げずに状態コード 404 つきの取得の失敗を返す", async () => {
      // 準備
      respondWithStatus(fetchMock, 404);

      // 実行
      const result = await loadLatestDefinition();

      // 検証
      const error = expectFailure(result);
      expect(error).toMatchObject({ kind: "fetch", status: 404 });
    });

    it("404 の理由の文には状態コード 404 を含める", async () => {
      // 準備
      respondWithStatus(fetchMock, 404);

      // 実行
      const error = expectFailure(await loadLatestDefinition());

      // 検証
      expect(error.message).toContain("404");
    });

    it("500 など 404 以外の失敗の状態コードも、その状態コードつきの取得の失敗にする", async () => {
      // 準備
      respondWithStatus(fetchMock, 500);

      // 実行
      const error = expectFailure(await loadLatestDefinition());

      // 検証
      expect(error).toMatchObject({ kind: "fetch", status: 500 });
      expect(error.message).toContain("500");
    });

    it("ネットワークの失敗（fetch が失敗する）なら、例外を投げずに状態コード null の取得の失敗を返す", async () => {
      // 準備
      failNetwork(fetchMock);

      // 実行
      const result = loadLatestDefinition();

      // 検証：例外にならず、結果として返る
      await expect(result).resolves.toMatchObject({
        ok: false,
        error: { kind: "fetch", status: null },
      });
    });

    it("ネットワークの失敗にも、画面に出せる理由の文を付ける", async () => {
      // 準備
      failNetwork(fetchMock);

      // 実行
      const error = expectFailure(await loadLatestDefinition());

      // 検証
      expect(error.message).toEqual(expect.any(String));
      expect(error.message.trim()).not.toBe("");
    });
  });

  describe("検証に失敗したとき（kind: invalid）", () => {
    it("壊れた JSON なら、例外を投げずに invalid_json の誤りつきの検証の失敗を返す", async () => {
      // 準備
      fetchMock.mockImplementation(async () => textResponse('{"schemaVersion": 1, "event": '));

      // 実行
      const result = loadLatestDefinition();

      // 検証
      await expect(result).resolves.toMatchObject({
        ok: false,
        error: {
          kind: "invalid",
          errors: [expect.objectContaining({ code: "invalid_json", path: "" })],
        },
      });
    });

    it("検証の規則に合わない定義（イベント名が空）なら、どこが誤りかの一覧つきの検証の失敗を返す", async () => {
      // 準備
      const broken = cloneSummer2026Definition();
      broken.event.name = "";
      fetchMock.mockImplementation(async () => textResponse(JSON.stringify(broken)));

      // 実行
      const error = expectFailure(await loadLatestDefinition());

      // 検証
      expect(error.kind).toBe("invalid");
      if (error.kind === "invalid") {
        expect(error.errors).toContainEqual(
          expect.objectContaining({ code: "invalid_value", path: "event.name" }),
        );
      }
    });

    it("検証の失敗の理由の文には、検証の誤りの文を含める", async () => {
      // 準備：存在しない札を参照する段階を混ぜる
      const broken = cloneSummer2026Definition();
      broken.stages[0].fudaId = "missing-fuda";
      fetchMock.mockImplementation(async () => textResponse(JSON.stringify(broken)));

      // 実行
      const error = expectFailure(await loadLatestDefinition());

      // 検証
      expect(error.kind).toBe("invalid");
      if (error.kind === "invalid") {
        expect(error.errors.length).toBeGreaterThan(0);
        expect(error.message).toContain(error.errors[0].message);
      }
    });

    it("形式の版が対応していない定義（schemaVersion 2）も検証の失敗にする", async () => {
      // 準備
      const future = { ...JSON.parse(JSON.stringify(summer2026Definition)), schemaVersion: 2 };
      fetchMock.mockImplementation(async () => textResponse(JSON.stringify(future)));

      // 実行
      const error = expectFailure(await loadLatestDefinition());

      // 検証
      expect(error).toMatchObject({
        kind: "invalid",
        errors: [expect.objectContaining({ code: "unsupported_version" })],
      });
    });
  });
});
