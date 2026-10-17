import { describe, expect, it } from "vitest";
import { nationalityMasterEntries, summer2026MasterEntries } from "@/test/fixtures";
import { baseNameOf, boostTargetOf, createShipMaster, lookupShip } from "./master";
import type { RemodelStage } from "./types";

describe("艦船マスタの参照", () => {
  it("艦 ID から艦名・改装段階を問わない艦名・艦種・艦型・国籍・改造状態・図鑑番号・運の初期値・読みを引ける", () => {
    // 準備
    const master = createShipMaster(summer2026MasterEntries);

    // 実行
    const shigureKai2 = lookupShip(master, 145);

    // 検証
    expect(shigureKai2).toEqual({
      known: true,
      id: 145,
      name: "時雨改二",
      baseName: "時雨",
      yomi: "しぐれ",
      shipTypeId: 2,
      shipClassId: 23,
      shipClassName: "白露型",
      nationality: "japan", // v1.1
      remodelStage: "intermediate",
      sortNo: 1003,
      luckBase: 15,
    });
  });

  it.each<[number, string, RemodelStage]>([
    [43, "時雨", "unremodeled"],
    [243, "時雨改", "intermediate"],
    [145, "時雨改二", "intermediate"],
    [961, "時雨改三", "final"],
  ])("時雨系の艦 ID %i（%s）は改造状態 %s で、改装段階を問わない艦名は「時雨」", (id, name, remodelStage) => {
    const master = createShipMaster(summer2026MasterEntries);

    expect(lookupShip(master, id)).toMatchObject({ known: true, name, baseName: "時雨", remodelStage });
  });

  it("知らない艦 ID は例外を投げず「名前が分からない艦」として返す", () => {
    const master = createShipMaster(summer2026MasterEntries);

    expect(lookupShip(master, 99999)).toEqual({ known: false, id: 99999, name: "名前が分からない艦" });
  });

  it("空のマスタでは、どの艦 ID も「名前が分からない艦」になる", () => {
    const master = createShipMaster([]);

    expect(lookupShip(master, 145)).toEqual({ known: false, id: 145, name: "名前が分からない艦" });
  });

  it.each<[number, string | null]>([
    [961, "時雨"], // 時雨改三
    [228, "雪風"], // 雪風改
    [419, "初霜"], // 初霜改二
    [184, "大鯨"], // 大鯨（未改造の艦は自分の名前）
    [99999, null], // マスタにない艦
  ])("baseNameOf：艦 ID %i の改装段階を問わない艦名は %s", (id, expected) => {
    const master = createShipMaster(summer2026MasterEntries);

    expect(baseNameOf(master, id)).toBe(expected);
  });
});

describe("boostTargetOf（特効の照合に使う、改装段階を問わない艦名と国籍。v1.1）", () => {
  const master = createShipMaster([...summer2026MasterEntries, ...nationalityMasterEntries]);

  it.each<[number, string, string]>([
    [961, "時雨", "japan"], // 時雨改三
    [419, "初霜", "japan"], // 初霜改二
    [440, "Iowa", "usa"], // Iowa改
    [364, "Warspite", "uk"], // Warspite改
    [1499, "謎の艦", "unknown"], // 国籍の分からない艦（マスタにはある）
  ])("艦 ID %i は 艦名「%s」・国籍 %s", (id, baseName, nationality) => {
    expect(boostTargetOf(master, id)).toMatchObject({ baseName, nationality });
  });

  it("マスタにない艦 ID は null（どこにも効かない）", () => {
    expect(boostTargetOf(master, 99999)).toBeNull();
  });

  it("空のマスタでは、どの艦 ID も null", () => {
    expect(boostTargetOf(createShipMaster([]), 961)).toBeNull();
  });
});
