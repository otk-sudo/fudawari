import { describe, expect, it } from "vitest";
import { deepFreeze } from "@/test/fixtures/freeze";
import type { SaveLogEntry, SaveLogKind } from "./types";
import { type SaveLogFilter, viewSaveLogs } from "./view";

// 保存の記録の絞り込み・件数・8 件ずつの表示（純粋な関数 viewSaveLogs。要件 3.7「保存の記録」、roadmap T3-10）
// - 絞り込み：誰が（表示名）・種類・海域。条件はすべて満たすもの（AND）。null は「全員」「すべて」
// - 海域を選ぶと、mapLabel が null の記録（公開など）は出さない（モックの絞り込みと同じ）
// - 表示するのは絞り込んだ記録の先頭から 8 × pages 件。並びは入力（新しい順）のまま
// - matched は該当件数、hasMore は「さらに古い記録を表示」を出すか

const ALL: SaveLogFilter = { userName: null, kind: null, mapLabel: null };

/** 記録を 1 件作る（id から日時をずらし、id が大きいほど新しい） */
function entry(id: number, userName: string, kind: SaveLogKind, mapLabel: string | null): SaveLogEntry {
  const minute = String(id % 60).padStart(2, "0");
  return {
    id,
    createdAt: `2026-10-15T21:${minute}:00+09:00`,
    userName,
    kind,
    mapLabel,
    summary: `記録 ${id}`,
  };
}

/** 新しい順の記録 n 件（id は n, n-1, …, 1。人・種類・海域は id で決める） */
function entries(n: number): SaveLogEntry[] {
  return Array.from({ length: n }, (_, index) => {
    const id = n - index;
    return entry(id, `人${id % 3}`, "save", `E${(id % 3) + 1}`);
  });
}

function ids(list: readonly SaveLogEntry[]): number[] {
  return list.map((item) => item.id);
}

/**
 * 絞り込みを確かめる記録（新しい順。モックの記録をもとにした 13 件）
 * あかね：save E3・save E2・save E2・save E2 ／ 提督：save E2・publish・save E1・publish・save E1 ／ 協力者B：save E3・save E3・save E3・save E1
 */
const MIXED: readonly SaveLogEntry[] = deepFreeze([
  entry(13, "あかね", "save", "E3"),
  entry(12, "あかね", "save", "E2"),
  entry(11, "提督", "save", "E2"),
  entry(10, "協力者B", "save", "E3"),
  entry(9, "あかね", "save", "E2"),
  entry(8, "協力者B", "save", "E3"),
  entry(7, "提督", "publish", null),
  entry(6, "提督", "save", "E1"),
  entry(5, "あかね", "save", "E2"),
  entry(4, "協力者B", "save", "E3"),
  entry(3, "提督", "publish", null),
  entry(2, "協力者B", "save", "E1"),
  entry(1, "提督", "save", "E1"),
]);

