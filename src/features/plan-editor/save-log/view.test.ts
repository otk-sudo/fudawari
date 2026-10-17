import { describe, expect, it } from "vitest";
import { deepFreeze } from "@/test/fixtures/freeze";
import type { SaveLogEntry, SaveLogKind } from "./types";
import { type SaveLogFilter, type SaveLogMember, type SaveLogUserOption, saveLogUserOptions, viewSaveLogs } from "./view";

// 保存の記録の絞り込み・件数・8 件ずつの表示（純粋な関数 viewSaveLogs。要件 3.7「保存の記録」、roadmap T3-10）
// - 絞り込み：誰が（利用者の ID。PR-12b）・種類・海域。条件はすべて満たすもの（AND）。null は「全員」「すべて」
// - 海域を選ぶと、mapLabel が null の記録（公開など）は出さない（モックの絞り込みと同じ）
// - 表示するのは絞り込んだ記録の先頭から 8 × pages 件。並びは入力（新しい順）のまま
// - matched は該当件数、hasMore は「さらに古い記録を表示」を出すか
// - 「誰が」の選択肢（saveLogUserOptions。PR-12b）：記録に現れる人だけを、編集できる人の並びで。外された人は後ろ。
//   利用者の ID で見分ける（同じ表示名の 2 人は別の選択肢）。ID の分からない記録（user_id が null）は表示名ごとに 1 つ
//
// PR-12b で変えたこと（Codex #21-4301315082）：「誰が」の絞り込みを表示名（filter.userName）から利用者の ID（filter.user）にした。
// そのため、表示名で絞り込んでいた既存のテスト 4 件（誰が・条件を重ねる・どれにも合わない・書き換えない）を filter.user で書き直した。
// filter.userName は実装担当が消す（そのときは下の ALL の userName: null も消す）

const ALL: SaveLogFilter = { userName: null, user: null, kind: null, mapLabel: null };

/** 表示名から利用者の ID（テスト用の人） */
const USER_IDS: Readonly<Record<string, string>> = {
  あかね: "user-akane",
  提督: "user-admiral",
  協力者B: "user-b",
};

/** 「誰が」の選択肢（ID のある人） */
function who(name: string, userId: string = USER_IDS[name] ?? `user-${name}`): SaveLogUserOption {
  return { userId, name };
}

/** 記録を 1 件作る（id から日時をずらし、id が大きいほど新しい） */
function entry(
  id: number,
  userName: string,
  kind: SaveLogKind,
  mapLabel: string | null,
  userId: string | null = USER_IDS[userName] ?? `user-${userName}`,
): SaveLogEntry {
  const minute = String(id % 60).padStart(2, "0");
  return {
    id,
    createdAt: `2026-10-15T21:${minute}:00+09:00`,
    userId,
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
    it("誰が：選んだ人（利用者の ID）の記録だけを、新しい順のまま出す", () => {
      // 実行
      const view = viewSaveLogs(MIXED, { ...ALL, user: who("あかね") }, 1);

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
      const view = viewSaveLogs(MIXED, { ...ALL, user: who("提督"), kind: "save", mapLabel: "E1" }, 1);

      // 検証
      expect(ids(view.shown)).toEqual([6, 1]);
      expect(view.matched).toBe(2);
    });

    it("どれにも合わなければ、出す記録は空・該当 0 件・古い記録なし", () => {
      // 実行
      const view = viewSaveLogs(MIXED, { ...ALL, user: who("協力者B"), kind: "publish" }, 1);

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
      const view = viewSaveLogs(MIXED, { ...ALL, user: who("提督") }, 1);

      // 検証
      expect(view.shown[0]).toEqual(entry(11, "提督", "save", "E2"));
      expect(MIXED).toHaveLength(13);
    });
  });
});

