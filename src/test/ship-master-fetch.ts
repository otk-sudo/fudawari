// 艦船マスタの取得（fetch）を差し替えるテスト用の部品
//
// fetch の差し替えそのもの（stubFetch・textResponse・respondWithStatus・failNetwork・holdFetch・requestedPaths）は
// src/test/definition-fetch.ts のものを使う。ここには艦船マスタのファイルの中身を作る補助だけを置く。
import type { ShipMasterEntry } from "@/domain/master";
import { summer2026MasterEntries } from "@/test/fixtures";
import { type FetchMock, textResponse } from "./definition-fetch";

/** 艦船マスタのファイルの中身（generateShipMaster.ts が書き出す形。JSON にする前の値） */
export interface ShipMasterFileJson {
  schemaVersion: number;
  ships: ShipMasterEntry[];
}

/** 艦船マスタのファイルの中身を作る（既定はテスト用の仮マスタの行。行は複製するので書き換えてよい） */
export function shipMasterFileOf(
  entries: readonly ShipMasterEntry[] = summer2026MasterEntries,
): ShipMasterFileJson {
  return { schemaVersion: 1, ships: entries.map((entry) => ({ ...entry })) };
}

/** 艦船マスタのファイルを JSON にして返す（呼ばれるたびに新しい応答を作る。応答の本文は 1 回しか読めないため） */
export function respondWithShipMaster(
  fetchMock: FetchMock,
  file: unknown = shipMasterFileOf(),
): void {
  fetchMock.mockImplementation(async () => textResponse(JSON.stringify(file)));
}

/**
 * 状態コードは成功（200）だが、本文の受信の途中で通信が切れる応答（text() が失敗する）。
 * Response の本文の読み取りの失敗を確実に起こすため、使う部分（ok・status・text）だけを持つ偽物を返す
 */
export function brokenBodyResponse(): Response {
  const fake = {
    ok: true,
    status: 200,
    text: async (): Promise<string> => {
      throw new TypeError("network error");
    },
    json: async (): Promise<unknown> => {
      throw new TypeError("network error");
    },
  };
  return fake as unknown as Response;
}