describe("保存の記録の表示（viewSaveLogs）", () => {
  describe("8 件ずつの表示と件数", () => {
    it("絞り込みなし・1 ページ目：20 件のうち新しい 8 件を入力の順のまま出し、該当件数は 20、まだ古い記録がある", () => {
      // 準備
      const list = deepFreeze(entries(20));

      // 実行
      const view = viewSaveLogs(list, ALL, 1);

      // 検証
      expect(ids(view.shown)).toEqual([20, 19, 18, 17, 16, 15, 14, 13]);
      expect(view.matched).toBe(20);
      expect(view.hasMore).toBe(true);
    });

    it("2 ページ目は 16 件、3 ページ目は残りを含めた 20 件で、古い記録はもうない", () => {
      // 準備
      const list = deepFreeze(entries(20));

      // 実行
      const second = viewSaveLogs(list, ALL, 2);
      const third = viewSaveLogs(list, ALL, 3);

      // 検証
      expect(ids(second.shown)).toEqual(ids(list.slice(0, 16)));
      expect(second.hasMore).toBe(true);
      expect(ids(third.shown)).toEqual(ids(list));
      expect(third.matched).toBe(20);
      expect(third.hasMore).toBe(false);
    });

    it("ちょうど 8 件なら 1 ページ目で全部出し、古い記録はない（境界）", () => {
      // 準備
      const list = deepFreeze(entries(8));

      // 実行
      const view = viewSaveLogs(list, ALL, 1);

      // 検証
      expect(view.shown).toHaveLength(8);
      expect(view.matched).toBe(8);
      expect(view.hasMore).toBe(false);
    });

    it("9 件なら 1 ページ目は 8 件で、古い記録が 1 件残る（境界）", () => {
      // 準備
      const list = deepFreeze(entries(9));

      // 実行
      const view = viewSaveLogs(list, ALL, 1);

      // 検証
      expect(ids(view.shown)).toEqual([9, 8, 7, 6, 5, 4, 3, 2]);
      expect(view.matched).toBe(9);
      expect(view.hasMore).toBe(true);
    });

    it("記録がなければ、出す記録は空・該当 0 件・古い記録なし", () => {
      // 実行
      const view = viewSaveLogs([], ALL, 1);

      // 検証
      expect(view.shown).toEqual([]);
      expect(view.matched).toBe(0);
      expect(view.hasMore).toBe(false);
    });
  });

  describe("絞り込み", () => {
    it("誰が：その表示名の記録だけを、新しい順のまま出す", () => {
      // 実行
      const view = viewSaveLogs(MIXED, { ...ALL, userName: "あかね" }, 1);

      // 検証
      expect(ids(view.shown)).toEqual([13, 12, 9, 5]);
      expect(view.matched).toBe(4);
      expect(view.hasMore).toBe(false);
    });

    it("種類：公開だけ／下書き保存だけを出す", () => {
      // 実行
      const published = viewSaveLogs(MIXED, { ...ALL, kind: "publish" }, 1);
      const saved = viewSaveLogs(MIXED, { ...ALL, kind: "save" }, 1);

      // 検証
      expect(ids(published.shown)).toEqual([7, 3]);
      expect(published.matched).toBe(2);
      expect(saved.matched).toBe(11);
      expect(ids(saved.shown)).toEqual([13, 12, 11, 10, 9, 8, 6, 5]);
      expect(saved.hasMore).toBe(true);
    });

    it("海域：その海域の記録だけを出し、海域のない記録（公開）は出さない", () => {
      // 実行
      const view = viewSaveLogs(MIXED, { ...ALL, mapLabel: "E1" }, 1);

      // 検証
      expect(ids(view.shown)).toEqual([6, 2, 1]);
      expect(view.matched).toBe(3);
    });

    it("条件を重ねると、すべてを満たす記録だけを出す", () => {
      // 実行
      const view = viewSaveLogs(MIXED, { userName: "提督", kind: "save", mapLabel: "E1" }, 1);

      // 検証
      expect(ids(view.shown)).toEqual([6, 1]);
      expect(view.matched).toBe(2);
    });

    it("どれにも合わなければ、出す記録は空・該当 0 件・古い記録なし", () => {
      // 実行
      const view = viewSaveLogs(MIXED, { ...ALL, userName: "協力者B", kind: "publish" }, 1);

      // 検証
      expect(view.shown).toEqual([]);
      expect(view.matched).toBe(0);
      expect(view.hasMore).toBe(false);
    });

    it("絞り込んだ記録に対して 8 件ずつ数える（下書き保存 11 件の 2 ページ目は 11 件で、古い記録なし）", () => {
      // 実行
      const view = viewSaveLogs(MIXED, { ...ALL, kind: "save" }, 2);

      // 検証
      expect(view.shown).toHaveLength(11);
      expect(view.matched).toBe(11);
      expect(view.hasMore).toBe(false);
    });

    it("入力の記録を書き換えない（凍結した入力でも例外にならず、記録は同じ値のまま返す）", () => {
      // 実行
      const view = viewSaveLogs(MIXED, { ...ALL, userName: "提督" }, 1);

      // 検証
      expect(view.shown[0]).toEqual(entry(11, "提督", "save", "E2"));
      expect(MIXED).toHaveLength(13);
    });
  });
});
