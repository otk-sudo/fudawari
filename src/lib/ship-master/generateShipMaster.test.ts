// ビルド時の艦船マスタの生成（roadmap T1-5、U1）のテスト
// 取得（fetch）と書き出し（writeFile）を差し替えて、変換・書き出し・失敗時の振る舞いを確かめる（通信もファイルの書き込みもしない）
//
// - 味方艦の隻数の下限は既定で 800 隻。手作りの断片（8 隻）で成功を確かめるテストは minShipCount に小さい値を渡す
// - 取得の失敗は再試行する（既定 3 回・待ち 2000 ミリ秒）。失敗を確かめるテストは retryDelayMs: 0 を渡して待たない
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildShipMasterEntries } from "@/domain/master/fromStart2";
import { SHIP_CLASS_NATIONALITIES } from "@/domain/master/shipClassNames";
import type { ShipMasterEntry } from "@/domain/master/types";
import {
  abyssalRow,
  friendlyRow,
  start2Fragment,
  start2FragmentClassNames,
  start2FragmentClassNationalities,
} from "@/test/fixtures/start2Fragment";
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

/**
 * 取得の 1 回ごとの結果
 * - Error：例外を投げる（通信の失敗）
 * - 数：その HTTP の状態で ok でない応答を返す
 * - 文字列：その本文で成功の応答を返す
 */
type FetchStep = Error | number | string;

/** 呼ばれるたびに steps を順に返す取得の差し替え（使い切ったら最後の結果をくり返す） */
function fetchSequence(steps: readonly FetchStep[]) {
  let index = 0;
  return vi.fn(async (): Promise<FetchResponseLike> => {
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    if (step instanceof Error) throw step;
    if (typeof step === "number") return { ok: false, status: step, text: async () => "error" };
    return { ok: true, status: 200, text: async () => step };
  });
}

/** 失敗するはずの処理の Error の文を返す（成功したら、その時点でテストを失敗させる） */
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  const [result] = await Promise.allSettled([promise]);
  expect(result.status, "失敗するはずが、成功した").toBe("rejected");
  if (result.status !== "rejected") return "";
  const reason: unknown = result.reason;
  return reason instanceof Error ? reason.message : String(reason);
}

/** 書き出しの差し替え（呼ばれた内容を記録する） */
function recordingWriteFile() {
  return vi.fn(async (path: string, content: string): Promise<void> => {
    void path;
    void content;
  });
}

/** 正しい断片の本文 */
const fragmentBody = JSON.stringify(start2Fragment);

/** 断片のうち、艦 ID が ids にある行だけを change で書き換えた本文 */
function fragmentBodyWithRow(
  ids: readonly number[],
  change: (row: Record<string, unknown>) => Record<string, unknown>,
): string {
  const rows = start2Fragment.api_mst_ship.map((row) => (ids.includes(row.api_id) ? change({ ...row }) : row));
  return JSON.stringify({ ...start2Fragment, api_mst_ship: rows });
}

/** 行から 1 つの項目を除いた写し */
function without(row: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...row };
  delete copy[key];
  return copy;
}

/** 味方艦がちょうど count 隻の start2.json の本文（艦 ID 1〜count。深海棲艦も 1 隻入れる） */
function bodyWithFriendlyCount(count: number): string {
  const rows = Array.from({ length: count }, (_, i) =>
    friendlyRow({ id: i + 1, sortno: i + 1, name: `試験艦${i + 1}`, yomi: "", stype: 2, ctype: 1, luck: [10, 49], after: "0" }),
  );
  return JSON.stringify({ api_mst_ship: [...rows, abyssalRow(1501, "駆逐イ級")] });
}

/** bodyWithFriendlyCount に合わせた艦型の名前の対応表 */
const countClassNames: ReadonlyMap<number, string> = new Map([[1, "試験型"]]);

/** 文に、数 n が（ほかの数字の一部ではなく）そのままの数として入っているか */
function containsNumber(message: string, n: number): boolean {
  return new RegExp(`(^|\\D)${n}(\\D|$)`).test(message);
}

