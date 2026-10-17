// 取り込みデータの解析（roadmap T2-1、要件 3.4、U8・U9）のテスト
import { describe, expect, it } from "vitest";
import { createShipMaster } from "@/domain/master/master";
import type { OwnedShip } from "@/domain/ship/types";
import { summer2026MasterEntries } from "@/test/fixtures";
import {
  compactShip,
  kyouka,
  standardCompactText,
  standardSamples,
  standardSvdataText,
  svShip,
  toCompactText,
  toSvdataText,
} from "@/test/fixtures/importSamples";
import { parseImportText } from "./parse";
import type { ImportFailureReason, ImportFilter, ImportParseResult, ImportSuccess } from "./types";

const master = createShipMaster(summer2026MasterEntries);

/** すべての艦・Lv 1 以上（絞り込まない） */
const ALL: ImportFilter = { lockedOnly: false, minLevel: 1 };

/** 成功していることを確かめ、成功の結果として返す */
function expectSuccess(result: ImportParseResult): ImportSuccess {
  if (!result.ok) {
    throw new Error(`解析に成功するはずが、失敗した（理由：${result.reason}）`);
  }
  return result;
}

/** 個体 ID の一覧 */
function uidsOf(ships: readonly OwnedShip[]): string[] {
  return ships.map((s) => s.uid);
}

/** 標準のサンプル（fixtures/importSamples.ts）を絞り込まずに読んだときの個体 */
const standardShips: OwnedShip[] = [
  { uid: "101", shipId: 961, level: 175, luck: 59, sallyArea: 0 },
  { uid: "102", shipId: 145, level: 99, luck: 22, sallyArea: 3 },
  { uid: "103", shipId: 656, level: 168, luck: 72, sallyArea: 0 },
  { uid: "104", shipId: 99999, level: 50, luck: 5, sallyArea: 2 },
  { uid: "105", shipId: 419, level: 98, luck: 20, sallyArea: 0 },
];