describe("保存の記録の「誰が」を利用者の ID で見分ける（PR-12b：Codex #21-4301315082・レビュー M2）", () => {
  describe("絞り込み（viewSaveLogs の filter.user）", () => {
    /** 同じ表示名「あかね」の 2 人（user-akane・user-akane2）と、ID の分からない記録（旧協力者）を含む記録（新しい順） */
    const SAME_NAMES: readonly SaveLogEntry[] = deepFreeze([
      entry(6, "あかね", "save", "E3", "user-akane2"),
      entry(5, "あかね", "save", "E2", "user-akane"),
      entry(4, "旧協力者", "save", "E1", null),
      entry(3, "あかね", "save", "E1", "user-akane2"),
      entry(2, "旧協力者", "save", "E2", null),
      entry(1, "あかね", "save", "E1", "user-akane"),
    ]);

    it("同じ表示名でも、選んだ人（ID）の記録だけを出す（もう 1 人の同じ名前の記録は出さない）", () => {
      // 実行
      const first = viewSaveLogs(SAME_NAMES, { ...ALL, user: who("あかね", "user-akane") }, 1);
      const second = viewSaveLogs(SAME_NAMES, { ...ALL, user: who("あかね", "user-akane2") }, 1);

      // 検証
      expect(ids(first.shown)).toEqual([5, 1]);
      expect(first.matched).toBe(2);
      expect(ids(second.shown)).toEqual([6, 3]);
      expect(second.matched).toBe(2);
    });

    it("ID の分からない記録（user_id が null）は、表示名でまとめて選ぶ", () => {
      // 実行
      const view = viewSaveLogs(SAME_NAMES, { ...ALL, user: { userId: null, name: "旧協力者" } }, 1);

      // 検証
      expect(ids(view.shown)).toEqual([4, 2]);
      expect(view.matched).toBe(2);
    });
  });

  describe("「誰が」の選択肢（saveLogUserOptions）", () => {
    const MEMBER_LIST: readonly SaveLogMember[] = deepFreeze([
      { userId: "user-admiral", displayName: "提督" },
      { userId: "user-akane", displayName: "あかね" },
      { userId: "user-b", displayName: "協力者B" },
    ]);

    it("並びは編集できる人の並び（記録に現れた順ではない）", () => {
      // 準備：新しい順に 協力者B・提督・あかね
      const logs = deepFreeze([entry(3, "協力者B", "save", "E1"), entry(2, "提督", "save", "E1"), entry(1, "あかね", "save", "E1")]);

      // 実行
      const options = saveLogUserOptions(logs, MEMBER_LIST);

      // 検証
      expect(options).toEqual([who("提督"), who("あかね"), who("協力者B")]);
    });

    it("記録にいない人は出さない", () => {
      // 準備：あかねの記録だけ
      const logs = deepFreeze([entry(2, "あかね", "save", "E1"), entry(1, "あかね", "publish", null)]);

      // 実行
      const options = saveLogUserOptions(logs, MEMBER_LIST);

      // 検証
      expect(options).toEqual([who("あかね")]);
    });

    it("外された人（編集できる人にいない ID）は後ろに、記録に現れた順（新しい順）で足す。表示名は記録の名前", () => {
      // 準備：外された 2 人（user-gone1 が新しい）
      const logs = deepFreeze([
        entry(4, "去った人1", "save", "E1", "user-gone1"),
        entry(3, "協力者B", "save", "E1"),
        entry(2, "去った人2", "save", "E1", "user-gone2"),
        entry(1, "提督", "save", "E1"),
      ]);

      // 実行
      const options = saveLogUserOptions(logs, MEMBER_LIST);

      // 検証
      expect(options).toEqual([
        who("提督"),
        who("協力者B"),
        who("去った人1", "user-gone1"),
        who("去った人2", "user-gone2"),
      ]);
    });

    it("同じ人（同じ ID）は 1 つにする（記録が何件あっても、編集できる人の一覧に重なっていても）", () => {
      // 準備
      const logs = deepFreeze([
        entry(4, "あかね", "save", "E1"),
        entry(3, "去った人", "save", "E2", "user-gone"),
        entry(2, "あかね", "save", "E2"),
        entry(1, "去った人", "save", "E3", "user-gone"),
      ]);
      const doubled = deepFreeze([...MEMBER_LIST, { userId: "user-akane", displayName: "あかね" }]);

      // 実行
      const options = saveLogUserOptions(logs, doubled);

      // 検証
      expect(options).toEqual([who("あかね"), who("去った人", "user-gone")]);
    });

    it("同じ表示名の 2 人は、ID ごとに別の選択肢にする（編集できる人の並びのまま）", () => {
      // 準備
      const members = deepFreeze([
        { userId: "user-akane", displayName: "あかね" },
        { userId: "user-akane2", displayName: "あかね" },
      ]);
      const logs = deepFreeze([entry(2, "あかね", "save", "E1", "user-akane2"), entry(1, "あかね", "save", "E1", "user-akane")]);

      // 実行
      const options = saveLogUserOptions(logs, members);

      // 検証
      expect(options).toEqual([who("あかね", "user-akane"), who("あかね", "user-akane2")]);
    });

    it("ID の分からない記録（user_id が null）は、表示名ごとに 1 つにまとめて後ろに足す", () => {
      // 準備
      const logs = deepFreeze([
        entry(3, "旧協力者", "save", "E1", null),
        entry(2, "提督", "save", "E1"),
        entry(1, "旧協力者", "save", "E2", null),
      ]);

      // 実行
      const options = saveLogUserOptions(logs, MEMBER_LIST);

      // 検証
      expect(options).toEqual([who("提督"), { userId: null, name: "旧協力者" }]);
    });

    it("編集できる人の表示名を使う（記録の名前が保存した時点の古い名前でも、今の名前で出す）", () => {
      // 準備：あかねは記録の時点では「茜」だった
      const logs = deepFreeze([entry(1, "茜", "save", "E1", "user-akane")]);

      // 実行
      const options = saveLogUserOptions(logs, MEMBER_LIST);

      // 検証
      expect(options).toEqual([who("あかね")]);
    });

    it("記録がなければ空", () => {
      // 実行・検証
      expect(saveLogUserOptions([], MEMBER_LIST)).toEqual([]);
    });
  });
});