describe("generateShipMaster（start2.json を取得して艦船マスタを書き出す）", () => {
  it("取得元は Tibowl/api_start2 の start2.json、書き出し先は public/data/ship-master.json", () => {
    expect(START2_URL).toBe("https://raw.githubusercontent.com/Tibowl/api_start2/master/start2.json");
    expect(SHIP_MASTER_OUTPUT_PATH).toBe("public/data/ship-master.json");
  });

  it("start2.json を 1 回取得し、味方艦だけのマスタを形式の版つきの JSON で書き出す", async () => {
    // 準備
    const fetch = fetchReturning(fragmentBody);
    const writeFile = recordingWriteFile();

    // 実行
    const result = await generateShipMaster({ fetch, writeFile, classNames: start2FragmentClassNames, minShipCount: 1 });

    // 検証：取得
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(START2_URL);
    // 検証：書き出し（中身は変換の関数の結果と同じ。深海棲艦 2 隻は入らない）
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, content] = writeFile.mock.calls[0];
    expect(path).toBe(SHIP_MASTER_OUTPUT_PATH);
    // （国籍の対応表は省略したので、既定の SHIP_CLASS_NATIONALITIES で変換したものと同じ。v1.1）
    expect(JSON.parse(content)).toEqual({
      schemaVersion: 1,
      ships: buildShipMasterEntries(start2Fragment, start2FragmentClassNames, SHIP_CLASS_NATIONALITIES),
    });
    // （断片の艦型 23・9 はどちらも既定の国籍の対応表にあるので、国籍の分からない艦型はない）
    expect(result).toEqual({ outputPath: SHIP_MASTER_OUTPUT_PATH, shipCount: 8, unknownNationalityClasses: [] });
  });

  it("国籍の対応表を渡すと、書き出す各艦に艦型の国籍（nationality）を入れる。形式の版は 1 のまま（v1.1）", async () => {
    // 準備
    const writeFile = recordingWriteFile();

    // 実行
    await generateShipMaster({
      fetch: fetchReturning(fragmentBody),
      writeFile,
      classNames: start2FragmentClassNames,
      classNationalities: start2FragmentClassNationalities,
      minShipCount: 1,
    });

    // 検証：時雨系（艦型 23）は日本、鈴谷系（艦型 9）はドイツ
    const file = JSON.parse(writeFile.mock.calls[0][1]) as { schemaVersion: number; ships: ShipMasterEntry[] };
    expect(file.schemaVersion).toBe(1);
    expect(file.ships.map((ship) => [ship.id, ship.nationality])).toEqual([
      [43, "japan"],
      [124, "germany"],
      [129, "germany"],
      [145, "japan"],
      [243, "japan"],
      [503, "germany"],
      [508, "germany"],
      [961, "japan"],
    ]);
  });

  it("国籍の対応表を省略すると SHIP_CLASS_NATIONALITIES を使う（艦型 23・9 はどちらも日本）。対応表にない艦型は unknown", async () => {
    // 準備：断片に、対応表にない艦型 900 の艦を足す
    const body = JSON.stringify({
      ...start2Fragment,
      api_mst_ship: [
        ...start2Fragment.api_mst_ship,
        friendlyRow({ id: 1400, sortno: 1400, name: "試験艦", yomi: "", stype: 2, ctype: 900, luck: [10, 49], after: "0" }),
      ],
    });
    const writeFile = recordingWriteFile();

    // 実行
    await generateShipMaster({ fetch: fetchReturning(body), writeFile, classNames: start2FragmentClassNames, minShipCount: 1 });

    // 検証
    const file = JSON.parse(writeFile.mock.calls[0][1]) as { ships: ShipMasterEntry[] };
    const nationalityOf = (id: number) => file.ships.find((ship) => ship.id === id)?.nationality;
    expect(nationalityOf(961)).toBe("japan");
    expect(nationalityOf(508)).toBe("japan");
    expect(nationalityOf(1400)).toBe("unknown");
  });

  // レビューの指摘：国籍の対応表にない艦型（新しい艦型など）は unknown になり、国籍の特効が効かない。
  // 生成は止めずに、どの艦型・艦が unknown になったかを結果で返す（scripts/generate-ship-master.ts が警告に出す）
  describe("国籍の対応表にない艦型の報告（unknownNationalityClasses）", () => {
    it("対応表にない艦型があれば、艦型の番号の昇順に、その艦型の艦名（艦 ID の昇順）を返す。生成は止めずに書き出す", async () => {
      // 準備：断片に、対応表にない艦型 900（艦 ID 1401・1400）と 800（艦 ID 1402）の艦を、順を崩して足す
      const extraRow = (id: number, name: string, ctype: number) =>
        friendlyRow({ id, sortno: id, name, yomi: "", stype: 2, ctype, luck: [10, 49], after: "0" });
      const body = JSON.stringify({
        ...start2Fragment,
        api_mst_ship: [
          extraRow(1401, "試験艦乙", 900),
          ...start2Fragment.api_mst_ship,
          extraRow(1402, "試験艦丙", 800),
          extraRow(1400, "試験艦甲", 900),
        ],
      });
      const writeFile = recordingWriteFile();

      // 実行
      const result = await generateShipMaster({
        fetch: fetchReturning(body),
        writeFile,
        classNames: start2FragmentClassNames,
        classNationalities: start2FragmentClassNationalities,
        minShipCount: 1,
      });

      // 検証
      expect(result.unknownNationalityClasses).toEqual([
        { shipClassId: 800, shipNames: ["試験艦丙"] },
        { shipClassId: 900, shipNames: ["試験艦甲", "試験艦乙"] },
      ]);
      expect(writeFile).toHaveBeenCalledTimes(1);
      expect(result.shipCount).toBe(11);
    });

    it("すべての艦型が対応表にあれば、空の配列を返す", async () => {
      const result = await generateShipMaster({
        fetch: fetchReturning(fragmentBody),
        writeFile: recordingWriteFile(),
        classNames: start2FragmentClassNames,
        classNationalities: start2FragmentClassNationalities,
        minShipCount: 1,
      });

      expect(result.unknownNationalityClasses).toEqual([]);
    });

    it("国籍の対応表を省略したときは、既定の SHIP_CLASS_NATIONALITIES にない艦型を返す（艦型 23・9 は既定の表にある）", async () => {
      const body = JSON.stringify({
        ...start2Fragment,
        api_mst_ship: [
          ...start2Fragment.api_mst_ship,
          friendlyRow({ id: 1400, sortno: 1400, name: "試験艦", yomi: "", stype: 2, ctype: 900, luck: [10, 49], after: "0" }),
        ],
      });

      const result = await generateShipMaster({
        fetch: fetchReturning(body),
        writeFile: recordingWriteFile(),
        classNames: start2FragmentClassNames,
        minShipCount: 1,
      });

      expect(result.unknownNationalityClasses).toEqual([{ shipClassId: 900, shipNames: ["試験艦"] }]);
    });
  });

  it("書き出し先を指定すると、そこへ書き出す", async () => {
    const writeFile = recordingWriteFile();

    await generateShipMaster({
      fetch: fetchReturning(fragmentBody),
      writeFile,
      classNames: start2FragmentClassNames,
      outputPath: "out/data/ship-master.json",
      minShipCount: 1,
    });

    expect(writeFile).toHaveBeenCalledWith("out/data/ship-master.json", expect.any(String));
  });

  // 失敗の Error の文には、何の処理で失敗したかが分かるよう「start2.json」（取得元の URL でもよい）と、元の理由を入れる
  it("通信に失敗したら、元の理由を入れた Error で失敗し、書き出さない", async () => {
    const fetch = vi.fn(async (): Promise<FetchResponseLike> => {
      throw new Error("getaddrinfo ENOTFOUND raw.githubusercontent.com");
    });
    const writeFile = recordingWriteFile();

    const message = await rejectionMessage(generateShipMaster({ fetch, writeFile, retryDelayMs: 0 }));

    expect(message).toContain("start2.json");
    expect(message).toContain("getaddrinfo ENOTFOUND raw.githubusercontent.com");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it.each([404, 500])("HTTP の状態が %i なら、状態の番号を入れた Error で失敗し、書き出さない", async (status) => {
    const writeFile = recordingWriteFile();

    const message = await rejectionMessage(
      generateShipMaster({ fetch: fetchReturning("Not Found", status), writeFile, retryDelayMs: 0 }),
    );

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
      generateShipMaster({
        fetch: fetchReturning(body),
        writeFile,
        classNames: start2FragmentClassNames,
        minShipCount: 1,
        retryDelayMs: 0,
      }),
    );

    expect(message).toContain("start2.json");
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("generateShipMaster：味方艦の隻数の下限（壊れたマスタを配らない）", () => {
  it("既定の下限は 800 隻：味方艦が 799 隻なら、隻数と下限を入れた Error で失敗し、書き出さない", async () => {
    const writeFile = recordingWriteFile();

    const message = await rejectionMessage(
      generateShipMaster({ fetch: fetchReturning(bodyWithFriendlyCount(799)), writeFile, classNames: countClassNames, retryDelayMs: 0 }),
    );

    expect(message).toContain("start2.json");
    expect(containsNumber(message, 799), `隻数 799 が入っていない：${message}`).toBe(true);
    expect(containsNumber(message, 800), `下限 800 が入っていない：${message}`).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("既定の下限ちょうど（味方艦 800 隻）なら書き出す", async () => {
    const writeFile = recordingWriteFile();

    const result = await generateShipMaster({
      fetch: fetchReturning(bodyWithFriendlyCount(800)),
      writeFile,
      classNames: countClassNames,
    });

    expect(result.shipCount).toBe(800);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("minShipCount を指定すると、その値が下限になる：味方艦 8 隻の断片で下限 9 なら失敗し、書き出さない", async () => {
    const writeFile = recordingWriteFile();

    const message = await rejectionMessage(
      generateShipMaster({
        fetch: fetchReturning(fragmentBody),
        writeFile,
        classNames: start2FragmentClassNames,
        minShipCount: 9,
        retryDelayMs: 0,
      }),
    );

    expect(message).toContain("start2.json");
    expect(containsNumber(message, 8), `隻数 8 が入っていない：${message}`).toBe(true);
    expect(containsNumber(message, 9), `下限 9 が入っていない：${message}`).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("minShipCount ちょうど（味方艦 8 隻の断片で下限 8）なら書き出す", async () => {
    const writeFile = recordingWriteFile();

    const result = await generateShipMaster({
      fetch: fetchReturning(fragmentBody),
      writeFile,
      classNames: start2FragmentClassNames,
      minShipCount: 8,
    });

    expect(result.shipCount).toBe(8);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
});

describe("generateShipMaster：味方艦の行の項目が数でない（0 で埋めて通さない）", () => {
  it.each<[string, (row: Record<string, unknown>) => Record<string, unknown>]>([
    ["api_sortno が文字列", (row) => ({ ...row, api_sortno: "343" })],
    ["api_sortno がない", (row) => without(row, "api_sortno")],
    ["api_stype が null", (row) => ({ ...row, api_stype: null })],
    ["api_ctype がない", (row) => without(row, "api_ctype")],
    ["api_ctype が文字列", (row) => ({ ...row, api_ctype: "23" })],
    ["api_luck の 0 番目が null（[null, 69]。最大値を初期値として使わない）", (row) => ({ ...row, api_luck: [null, 69] })],
    ["api_luck がない", (row) => without(row, "api_luck")],
    ["api_luck が空の配列", (row) => ({ ...row, api_luck: [] })],
    ["api_luck が配列でない", (row) => ({ ...row, api_luck: 20 })],
  ])("味方艦（時雨改三 961）の %s なら、艦 ID を入れた Error で失敗し、書き出さない", async (_label, change) => {
    const writeFile = recordingWriteFile();

    const message = await rejectionMessage(
      generateShipMaster({
        fetch: fetchReturning(fragmentBodyWithRow([961], change)),
        writeFile,
        classNames: start2FragmentClassNames,
        minShipCount: 1,
        retryDelayMs: 0,
      }),
    );

    expect(message).toContain("start2.json");
    expect(containsNumber(message, 961), `艦 ID 961 が入っていない：${message}`).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("項目が数でない味方艦の行が 2 つあれば、どちらの艦 ID も Error の文に入れる", async () => {
    const writeFile = recordingWriteFile();

    const message = await rejectionMessage(
      generateShipMaster({
        fetch: fetchReturning(fragmentBodyWithRow([43, 961], (row) => ({ ...row, api_stype: "駆逐艦" }))),
        writeFile,
        classNames: start2FragmentClassNames,
        minShipCount: 1,
        retryDelayMs: 0,
      }),
    );

    expect(containsNumber(message, 43), `艦 ID 43 が入っていない：${message}`).toBe(true);
    expect(containsNumber(message, 961), `艦 ID 961 が入っていない：${message}`).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("generateShipMaster：取得の再試行（一時的な失敗で止めない）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("通信の失敗（例外）が 2 回続いても、3 回目で取得できれば書き出して成功する", async () => {
    // 準備
    const fetch = fetchSequence([new Error("ECONNRESET 1 回目"), new Error("ECONNRESET 2 回目"), fragmentBody]);
    const writeFile = recordingWriteFile();

    // 実行
    const [result] = await Promise.allSettled([
      generateShipMaster({ fetch, writeFile, classNames: start2FragmentClassNames, minShipCount: 1, retryDelayMs: 0 }),
    ]);

    // 検証
    expect(result.status).toBe("fulfilled");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenNthCalledWith(3, START2_URL);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("ok でない応答（503）が 2 回続いても、3 回目で取得できれば書き出して成功する", async () => {
    const fetch = fetchSequence([503, 503, fragmentBody]);
    const writeFile = recordingWriteFile();

    const [result] = await Promise.allSettled([
      generateShipMaster({ fetch, writeFile, classNames: start2FragmentClassNames, minShipCount: 1, retryDelayMs: 0 }),
    ]);

    expect(result.status).toBe("fulfilled");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("すべて失敗したら、既定では最初の 1 回と再試行 3 回（計 4 回）取得し、最後の失敗の理由で失敗する。書き出さない", async () => {
    const fetch = fetchSequence([
      new Error("ECONNRESET 1 回目"),
      new Error("ECONNRESET 2 回目"),
      new Error("ECONNRESET 3 回目"),
      new Error("ETIMEDOUT 4 回目"),
    ]);
    const writeFile = recordingWriteFile();

    const message = await rejectionMessage(generateShipMaster({ fetch, writeFile, retryDelayMs: 0 }));

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(message).toContain("start2.json");
    expect(message).toContain("ETIMEDOUT 4 回目");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("ok でない応答が続いてすべて失敗したら、最後の応答の状態の番号で失敗する", async () => {
    const fetch = fetchSequence([500, 502, 503, 504]);
    const writeFile = recordingWriteFile();

    const message = await rejectionMessage(generateShipMaster({ fetch, writeFile, retryDelayMs: 0 }));

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(message).toContain("start2.json");
    expect(message).toContain("504");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("retries を 0 にすると再試行せず、1 回の取得で失敗する", async () => {
    const fetch = fetchSequence([new Error("ECONNRESET"), fragmentBody]);
    const writeFile = recordingWriteFile();

    const message = await rejectionMessage(
      generateShipMaster({ fetch, writeFile, classNames: start2FragmentClassNames, minShipCount: 1, retries: 0, retryDelayMs: 0 }),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(message).toContain("ECONNRESET");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("retries を 1 にすると、計 2 回まで取得する", async () => {
    const fetch = fetchSequence([new Error("1 回目"), new Error("2 回目"), fragmentBody]);
    const writeFile = recordingWriteFile();

    const message = await rejectionMessage(
      generateShipMaster({ fetch, writeFile, classNames: start2FragmentClassNames, minShipCount: 1, retries: 1, retryDelayMs: 0 }),
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(message).toContain("2 回目");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("既定では、再試行の前に 2000 ミリ秒待つ", async () => {
    // 準備：時計を偽物にする（待ち時間を実際には待たない）
    vi.useFakeTimers();
    const fetch = fetchSequence([new Error("ECONNRESET"), fragmentBody]);
    const writeFile = recordingWriteFile();

    // 実行
    const settled = Promise.allSettled([
      generateShipMaster({ fetch, writeFile, classNames: start2FragmentClassNames, minShipCount: 1 }),
    ]);

    // 検証：1999 ミリ秒では再試行せず、2000 ミリ秒で再試行する
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [result] = await settled;
    expect(result.status).toBe("fulfilled");
  });

  it("retryDelayMs を指定すると、再試行の前にその時間だけ待つ", async () => {
    vi.useFakeTimers();
    const fetch = fetchSequence([503, fragmentBody]);
    const writeFile = recordingWriteFile();

    const settled = Promise.allSettled([
      generateShipMaster({ fetch, writeFile, classNames: start2FragmentClassNames, minShipCount: 1, retryDelayMs: 300 }),
    ]);

    await vi.advanceTimersByTimeAsync(299);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [result] = await settled;
    expect(result.status).toBe("fulfilled");
  });
});