describe("parseImportText：svdata= 形式", () => {
  it("api_data.api_ship から個体の一覧（個体 ID・艦の ID・Lv・運の表示値・出撃札）を入力の順に作る", () => {
    // 実行
    const result = expectSuccess(parseImportText(standardSvdataText, master, ALL));

    // 検証：運の表示値＝マスタの運の初期値＋api_kyouka[4]。艦の ID が 0 の要素（106）は飛ばす
    expect(result.ships).toEqual(standardShips);
    expect(result.format).toBe("svdata");
  });

  it("名前が分からない艦の数と、札が付いている艦の数を返す", () => {
    const result = expectSuccess(parseImportText(standardSvdataText, master, ALL));

    expect(result.unknownShipCount).toBe(1); // 104（艦 ID 99999）
    expect(result.taggedShipCount).toBe(2); // 102（札 3）・104（札 2）
  });

  it("個体 ID とロックの情報がある形式として返す（割り当てを引き継げる）", () => {
    const result = expectSuccess(parseImportText(standardSvdataText, master, ALL));

    expect(result.hasUid).toBe(true);
    expect(result.hasLockInfo).toBe(true);
    expect(result.lockFilterIgnored).toBe(false);
  });

  it("「ロック済みだけ」では api_locked が 1 の艦だけを取り込み、件数も絞り込んだ後の艦で数える", () => {
    const result = expectSuccess(parseImportText(standardSvdataText, master, { lockedOnly: true, minLevel: 1 }));

    expect(uidsOf(result.ships)).toEqual(["101", "102", "104"]);
    expect(result.unknownShipCount).toBe(1);
    expect(result.taggedShipCount).toBe(2);
    expect(result.lockFilterIgnored).toBe(false);
  });

  it("Lv 下限ちょうどの艦は取り込み、下限より低い艦は除く", () => {
    // 102 は Lv 99（取り込む）、105 は Lv 98（除く）
    const result = expectSuccess(parseImportText(standardSvdataText, master, { lockedOnly: false, minLevel: 99 }));

    expect(uidsOf(result.ships)).toEqual(["101", "102", "103"]);
    expect(result.unknownShipCount).toBe(0);
    expect(result.taggedShipCount).toBe(1);
  });

  it("「ロック済みだけ」と Lv 下限を両方指定すると、両方を満たす艦だけになる", () => {
    const result = expectSuccess(parseImportText(standardSvdataText, master, { lockedOnly: true, minLevel: 99 }));

    expect(uidsOf(result.ships)).toEqual(["101", "102"]);
  });

  // 仕様の変更（PR-04a のレビュー対応、2026-10-17 親が決定）：以前は「成功として 0 隻を返す」だった。
  // 0 隻の取り込みを保存すると、割り当てが知らせずに全部外れるため、失敗（noShips）にする
  it("条件に合う艦が 1 隻もなければ、失敗（理由 noShips）を返す", () => {
    const result = parseImportText(standardSvdataText, master, { lockedOnly: false, minLevel: 185 });

    expect(result).toEqual({ ok: false, reason: "noShips" });
  });

  it("Lv 下限で 1 隻だけ残るなら成功（0 隻との境界）", () => {
    // 101 だけが Lv 175
    const result = expectSuccess(parseImportText(standardSvdataText, master, { lockedOnly: false, minLevel: 175 }));

    expect(uidsOf(result.ships)).toEqual(["101"]);
  });

  it("同じ個体 ID（api_id）の要素が 2 つあれば、先の要素を使う", () => {
    const text = toSvdataText([
      svShip({ api_id: 5, api_ship_id: 145, api_lv: 80 }),
      svShip({ api_id: 6, api_ship_id: 961, api_lv: 90 }),
      svShip({ api_id: 5, api_ship_id: 961, api_lv: 120 }), // 個体 ID 5 の 2 つ目 → 使わない
    ]);

    const result = expectSuccess(parseImportText(text, master, ALL));

    expect(result.ships.map(({ uid, shipId, level }) => ({ uid, shipId, level }))).toEqual([
      { uid: "5", shipId: 145, level: 80 },
      { uid: "6", shipId: 961, level: 90 },
    ]);
  });

  it("api_ship_id が 0・欠けている要素と、オブジェクトでない要素は飛ばす", () => {
    const text = toSvdataText([
      svShip({ api_id: 1, api_ship_id: 0, api_lv: 50 }),
      svShip({ api_id: 2, api_lv: 50 }), // api_ship_id がない
      null,
      "時雨",
      svShip({ api_id: 3, api_ship_id: 145, api_lv: 50 }),
    ]);

    const result = expectSuccess(parseImportText(text, master, ALL));

    expect(uidsOf(result.ships)).toEqual(["3"]);
  });

  it("api_kyouka がない艦の運は運の初期値のまま、api_sally_area がない・null の艦の札は 0", () => {
    const text = toSvdataText([
      svShip({ api_id: 1, api_ship_id: 961, api_lv: 100, api_kyouka: undefined, api_sally_area: undefined }),
      svShip({ api_id: 2, api_ship_id: 961, api_lv: 100, api_sally_area: null }),
    ]);

    const result = expectSuccess(parseImportText(text, master, ALL));

    expect(result.ships).toEqual([
      { uid: "1", shipId: 961, level: 100, luck: 20, sallyArea: 0 },
      { uid: "2", shipId: 961, level: 100, luck: 20, sallyArea: 0 },
    ]);
    expect(result.taggedShipCount).toBe(0);
  });

  it("前後に空白・改行があっても読める（貼り付けたときに混ざるため）", () => {
    const result = expectSuccess(parseImportText(`\n  ${standardSvdataText}\n`, master, ALL));

    expect(result.ships).toEqual(standardShips);
  });
});

