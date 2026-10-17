// 画像で保存の枚数の分け方とファイル名（要件 3.9、roadmap T2-10）のテスト
import { describe, expect, it } from "vitest";
import { exportImageFileName, splitIntoImagePages } from "@/features/export-image/pages";

/** 札 ID を count 個作る（"f1"〜） */
function fudaIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `f${i + 1}`);
}

describe("画像の枚数の分け方（splitIntoImagePages）", () => {
  it("札がなければ 0 枚", () => {
    // 準備・実行・検証
    expect(splitIntoImagePages([])).toEqual([]);
  });

  it.each([1, 5, 6])("%i 札なら 1 枚にまとめる（渡した順のまま）", (count) => {
    // 準備・実行
    const pages = splitIntoImagePages(fudaIds(count));

    // 検証
    expect(pages).toEqual([fudaIds(count)]);
  });

  it("7 札なら 6 札と 1 札の 2 枚に分ける", () => {
    // 準備・実行
    const pages = splitIntoImagePages(fudaIds(7));

    // 検証
    expect(pages).toEqual([["f1", "f2", "f3", "f4", "f5", "f6"], ["f7"]]);
  });

  it("13 札なら 6・6・1 札の 3 枚に分ける", () => {
    // 準備・実行
    const pages = splitIntoImagePages(fudaIds(13));

    // 検証
    expect(pages.map((page) => page.length)).toEqual([6, 6, 1]);
    expect(pages.flat()).toEqual(fudaIds(13));
  });

  it("渡した配列を書き換えない", () => {
    // 準備
    const ids = Object.freeze(fudaIds(8));

    // 実行
    const pages = splitIntoImagePages(ids);

    // 検証
    expect(ids).toEqual(fudaIds(8));
    expect(pages.flat()).toEqual(fudaIds(8));
  });
});

describe("保存する PNG のファイル名（exportImageFileName）", () => {
  it("1 枚だけのときは「（イベント名）_札割り.png」", () => {
    // 準備・実行・検証
    expect(exportImageFileName("2026夏イベ", 1, 1)).toBe("2026夏イベ_札割り.png");
  });

  it("複数枚のときは「（イベント名）_札割り_（何枚目）.png」", () => {
    // 準備・実行・検証
    expect(exportImageFileName("2026夏イベ", 1, 2)).toBe("2026夏イベ_札割り_1.png");
    expect(exportImageFileName("2026夏イベ", 2, 2)).toBe("2026夏イベ_札割り_2.png");
  });

  it("イベント名のうちファイル名に使えない文字（\\ / : * ? \" < > |）は「_」にする", () => {
    // 準備・実行・検証
    expect(exportImageFileName('a\\b/c:d*e?f"g<h>i|j', 1, 1)).toBe("a_b_c_d_e_f_g_h_i_j_札割り.png");
  });

  it("イベント名の制御文字（改行・タブなど）も「_」にする", () => {
    // 準備・実行・検証
    expect(exportImageFileName("夏\nイベ\t2026", 1, 1)).toBe("夏_イベ_2026_札割り.png");
  });
});
