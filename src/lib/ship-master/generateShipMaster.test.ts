// ビルド時の艦船マスタの生成（roadmap T1-5、U1）のテスト
// 取得（fetch）と書き出し（writeFile）を差し替えて、変換・書き出し・失敗時の振る舞いを確かめる（通信もファイルの書き込みもしない）
import { describe, expect, it, vi } from "vitest";
import { buildShipMasterEntries } from "@/domain/master/fromStart2";
import { abyssalRow, start2Fragment, start2FragmentClassNames } from "@/test/fixtures/start2Fragment";
import {
  type FetchResponseLike,
  type GenerateShipMasterDeps,
  generateShipMaster,
  SHIP_MASTER_OUTPUT_PATH,
  START2_URL,
} from "./generateShipMaster";

/** 決まった本文を返す取得の差し替え */
function fetchReturning(body: string, status = 200): GenerateShipMasterDeps["fetch"] {
  return vi.fn(
    async (): Promise<FetchResponseLike> => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    }),
  );
}

/** 失敗するはずの処理の Error の文を返す（成功したらテストを失敗させる） */
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("失敗するはずが、成功した");
}

/** 書き出しの差し替え（呼ばれた内容を記録する） */
function recordingWriteFile() {
  return vi.fn(async (path: string, content: string): Promise<void> => {
    void path;
    void content;
  });
}

describe("generateShipMaster（start2.json を取得して艦船マスタを書き出す）", () => {
  it("取得元は Tibowl/api_start2 の start2.json、書き出し先は public/data/ship-master.json", () => {
    expect(START2_URL).toBe("https://raw.githubusercontent.com/Tibowl/api_start2/master/start2.json");
    expect(SHIP_MASTER_OUTPUT_PATH).toBe("public/data/ship-master.json");
  });

  it("start2.json を 1 回取得し、味方艦だけのマスタを形式の版つきの JSON で書き出す", async () => {
    // 準備
    const fetch = fetchReturning(JSON.stringify(start2Fragment));
    const writeFile = recordingWriteFile();

    // 実行
    const result = await generateShipMaster({ fetch, writeFile, classNames: start2FragmentClassNames });

    // 検証：取得
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(START2_URL);
    // 検証：書き出し（中身は変換の関数の結果と同じ。深海棲艦 2 隻は入らない）
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, content] = writeFile.mock.calls[0];
    expect(path).toBe(SHIP_MASTER_OUTPUT_PATH);
    expect(JSON.parse(content)).toEqual({
      schemaVersion: 1,
      ships: buildShipMasterEntries(start2Fragment, start2FragmentClassNames),
    });
    expect(result).toEqual({ outputPath: SHIP_MASTER_OUTPUT_PATH, shipCount: 8 });
  });

  it("書き出し先を指定すると、そこへ書き出す", async () => {
    const writeFile = recordingWriteFile();

    await generateShipMaster({
      fetch: fetchReturning(JSON.stringify(start2Fragment)),
      writeFile,
      classNames: start2FragmentClassNames,
      outputPath: "out/data/ship-master.json",
    });

    expect(writeFile).toHaveBeenCalledWith("out/data/ship-master.json", expect.any(String));
  });

  // 失敗の Error の文には、何の処理で失敗したかが分かるよう「start2.json」（取得元の URL でもよい）と、元の理由を入れる
  it("通信に失敗したら、元の理由を入れた Error で失敗し、書き出さない", async () => {
    const fetch = vi.fn(async (): Promise<FetchResponseLike> => {
      throw new Error("getaddrinfo ENOTFOUND raw.githubusercontent.com");
    });
    const writeFile = recordingWriteFile();

    const message = await rejectionMessage(generateShipMaster({ fetch, writeFile }));

    expect(message).toContain("start2.json");
    expect(message).toContain("getaddrinfo ENOTFOUND raw.githubusercontent.com");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it.each([404, 500])("HTTP の状態が %i なら、状態の番号を入れた Error で失敗し、書き出さない", async (status) => {
    const writeFile = recordingWriteFile();

    const message = await rejectionMessage(generateShipMaster({ fetch: fetchReturning("Not Found", status), writeFile }));

    expect(message).toContain("start2.json");
    expect(message).toContain(String(status));
    expect(writeFile).not.toHaveBeenCalled();
  });

  it.each<[string, string]>([
    ["JSON として読めない", "<!DOCTYPE html><html>"],
    ["api_mst_ship がない", JSON.stringify({ api_mst_stype: [] })],
    ["api_mst_ship が配列でない", JSON.stringify({ api_mst_ship: {} })],
    ["味方艦が 1 隻もない", JSON.stringify({ api_mst_ship: [abyssalRow(1501, "駆逐イ級")] })],
  ])("%s ときは Error で失敗し、書き出さない（壊れたマスタを配らない）", async (_label, body) => {
    const writeFile = recordingWriteFile();

    const message = await rejectionMessage(
      generateShipMaster({ fetch: fetchReturning(body), writeFile, classNames: start2FragmentClassNames }),
    );

    expect(message).toContain("start2.json");
    expect(writeFile).not.toHaveBeenCalled();
  });
});