describe("parseImportText：短縮形式（新しい形式。ship_id あり）", () => {
  it("id を個体 ID、ship_id を艦の ID として読み、運は st[4]、札は area から作る", () => {
    const result = expectSuccess(parseImportText(standardCompactText, master, ALL));

    expect(result.ships).toEqual(standardShips);
    expect(result.format).toBe("compact");
    expect(result.hasUid).toBe(true);
    expect(result.unknownShipCount).toBe(1);
    expect(result.taggedShipCount).toBe(2);
  });

  it("同じ艦は svdata 形式で読んでも短縮形式で読んでも、同じ個体 ID・同じ値になる（どちらで取り込んでも割り当てを引き継げる）", () => {
    const fromSvdata = expectSuccess(parseImportText(standardSvdataText, master, ALL));
    const fromCompact = expectSuccess(parseImportText(standardCompactText, master, ALL));

    expect(fromCompact.ships).toEqual(fromSvdata.ships);
  });

  it("ロックの情報がないため、「ロック済みだけ」を選んでも絞り込まず、そのことが分かる結果を返す", () => {
    const result = expectSuccess(parseImportText(standardCompactText, master, { lockedOnly: true, minLevel: 1 }));

    expect(result.ships).toEqual(standardShips);
    expect(result.hasLockInfo).toBe(false);
    expect(result.lockFilterIgnored).toBe(true);
  });

  it("「すべての艦娘」を選んだときは、絞り込まなかった印を立てない", () => {
    const result = expectSuccess(parseImportText(standardCompactText, master, ALL));

    expect(result.hasLockInfo).toBe(false);
    expect(result.lockFilterIgnored).toBe(false);
  });

  it("Lv 下限は短縮形式でも効く（「ロック済みだけ」が効かないときも Lv 下限は効く）", () => {
    const result = expectSuccess(parseImportText(standardCompactText, master, { lockedOnly: true, minLevel: 99 }));

    expect(uidsOf(result.ships)).toEqual(["101", "102", "103"]);
    expect(result.lockFilterIgnored).toBe(true);
  });

  it("ship_id が 0・欠けている要素は飛ばす（ship_id がない要素を古い形式として読まない）", () => {
    const text = toCompactText([
      compactShip({ id: 1, ship_id: 0, lv: 50 }),
      compactShip({ id: 145, lv: 50 }), // ship_id がない（同じ配列のほかの要素には ship_id がある）
      compactShip({ id: 3, ship_id: 961, lv: 50 }),
    ]);

    const result = expectSuccess(parseImportText(text, master, ALL));

    expect(result.format).toBe("compact");
    expect(uidsOf(result.ships)).toEqual(["3"]);
  });

  it("配列の中のオブジェクトでない要素は飛ばし、残りを取り込む", () => {
    const text = toCompactText([1, null, "x", [], compactShip({ id: 7, ship_id: 145, lv: 60 })]);

    const result = expectSuccess(parseImportText(text, master, ALL));

    expect(uidsOf(result.ships)).toEqual(["7"]);
  });

  it("Lv 0 の艦は Lv 1 として扱う", () => {
    const text = toCompactText([compactShip({ id: 9, ship_id: 145, lv: 0 })]);

    const result = expectSuccess(parseImportText(text, master, ALL));

    expect(result.ships).toEqual([{ uid: "9", shipId: 145, level: 1, luck: 15, sallyArea: 0 }]);
  });

  it("同じ個体 ID（id）の要素が 2 つあれば、先の要素を使う", () => {
    const text = toCompactText([
      compactShip({ id: 8, ship_id: 961, lv: 150 }),
      compactShip({ id: 8, ship_id: 145, lv: 60 }), // 個体 ID 8 の 2 つ目 → 使わない
    ]);

    const result = expectSuccess(parseImportText(text, master, ALL));

    expect(result.ships.map(({ uid, shipId, level }) => ({ uid, shipId, level }))).toEqual([
      { uid: "8", shipId: 961, level: 150 },
    ]);
  });

  it("st がない艦の運は運の初期値のまま、area が null・false の艦の札は 0", () => {
    const text = toCompactText([
      compactShip({ id: 1, ship_id: 145, lv: 80, st: undefined, area: null }),
      compactShip({ id: 2, ship_id: 145, lv: 80, area: false }),
    ]);

    const result = expectSuccess(parseImportText(text, master, ALL));

    expect(result.ships).toEqual([
      { uid: "1", shipId: 145, level: 80, luck: 15, sallyArea: 0 },
      { uid: "2", shipId: 145, level: 80, luck: 15, sallyArea: 0 },
    ]);
  });
});

