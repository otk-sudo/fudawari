import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DefinitionDoc } from "@/domain/definition-edit";
import { expectInDocumentOrder } from "@/test/dom-order";
import { type Mutable, summer2026Definition } from "@/test/fixtures";
import {
  boostGroupNamed,
  boostGroups,
  detailRegion,
  fixClock,
  makeData,
  makeDoc,
  makeEvent,
  renderEditor,
  restoreClock,
  selectStage,
  shipNameInput,
  textMatching,
} from "./test-helpers";

// イベント定義の画面の特効グループの読みやすさと艦名の入力（UI／UX の指摘 中9・中10。親が決めた直し方・ユーザーの承認済み）
//
// 中9 指摘：特効グループの「艦名・国籍・艦種」の行に見出しがなく、効く条件も読み取りにくい。
// 直し方
// - 各行の左に小さく「艦名」「国籍」「艦種」と付ける（その行に値があるときだけ、または常に）
// - グループの下に要約を 1 行。例「冬月・北上、またはアメリカの駆逐に ×1.21」。
//   艦名だけなら「冬月・北上に ×1.21」、国籍だけなら「アメリカの艦に ×1.10」（倍率は小数 2 桁）
//
// 中10 指摘：艦名の入力に候補がなく、誤字は入れた後の警告だけ。
// 直し方
// - 艦名の入力欄（「＋ 艦名」で開く「追加する艦名」）に、艦船マスタの改装段階を問わない艦名（knownShipNames）の候補を出す（datalist など）
// - 艦船マスタにない艦名のタグは見た目で区別できる
//
// 部品の公開する形（実装の担当向け。テストはこの形で探す）
// - 行の見出し：特効グループ（role="group"「特効グループ n：…」）の中に、文字がちょうど「艦名」「国籍」「艦種」の要素。
//   それぞれ、その行のタグより前に置く（並び：艦名の見出し → 艦名のタグ → 国籍の見出し → 国籍のタグ → 艦種の見出し → 艦種のタグ）
// - 要約：特効グループの中、またはそのグループの後ろで次のグループより前に置いた要素の文。艦名は「・」でつなぐ
// - 艦名の候補：「追加する艦名」の入力欄の list 属性が指す <datalist> の option の value、
//   または（自前の候補の一覧なら）入力欄の aria-controls が指す role="listbox" の option の文。
//   候補は knownShipNames の艦名だけ（改装後の名前などを足さない）
// - マスタにない艦名のタグ：タグ（艦名の × ボタン「（艦名）を外す」を含む listitem）か、その中の要素に
//   data-unknown="true" または aria-invalid="true" を付ける。マスタにある艦名のタグには付けない。
//   knownShipNames を渡していない（マスタを読めない）ときは、どのタグにも付けない
//
// 既存のテストで、仕様が変わったため探し方を変えたもの：「追加する艦名」の入力欄を role="textbox" ではなくラベルで探す
// （候補を付けると role が combobox になるため。PlanEditor.detail／review の各テストと e2e/permissions.spec.ts）

/** テスト用の定義に出てくる艦名すべて（艦船マスタにある艦名として渡す） */
const ALL_SHIP_NAMES: ReadonlySet<string> = new Set(
  summer2026Definition.stages.flatMap((stage) => stage.boosts.flatMap((group) => [...group.shipNames])),
);

/** 書き換えられる特効グループ */
type MutableGroup = Mutable<DefinitionDoc>["stages"][number]["boosts"][number];

/** 艦種「駆逐」の番号（api_stype） */
const DESTROYER = 2;

/**
 * E1 の段階（ギミック〜ゲージ3。開いたときに選ばれている）の特効グループを書き換えた下書きで画面を描く。
 * 元の E1：第三十一戦隊B ×1.21（冬月・北上）、第三十一戦隊A ×1.09（雪風ほか 7 隻）
 */
async function renderWithE1(
  change: (groups: { b: MutableGroup; a: MutableGroup }) => void,
  knownShipNames: ReadonlySet<string> = ALL_SHIP_NAMES,
) {
  const draftContent = makeDoc((draft) => {
    const stage = draft.stages.find((s) => s.id === "E1-1");
    const b = stage?.boosts.find((g) => g.id === "E1-1-B");
    const a = stage?.boosts.find((g) => g.id === "E1-1-A");
    if (b === undefined || a === undefined) throw new Error("テスト用の定義に E1 の特効グループがありません");
    change({ b, a });
  });
  return renderEditor(makeData({ latestEvent: makeEvent({ draftContent }) }), { knownShipNames });
}

/** 文字がちょうど text の要素（特効グループの中） */
function exactText(group: HTMLElement, text: string): HTMLElement {
  return within(group).getByText(text, { exact: true });
}

