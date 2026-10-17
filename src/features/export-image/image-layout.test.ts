// 画像の寸法と、札の列に載せる艦の数（image-layout.ts。要件 3.9、U15）のテスト
import { describe, expect, it } from "vitest";
import {
  areaRowHeight,
  fitShipsInColumn,
  isCompactTimeline,
  shipRowCapacity,
} from "@/features/export-image/image-layout";

describe("海域の行の高さ（areaRowHeight）と、攻略の流れを詰めて書くか（isCompactTimeline）", () => {
  it.each([1, 3, 5])("海域が %i つまでは 44px で、段階を 2 行で書く", (areaCount) => {
    // 準備・実行・検証
    expect(areaRowHeight(areaCount)).toBe(44);
    expect(isCompactTimeline(areaCount)).toBe(false);
  });

  it("海域が 6 つなら行を低くする（35px）が、まだ 2 行で書ける", () => {
    // 準備・実行・検証
    expect(areaRowHeight(6)).toBe(35);
    expect(isCompactTimeline(6)).toBe(false);
  });

  it.each([7, 8, 12])("海域が %i つなら、札名と段階名を 1 行に詰めて書く（行は 26px より低くしない）", (areaCount) => {
    // 準備・実行
    const height = areaRowHeight(areaCount);

    // 検証
    expect(height).toBeGreaterThanOrEqual(26);
    expect(height).toBeLessThan(34);
    expect(isCompactTimeline(areaCount)).toBe(true);
  });
});

describe("札の列に入る艦の行の数（shipRowCapacity）", () => {
  it.each<[number, number]>([
    [3, 12],
    [4, 11],
    [5, 9],
  ])("海域が %i つなら %i 行", (areaCount, rows) => {
    // 準備・実行・検証
    expect(shipRowCapacity(areaCount)).toBe(rows);
  });

  it("海域が多くても 1 行以上", () => {
    // 準備・実行・検証
    expect(shipRowCapacity(30)).toBeGreaterThanOrEqual(1);
  });
});

describe("列に載せる艦の数（fitShipsInColumn。U15）", () => {
  it("入るならすべて載せ、「ほか n 隻」は書かない", () => {
    // 準備・実行・検証
    expect(fitShipsInColumn(12, 12)).toEqual({ shown: 12, rest: 0 });
    expect(fitShipsInColumn(0, 12)).toEqual({ shown: 0, rest: 0 });
  });

  it("入らなければ、最後の 1 行を「ほか n 隻」にして、その上に入るだけ載せる", () => {
    // 準備・実行・検証
    expect(fitShipsInColumn(13, 12)).toEqual({ shown: 11, rest: 2 });
    expect(fitShipsInColumn(40, 12)).toEqual({ shown: 11, rest: 29 });
  });
});