/**
 * api_ship の配列（`svdata=` も api_data もない、api_ 付きの項目の艦を並べた JSON 配列）。
 * 実際の利用者の貼り付けで使われていた形。ロックの情報（api_locked）がないことが多い
 */
function apiShipArrayText(withLock: boolean): string {
  return JSON.stringify(
    standardSamples.map((s) => ({
      api_id: s.uid,
      api_ship_id: s.shipId,
      api_lv: s.lv,
      api_kyouka: kyouka(s.luckUp),
      api_exp: [0, 100, 0],
      api_slot_ex: -1,
      api_sally_area: s.area,
      api_sp_effect_items: [],
      ...(withLock ? { api_locked: s.locked } : {}),
    })),
  );
}

describe("parseImportText：api_ship の配列（svdata= も api_data もない形）", () => {
  it("api_id を個体 ID、api_ship_id を艦の ID として読み、svdata 形式と同じ個体の一覧を作る", () => {
    // 実行
    const result = expectSuccess(parseImportText(apiShipArrayText(false), master, ALL));

    // 検証：艦の ID が 0 の要素（106）は飛ばす
    expect(result.ships).toEqual(standardShips);
    expect(result.format).toBe("apiShipArray");
    expect(result.hasUid).toBe(true);
    expect(result.unknownShipCount).toBe(1);
    expect(result.taggedShipCount).toBe(2);
  });

  it("api_locked がなければ、「ロック済みだけ」を選んでも絞り込まず、そのことが分かる結果を返す", () => {
    const result = expectSuccess(parseImportText(apiShipArrayText(false), master, { lockedOnly: true, minLevel: 1 }));

    expect(result.ships).toEqual(standardShips);
    expect(result.hasLockInfo).toBe(false);
    expect(result.lockFilterIgnored).toBe(true);
  });

  it("api_locked があれば、「ロック済みだけ」で絞り込む", () => {
    const result = expectSuccess(parseImportText(apiShipArrayText(true), master, { lockedOnly: true, minLevel: 1 }));

    expect(uidsOf(result.ships)).toEqual(["101", "102", "104"]);
    expect(result.hasLockInfo).toBe(true);
    expect(result.lockFilterIgnored).toBe(false);
  });

  it("api_locked を持つ艦が一部だけなら、ロックの情報がないものとして扱い、「ロック済みだけ」で絞り込まない", () => {
    const elements = JSON.parse(apiShipArrayText(true)) as Record<string, unknown>[];
    delete elements[2]?.api_locked; // 103 だけロックの情報がない

    const result = expectSuccess(parseImportText(JSON.stringify(elements), master, { lockedOnly: true, minLevel: 1 }));

    expect(result.ships).toEqual(standardShips);
    expect(result.hasLockInfo).toBe(false);
    expect(result.lockFilterIgnored).toBe(true);
  });

  it("api_locked が飛ばす要素（艦の ID が 0）にだけあっても、ロックの情報がないものとして扱う", () => {
    const elements = JSON.parse(apiShipArrayText(false)) as Record<string, unknown>[];
    const skipped = elements.find((e) => e.api_ship_id === 0);
    if (skipped) skipped.api_locked = 1;

    const result = expectSuccess(parseImportText(JSON.stringify(elements), master, { lockedOnly: true, minLevel: 1 }));

    expect(result.ships).toEqual(standardShips);
    expect(result.hasLockInfo).toBe(false);
  });

  it("Lv 下限が効く", () => {
    const result = expectSuccess(parseImportText(apiShipArrayText(false), master, { lockedOnly: false, minLevel: 99 }));

    expect(uidsOf(result.ships)).toEqual(["101", "102", "103"]);
  });

});