/**
 * 要約の文（pattern に合う文を持ついちばん内側の要素）が、group の中、または group の後ろで次の特効グループより前にあることを確かめる
 */
function expectSummaryOf(group: HTMLElement, pattern: RegExp): void {
  const found = within(detailRegion()).queryAllByText(textMatching(pattern));
  expect(found.length, `${String(pattern)} に合う要約`).toBeGreaterThan(0);
  const groups = boostGroups();
  const next = groups[groups.indexOf(group) + 1];
  const belongs = found.some((element) => {
    if (group.contains(element)) return true;
    const afterGroup = (group.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const beforeNext =
      next === undefined || (element.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    return afterGroup && beforeNext;
  });
  expect(belongs, `${String(pattern)} の要約が、そのグループの中か直後にある`).toBe(true);
}

/** 艦名のタグ（× ボタン「（艦名）を外す」を含む listitem。なければ × ボタンの親） */
function shipTag(group: HTMLElement, shipName: string): HTMLElement {
  const remove = within(group).getByRole("button", { name: `${shipName}を外す` });
  const tag = remove.closest("li") ?? remove.parentElement;
  if (tag === null) throw new Error(`${shipName} のタグがありません`);
  return tag;
}

/** タグが「艦船マスタにない」印（data-unknown="true" または aria-invalid="true"）を持つか（タグ自身か、その中の要素） */
function isMarkedUnknown(tag: HTMLElement): boolean {
  const selector = '[data-unknown="true"], [aria-invalid="true"]';
  return tag.matches(selector) || tag.querySelector(selector) !== null;
}

/**
 * 艦名の入力欄に typed を打ち、出た候補の文字を返す。
 * datalist なら option の value（絞り込みはブラウザが行うので、すべての候補）、自前の候補の一覧なら role="listbox" の option の文
 */
async function suggestionsAfterTyping(user: UserEvent, input: HTMLInputElement, typed: string): Promise<string[]> {
  await user.type(input, typed);
  const listId = input.getAttribute("list");
  if (listId !== null && listId !== "") {
    const datalist = document.getElementById(listId);
    if (datalist === null || datalist.tagName !== "DATALIST") return [];
    return Array.from(datalist.querySelectorAll("option"), (option) => option.value);
  }
  const controls = input.getAttribute("aria-controls");
  if (controls !== null && controls !== "") {
    const listbox = document.getElementById(controls);
    if (listbox === null) return [];
    return within(listbox)
      .queryAllByRole("option")
      .map((option) => (option.textContent ?? "").trim());
  }
  return [];
}

describe("イベント定義の画面（PlanEditor）：特効グループの読みやすさと艦名の入力（UI／UX の指摘 中9・中10）", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  describe("行の見出し「艦名」「国籍」「艦種」（中9）", () => {
    it("艦名・国籍・艦種のある特効グループで、各行のタグの前に見出し「艦名」「国籍」「艦種」を出す", async () => {
      // 準備：第三十一戦隊B（冬月・北上）に、国籍 アメリカ・艦種 駆逐 を足す
      await renderWithE1(({ b }) => {
        b.nationalities = ["usa"];
        b.shipTypes = [DESTROYER];
      });

      // 実行
      const group = boostGroupNamed("第三十一戦隊B");

      // 検証
      expectInDocumentOrder([
        exactText(group, "艦名"),
        exactText(group, "冬月"),
        exactText(group, "国籍"),
        exactText(group, "アメリカ"),
        exactText(group, "艦種"),
        exactText(group, "駆逐"),
      ]);
    });
  });

  describe("効く条件の要約（中9）", () => {
    it("艦名と国籍・艦種があるグループの下に「冬月・北上、またはアメリカの駆逐に ×1.21」と出す", async () => {
      // 準備・実行
      await renderWithE1(({ b }) => {
        b.nationalities = ["usa"];
        b.shipTypes = [DESTROYER];
      });

      // 検証
      expectSummaryOf(boostGroupNamed("第三十一戦隊B"), /冬月・北上、またはアメリカの駆逐に\s*×1\.21/);
    });

    it("艦名だけのグループの下に「冬月・北上に ×1.21」と出す", async () => {
      // 準備・実行：E1 の第三十一戦隊B はそのまま（艦名だけ）
      await renderWithE1(() => undefined);

      // 検証
      expectSummaryOf(boostGroupNamed("第三十一戦隊B"), /冬月・北上に\s*×1\.21/);
    });

    it("国籍だけのグループ（艦名なし・アメリカ ×1.1）の下に「アメリカの艦に ×1.10」と出す", async () => {
      // 準備・実行：第三十一戦隊A の艦名を外し、国籍 アメリカ・倍率 1.1 にする
      await renderWithE1(({ a }) => {
        a.shipNames = [];
        a.nationalities = ["usa"];
        a.multiplier = 1.1;
      });

      // 検証
      expectSummaryOf(boostGroupNamed("第三十一戦隊A"), /アメリカの艦に\s*×1\.10/);
    });

    it("艦名のタグを外すと、要約もその場で変わる（北上を外すと「冬月に ×1.21」）", async () => {
      // 準備
      const { user } = await renderWithE1(() => undefined);

      // 実行
      await user.click(within(boostGroupNamed("第三十一戦隊B")).getByRole("button", { name: "北上を外す" }));

      // 検証
      expectSummaryOf(boostGroupNamed("第三十一戦隊B"), /冬月に\s*×1\.21/);
      expect(within(detailRegion()).queryAllByText(textMatching(/冬月・北上に/))).toHaveLength(0);
    });
  });

  describe("艦名の候補（中10）", () => {
    it("「＋ 艦名」で開いた入力欄に、艦船マスタの改装段階を問わない艦名（渡した艦名だけ）を候補として出す", async () => {
      // 準備：E2 ゲージ3 の連合艦隊C に艦名を足す
      const { user } = await renderEditor(makeData(), { knownShipNames: ALL_SHIP_NAMES });
      await selectStage(user, "E2", "ゲージ3");
      await user.click(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: "＋ 艦名" }));

      // 実行
      const suggestions = await suggestionsAfterTyping(user, shipNameInput(boostGroupNamed("連合艦隊C")), "雪");

      // 検証
      expect(suggestions).toContain("雪風");
      expect(suggestions.every((name) => ALL_SHIP_NAMES.has(name)), `候補 ${suggestions.join("、")} は渡した艦名だけ`).toBe(
        true,
      );
    });

    it("候補から選んだ艦名（雪風）を Enter で足せる（今の足し方のまま）", async () => {
      // 準備
      const { user } = await renderEditor(makeData(), { knownShipNames: ALL_SHIP_NAMES });
      await selectStage(user, "E2", "ゲージ3");
      await user.click(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: "＋ 艦名" }));

      // 実行
      await user.type(shipNameInput(boostGroupNamed("連合艦隊C")), "雪風{Enter}");

      // 検証
      expect(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: "雪風を外す" })).toBeInTheDocument();
    });
  });

  describe("艦船マスタにない艦名のタグ（中10）", () => {
    it("艦船マスタにない艦名（千代田）のタグに印を付け、マスタにある艦名（千歳）のタグには付けない", async () => {
      // 準備：千代田がマスタにない
      const known = new Set([...ALL_SHIP_NAMES].filter((name) => name !== "千代田"));
      const { user } = await renderEditor(makeData(), { knownShipNames: known });

      // 実行
      await selectStage(user, "E2", "ゲージ3");

      // 検証
      const group = boostGroupNamed("連合艦隊C");
      expect(isMarkedUnknown(shipTag(group, "千代田")), "千代田のタグに印がある").toBe(true);
      expect(isMarkedUnknown(shipTag(group, "千歳")), "千歳のタグに印がない").toBe(false);
    });

    it("画面で足したマスタにない艦名（ユキカゼ）のタグにも印を付ける", async () => {
      // 準備
      const { user } = await renderEditor(makeData(), { knownShipNames: ALL_SHIP_NAMES });
      await selectStage(user, "E2", "ゲージ3");
      await user.click(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: "＋ 艦名" }));

      // 実行
      await user.type(shipNameInput(boostGroupNamed("連合艦隊C")), "ユキカゼ{Enter}");

      // 検証
      expect(isMarkedUnknown(shipTag(boostGroupNamed("連合艦隊C"), "ユキカゼ"))).toBe(true);
    });

    it("艦船マスタの艦名を渡していなければ（マスタを読めない）、どのタグにも印を付けない", async () => {
      // 準備
      const { user } = await renderEditor();

      // 実行
      await selectStage(user, "E2", "ゲージ3");

      // 検証
      const group = boostGroupNamed("連合艦隊C");
      const tags = within(group)
        .getAllByRole("button", { name: /を外す$/ })
        .map((button) => button.closest("li") ?? button.parentElement)
        .filter((tag): tag is HTMLElement => tag !== null);
      expect(tags.length).toBeGreaterThan(0);
      expect(tags.filter(isMarkedUnknown)).toHaveLength(0);
      expect(screen.queryByText(/艦船マスタにない艦名/)).not.toBeInTheDocument();
    });
  });
});
