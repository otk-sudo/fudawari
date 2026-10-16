// 艦船マスタの入口（src/domain/master/index.ts）から読み込めるもののテスト
// 画面・生成の処理が個別のファイルではなく入口から読み込めるよう、公開する関数がそろっていることを確かめる
import { describe, expect, it } from "vitest";
import { buildShipMasterEntries, readStart2 } from "./fromStart2";
import * as masterEntry from "./index";
import { baseNameOfShipName } from "./nameIndex";

/** 入口から読み込める値（名前 → 値）。まだ入口にない名前でも型の誤りにせず、値がないことで確かめる */
const exported: Record<string, unknown> = { ...masterEntry };

describe("艦船マスタの入口（index.ts）", () => {
  it.each<[string, string, unknown]>([
    ["baseNameOfShipName", "nameIndex", baseNameOfShipName],
    ["buildShipMasterEntries", "fromStart2", buildShipMasterEntries],
    ["readStart2", "fromStart2", readStart2],
  ])("%s（%s）を入口から読み込める（個別のファイルの関数と同じもの）", (name, _file, original) => {
    expect(exported[name], `入口から ${name} を読み込めない`).toBe(original);
  });
});