describe("parseImportText：古い短縮形式（ship_id なし。個体 ID なし）", () => {
  const legacyText = toCompactText([
    compactShip({ id: 961, lv: 175, st: kyouka(39), area: 1 }),
    compactShip({ id: 145, lv: 98, st: kyouka(7) }),
    compactShip({ id: 145, lv: 60, st: kyouka(0) }), // 同じ艦がもう 1 隻
    compactShip({ id: 0, lv: 50 }), // 艦の ID が 0 → 飛ばす
    compactShip({ lv: 50 }), // 艦の ID がない → 飛ばす
  ]);

  it("id を艦の ID として読み、割り当てを引き継げない（個体 ID がない）ことが分かる結果を返す", () => {
    const result = expectSuccess(parseImportText(legacyText, master, ALL));

    expect(result.format).toBe("compactLegacy");
    expect(result.hasUid).toBe(false);
    expect(result.hasLockInfo).toBe(false);
    expect(result.ships.map(({ shipId, level, luck, sallyArea }) => ({ shipId, level, luck, sallyArea }))).toEqual([
      { shipId: 961, level: 175, luck: 59, sallyArea: 1 },
      { shipId: 145, level: 98, luck: 22, sallyArea: 0 },
      { shipId: 145, level: 60, luck: 15, sallyArea: 0 },
    ]);
    expect(result.taggedShipCount).toBe(1);
  });

  it("個体 ID を連番で振る：空でなく重複せず、同じ入力からは毎回同じ個体 ID になる", () => {
    const first = expectSuccess(parseImportText(legacyText, master, ALL));
    const second = expectSuccess(parseImportText(legacyText, master, ALL));

    const uids = uidsOf(first.ships);
    expect(uids.every((uid) => uid.length > 0)).toBe(true);
    expect(new Set(uids).size).toBe(uids.length);
    expect(uidsOf(second.ships)).toEqual(uids);
  });
});

describe("parseImportText：取り込む艦が 0 隻（理由 noShips。保存すると割り当てが知らせずに全部外れるため失敗にする）", () => {
  it("svdata 形式で「ロック済みだけ」を選び、ロック済みの艦が 1 隻もなければ noShips", () => {
    const text = toSvdataText([
      svShip({ api_id: 1, api_ship_id: 145, api_lv: 80, api_locked: 0 }),
      svShip({ api_id: 2, api_ship_id: 961, api_lv: 90, api_locked: 0 }),
    ]);

    const result = parseImportText(text, master, { lockedOnly: true, minLevel: 1 });

    expect(result).toEqual({ ok: false, reason: "noShips" });
  });

  it("svdata 形式で api_ship が空の配列なら noShips（形は正しいので unexpectedShape ではない）", () => {
    const result = parseImportText(toSvdataText([]), master, ALL);

    expect(result).toEqual({ ok: false, reason: "noShips" });
  });

  it("svdata 形式で、読める要素が 1 つもない（艦の ID が 0・オブジェクトでない）なら noShips", () => {
    const text = toSvdataText([svShip({ api_id: 1, api_ship_id: 0, api_lv: 50 }), null, "時雨"]);

    const result = parseImportText(text, master, ALL);

    expect(result).toEqual({ ok: false, reason: "noShips" });
  });

  it("短縮形式（新しい形式）で Lv 下限を満たす艦が 1 隻もなければ noShips", () => {
    const result = parseImportText(standardCompactText, master, { lockedOnly: false, minLevel: 185 });

    expect(result).toEqual({ ok: false, reason: "noShips" });
  });

  it("短縮形式（新しい形式）で、ship_id が読める要素が 1 つもなければ noShips", () => {
    // ship_id を持つ要素があるので新しい形式として読むが、どれも艦の ID が 0
    const text = toCompactText([compactShip({ id: 1, ship_id: 0, lv: 50 }), compactShip({ id: 2, ship_id: 0, lv: 60 })]);

    const result = parseImportText(text, master, ALL);

    expect(result).toEqual({ ok: false, reason: "noShips" });
  });

  it("古い短縮形式で Lv 下限を満たす艦が 1 隻もなければ noShips", () => {
    const text = toCompactText([compactShip({ id: 961, lv: 175 }), compactShip({ id: 145, lv: 98 })]);

    const result = parseImportText(text, master, { lockedOnly: false, minLevel: 176 });

    expect(result).toEqual({ ok: false, reason: "noShips" });
  });
});

describe("parseImportText：艦船マスタにない艦（名前が分からない艦）", () => {
  it("運は近代化改修の運だけで求め、名前が分からない艦として数える（取り込みは続ける）", () => {
    const text = toCompactText([
      compactShip({ id: 1, ship_id: 99999, lv: 10, st: kyouka(6) }),
      compactShip({ id: 2, ship_id: 88888, lv: 10, st: undefined }), // 近代化改修の値もない → 0
      compactShip({ id: 3, ship_id: 145, lv: 10 }),
    ]);

    const result = expectSuccess(parseImportText(text, master, ALL));

    expect(result.ships.map((s) => [s.uid, s.luck])).toEqual([
      ["1", 6],
      ["2", 0],
      ["3", 15],
    ]);
    expect(result.unknownShipCount).toBe(2);
  });
});

describe("parseImportText：壊れた入力（例外を投げず、理由を返す）", () => {
  it.each<[string, ImportFailureReason, string]>([
    ["空", "empty", ""],
    ["空白と改行だけ", "empty", "  \n\t \r\n"],
    ["JSON でない文字", "invalidJson", "こんにちは"],
    ["途中で切れた JSON 配列", "invalidJson", '[{"id":1,"ship_id":145'],
    ["svdata= の後ろが空", "invalidJson", "svdata="],
    ["svdata= の後ろが壊れた JSON", "invalidJson", 'svdata={"api_data":'],
    // 数字だけの文字列（123）は JSON の数として読めるため、invalidJson ではなく unexpectedShape
    ["数", "unexpectedShape", "123"],
    ["前後に空白がある数", "unexpectedShape", "  123\n"],
    ["数字だけの JSON の文字列", "unexpectedShape", '"123"'],
    ["svdata= の後ろが数", "unexpectedShape", "svdata=123"],
    ["null", "unexpectedShape", "null"],
    ["文字列", "unexpectedShape", '"時雨"'],
    // 空の配列は、関係のない JSON 配列と見分けられないため、noShips ではなく unexpectedShape のまま
    // （svdata の api_ship: [] は形が正しいので noShips）
    ["空の配列", "unexpectedShape", "[]"],
    ["艦を表すオブジェクト（id・ship_id を持つ）がない配列", "unexpectedShape", '[{"foo":1}]'],
    ["オブジェクトでない要素だけの配列", "unexpectedShape", '[1,"x",null]'],
    ["svdata= のない API 応答のオブジェクト", "unexpectedShape", '{"api_data":{"api_ship":[]}}'],
    ["svdata= の後ろに api_data がない", "unexpectedShape", 'svdata={"api_result":1}'],
    ["svdata= の後ろに api_ship がない", "unexpectedShape", 'svdata={"api_result":1,"api_data":{}}'],
    ["api_ship が配列でない", "unexpectedShape", 'svdata={"api_data":{"api_ship":"x"}}'],
    ["svdata= の後ろが null", "unexpectedShape", "svdata=null"],
  ])("%s → 理由 %s", (_label, reason, text) => {
    // 実行：例外が出ればこの行でテストが失敗する
    const result = parseImportText(text, master, ALL);

    // 検証
    expect(result).toEqual({ ok: false, reason });
  });
});

describe("parseImportText：純粋な関数", () => {
  it("同じ入力からは毎回同じ結果を返し、渡したマスタ・条件を書き換えない", () => {
    const filter: ImportFilter = Object.freeze({ lockedOnly: true, minLevel: 50 });
    const entryCount = master.byId.size;

    const first = parseImportText(standardSvdataText, master, filter);
    const second = parseImportText(standardSvdataText, master, filter);

    expect(second).toEqual(first);
    expect(filter).toEqual({ lockedOnly: true, minLevel: 50 });
    expect(master.byId.size).toBe(entryCount);
  });
});
