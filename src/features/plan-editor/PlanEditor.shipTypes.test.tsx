import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DefinitionDoc } from "@/domain/definition-edit";
import type { Mutable } from "@/test/fixtures";
import { expectInDocumentOrder } from "@/test/dom-order";
import {
  boostGroupNamed,
  createFakeRepository,
  DRAFT_VERSION,
  fixClock,
  makeData,
  makeDoc,
  makeEvent,
  renderEditor,
  restoreClock,
  saveDraftButton,
  savedDraftInput,
  selectStage,
  stageIn,
} from "./test-helpers";

// イベント定義の画面の特効グループの艦種（v1.1「国籍の特効を艦種で絞る」の仕様 6 章）
//
// 部品の公開する形（実装の担当向け。テストはこの形で探す）
// - 特効グループの中、国籍の行（<ul aria-label="国籍">）の下に艦種の行。国籍が 1 つ以上あるときだけ出す
//   （国籍がないときは、艦種のタグの一覧も「＋ 艦種」ボタンも出さない）
// - 選んだ艦種のタグの一覧は <ul aria-label="艦種">。タグは選択肢の表示名（例「駆逐」）で、並びは選択肢の順
//   （shipTypeOptionLabelsOf）。タグの × はボタン（aria-label「駆逐を外す」。その選択肢の ids をすべて外す）
// - ボタン「＋ 艦種」。押すと艦種を選ぶ欄（<fieldset> と <legend>「艦種を選ぶ」。role="group"）を開く。
//   欄の中に 19 個のチェックボックス（ラベルは表示名。BOOST_SHIP_TYPE_OPTIONS の順）と、
//   説明「選ばなければ、選んだ国籍のすべての艦種に効きます」。
//   チェックは「その選択肢の ids のどれかを含む」とき入る。入れると ids をすべて足し、外すと ids をすべて外す
//   （setGroupShipTypes。すぐ文書に反映。欄は開いたまま）
// - 欄の中のボタン「閉じる」か Esc で閉じる。開いたら最初のチェックボックスへ、閉じたら「＋ 艦種」へフォーカス
// - 国籍を全部外すと艦種の行は消え、文書からも艦種が消える
//
// テスト用の定義の E2 ゲージ3（連合艦隊・難所）の特効：連合艦隊C ×1.27、連合艦隊B ×1.24、連合艦隊A ×1.18（どれも国籍なし）

/** 仕様の艦種の選択肢の表示名（BOOST_SHIP_TYPE_OPTIONS の順） */
const SHIP_TYPE_LABELS = [
  "戦艦",
  "航戦",
  "正空",
  "装空",
  "軽空",
  "重巡",
  "航巡",
  "軽巡",
  "雷巡",
  "練巡",
  "駆逐",
  "海防",
  "潜水",
  "潜空",
  "水母",
  "潜母",
  "揚陸",
  "補給",
  "工作",
] as const;

/** 艦種を選ぶ欄の説明 */
const PICKER_NOTE = "選ばなければ、選んだ国籍のすべての艦種に効きます";

/** 2026夏イベの文書の、E2 ゲージ3 の連合艦隊C を書き換えた下書きで画面を描く */
async function renderWithGroupC(change: (group: Record<string, unknown>) => void) {
  const draftContent = makeDoc((draft: Mutable<DefinitionDoc>) => {
    const group = draft.stages.flatMap((s) => s.boosts).find((g) => g.id === "E2-3-C");
    if (group === undefined) throw new Error("テスト用の定義に連合艦隊C がありません");
    change(group as unknown as Record<string, unknown>);
  });
  return renderEditor(makeData({ latestEvent: makeEvent({ draftContent }) }));
}

/** 連合艦隊C を国籍 アメリカ（と艦種）にした下書きで画面を描き、E2 ゲージ3 を選ぶ */
async function renderUsaGroupC(shipTypes?: number[]) {
  const rendered = await renderWithGroupC((group) => {
    group.nationalities = ["usa"];
    if (shipTypes !== undefined) group.shipTypes = shipTypes;
  });
  await selectStage(rendered.user, "E2", "ゲージ3");
  return rendered;
}

/** 特効グループの艦種のタグの一覧（<ul aria-label="艦種">）。なければ null */
function queryShipTypeList(group: HTMLElement): HTMLElement | null {
  return within(group).queryByRole("list", { name: "艦種" });
}

/** 特効グループの艦種のタグ（表示名。並びは画面の順）。タグの × の aria-label「〇〇を外す」から読む */
function shipTypeTags(group: HTMLElement): string[] {
  const list = queryShipTypeList(group);
  if (list === null) return [];
  return within(list)
    .queryAllByRole("button", { name: /を外す$/ })
    .map((button) => (button.getAttribute("aria-label") ?? "").replace(/を外す$/, ""));
}

/** 特効グループの「＋ 艦種」ボタン。なければ null */
function queryAddShipTypeButton(group: HTMLElement): HTMLElement | null {
  return within(group).queryByRole("button", { name: "＋ 艦種" });
}

/** 艦種を選ぶ欄（role="group"「艦種を選ぶ」）。なければ null */
function queryPicker(): HTMLElement | null {
  return screen.queryByRole("group", { name: "艦種を選ぶ" });
}

/** 艦種を選ぶ欄（開いていなければテストを失敗させる） */
function getPicker(): HTMLElement {
  return screen.getByRole("group", { name: "艦種を選ぶ" });
}

/** 連合艦隊C の「＋ 艦種」を押して、艦種を選ぶ欄を開く */
async function openPicker(user: UserEvent): Promise<HTMLElement> {
  await user.click(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: "＋ 艦種" }));
  return getPicker();
}

/** 保存した文書の連合艦隊C */
function groupCIn(content: DefinitionDoc): Record<string, unknown> {
  const group = stageIn(content, "E2-3").boosts.find((g) => g.id === "E2-3-C");
  if (group === undefined) throw new Error("保存した文書に連合艦隊C がありません");
  return group as unknown as Record<string, unknown>;
}

/** フォーカスが要素にあるか（失敗したときに今のフォーカスを読めるようにする） */
function expectFocused(element: HTMLElement | null, label: string): void {
  const active = document.activeElement;
  const now = active === null ? "なし" : `${active.tagName} ${active.getAttribute("aria-label") ?? active.textContent ?? ""}`;
  expect(element !== null && active === element, `${label}にフォーカス（今のフォーカス：${now.trim()}）`).toBe(true);
}

describe("イベント定義の画面（PlanEditor）：特効グループの艦種（v1.1。国籍の条件を絞る）", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  describe("艦種の行を出す条件（国籍が 1 つ以上あるときだけ）", () => {
    it("国籍のないグループには、艦種のタグの一覧も「＋ 艦種」ボタンも出さない", async () => {
      // 準備
      const { user } = await renderEditor();

      // 実行
      await selectStage(user, "E2", "ゲージ3");

      // 検証
      for (const name of ["連合艦隊C", "連合艦隊B", "連合艦隊A"]) {
        const group = boostGroupNamed(name);
        expect(queryShipTypeList(group), name).toBeNull();
        expect(queryAddShipTypeButton(group), name).toBeNull();
        // 国籍の「＋ 国籍」は今までどおり出る
        expect(within(group).getByRole("button", { name: "＋ 国籍" })).toBeInTheDocument();
      }
      expect(queryPicker()).not.toBeInTheDocument();
    });

    it("国籍を持つグループには、国籍の行の下に「＋ 艦種」ボタンを出す（艦種はまだないのでタグはない）", async () => {
      // 準備・実行
      await renderUsaGroupC();

      // 検証
      const groupC = boostGroupNamed("連合艦隊C");
      const addButton = queryAddShipTypeButton(groupC);
      expect(addButton).not.toBeNull();
      expect(shipTypeTags(groupC)).toEqual([]);
      if (addButton !== null) {
        expectInDocumentOrder([within(groupC).getByRole("list", { name: "国籍" }), addButton]);
      }
      // 国籍のないグループには出さない
      expect(queryAddShipTypeButton(boostGroupNamed("連合艦隊B"))).toBeNull();
    });

    it("国籍を選ぶ欄でアメリカにチェックを入れると、そのグループに「＋ 艦種」ボタンが出る", async () => {
      // 準備
      const { user } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      expect(queryAddShipTypeButton(boostGroupNamed("連合艦隊C"))).toBeNull();

      // 実行
      await user.click(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: "＋ 国籍" }));
      await user.click(
        within(screen.getByRole("group", { name: "国籍を選ぶ" })).getByRole("checkbox", { name: "アメリカ" }),
      );

      // 検証
      expect(queryAddShipTypeButton(boostGroupNamed("連合艦隊C"))).not.toBeNull();
    });
  });

  describe("艦種のタグ", () => {
    it("艦種を持つグループは、国籍のタグの下に、艦種のタグ（表示名）を選択肢の順に出す（文書が駆逐・軽巡の順でも 軽巡・駆逐）", async () => {
      // 準備・実行
      await renderUsaGroupC([2, 3]);

      // 検証
      const groupC = boostGroupNamed("連合艦隊C");
      expect(shipTypeTags(groupC)).toEqual(["軽巡", "駆逐"]);
      const list = queryShipTypeList(groupC);
      expect(list).not.toBeNull();
      if (list !== null) {
        expectInDocumentOrder([within(groupC).getByRole("list", { name: "国籍" }), list]);
        expect(within(list).getByText("駆逐")).toBeInTheDocument();
      }
    });

    it("艦種 8・9 は 1 つのタグ「戦艦」にまとめる", async () => {
      await renderUsaGroupC([8, 9]);

      expect(shipTypeTags(boostGroupNamed("連合艦隊C"))).toEqual(["戦艦"]);
    });

    it("艦種のタグの ×（「戦艦を外す」）で、その選択肢の番号をすべて外す（8・9 の両方）。保存する文書の艦種からも消える", async () => {
      // 準備
      const { user, repository } = await renderUsaGroupC([8, 9, 2]);

      // 実行
      await user.click(
        within(queryShipTypeList(boostGroupNamed("連合艦隊C")) ?? document.body).getByRole("button", {
          name: "戦艦を外す",
        }),
      );

      // 検証
      expect(shipTypeTags(boostGroupNamed("連合艦隊C"))).toEqual(["駆逐"]);
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      expect(groupCIn(content).shipTypes).toEqual([2]);
    });

    it("最後の艦種を外すと、保存する文書のグループは shipTypes の項目を持たない（国籍・艦名・倍率はそのまま）", async () => {
      // 準備
      const { user, repository } = await renderUsaGroupC([2]);

      // 実行
      await user.click(
        within(queryShipTypeList(boostGroupNamed("連合艦隊C")) ?? document.body).getByRole("button", {
          name: "駆逐を外す",
        }),
      );

      // 検証
      expect(shipTypeTags(boostGroupNamed("連合艦隊C"))).toEqual([]);
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      const groupC = groupCIn(content);
      expect(Object.hasOwn(groupC, "shipTypes")).toBe(false);
      expect(groupC).toMatchObject({
        nationalities: ["usa"],
        multiplier: 1.27,
        shipNames: ["千歳", "千代田", "瑞鳳", "瑞鶴", "初霜", "潮", "響"],
      });
    });
  });

  describe("艦種を選ぶ欄（「＋ 艦種」）", () => {
    it("「＋ 艦種」で艦種を選ぶ欄を開き、19 個のチェックボックスを表示名で、戦艦・航戦・正空…工作の順に並べる", async () => {
      // 準備
      const { user } = await renderUsaGroupC();

      // 実行
      const picker = await openPicker(user);

      // 検証
      const boxes = within(picker).getAllByRole("checkbox");
      expect(boxes).toHaveLength(19);
      SHIP_TYPE_LABELS.forEach((label, index) => {
        expect(boxes[index]).toHaveAccessibleName(label);
        expect(boxes[index]).not.toBeChecked();
      });
    });

    it("欄の中に説明「選ばなければ、選んだ国籍のすべての艦種に効きます」を出す", async () => {
      const { user } = await renderUsaGroupC();

      const picker = await openPicker(user);

      expect(picker).toHaveTextContent(PICKER_NOTE);
    });

    it("選んでいる艦種のチェックボックスはチェック済み（選択肢の番号のどれかを含めば入る：9 だけでも戦艦、22 だけでも補給）", async () => {
      // 準備
      const { user } = await renderUsaGroupC([9, 22]);

      // 実行
      const picker = await openPicker(user);

      // 検証
      expect(within(picker).getByRole("checkbox", { name: "戦艦" })).toBeChecked();
      expect(within(picker).getByRole("checkbox", { name: "補給" })).toBeChecked();
      expect(within(picker).getAllByRole("checkbox", { checked: true })).toHaveLength(2);
      expect(within(picker).getByRole("checkbox", { name: "駆逐" })).not.toBeChecked();
    });

    it("チェックを入れると、すぐ艦種のタグに出て（欄は開いたまま）、保存する文書にも選択肢の番号をすべて正規の順で入れる", async () => {
      // 準備
      const { user, repository } = await renderUsaGroupC();
      const picker = await openPicker(user);

      // 実行：駆逐 → 戦艦の順にチェックする
      await user.click(within(picker).getByRole("checkbox", { name: "駆逐" }));
      await user.click(within(getPicker()).getByRole("checkbox", { name: "戦艦" }));

      // 検証
      expect(shipTypeTags(boostGroupNamed("連合艦隊C"))).toEqual(["戦艦", "駆逐"]);
      expect(within(getPicker()).getByRole("checkbox", { name: "駆逐" })).toBeChecked();
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      expect(groupCIn(content).shipTypes).toEqual([8, 9, 2]);
      // ほかのグループは変わらない
      const groupB = stageIn(content, "E2-3").boosts.find((g) => g.id === "E2-3-B");
      expect(groupB !== undefined && Object.hasOwn(groupB, "shipTypes")).toBe(false);
    });

    it("チェックを外すと、その選択肢の番号をすべて外し（9 だけの戦艦も外れる）、タグと保存する文書から消える", async () => {
      // 準備
      const { user, repository } = await renderUsaGroupC([9, 2]);
      const picker = await openPicker(user);

      // 実行
      await user.click(within(picker).getByRole("checkbox", { name: "戦艦" }));

      // 検証
      expect(shipTypeTags(boostGroupNamed("連合艦隊C"))).toEqual(["駆逐"]);
      expect(within(getPicker()).getByRole("checkbox", { name: "戦艦" })).not.toBeChecked();
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      expect(groupCIn(content).shipTypes).toEqual([2]);
    });

    it("開くと最初のチェックボックス（戦艦）へフォーカスを移す", async () => {
      const { user } = await renderUsaGroupC();

      const picker = await openPicker(user);

      expectFocused(within(picker).getAllByRole("checkbox")[0] ?? null, "最初のチェックボックス");
    });

    it("欄の「閉じる」で欄を閉じ、「＋ 艦種」へフォーカスを戻す。選んだ艦種のタグはそのまま", async () => {
      // 準備
      const { user } = await renderUsaGroupC();
      const picker = await openPicker(user);
      await user.click(within(picker).getByRole("checkbox", { name: "軽巡" }));

      // 実行
      await user.click(within(getPicker()).getByRole("button", { name: "閉じる" }));

      // 検証
      expect(queryPicker()).not.toBeInTheDocument();
      expect(shipTypeTags(boostGroupNamed("連合艦隊C"))).toEqual(["軽巡"]);
      expectFocused(queryAddShipTypeButton(boostGroupNamed("連合艦隊C")), "「＋ 艦種」");
    });

    it("Esc で欄を閉じ、「＋ 艦種」へフォーカスを戻す。選んだ艦種のタグはそのまま", async () => {
      // 準備：チェックボックスを押して、欄の中にフォーカスがある状態にする
      const { user } = await renderUsaGroupC();
      const picker = await openPicker(user);
      await user.click(within(picker).getByRole("checkbox", { name: "海防" }));

      // 実行
      await user.keyboard("{Escape}");

      // 検証
      expect(queryPicker()).not.toBeInTheDocument();
      expect(shipTypeTags(boostGroupNamed("連合艦隊C"))).toEqual(["海防"]);
      expectFocused(queryAddShipTypeButton(boostGroupNamed("連合艦隊C")), "「＋ 艦種」");
    });
  });

  describe("国籍を全部外したとき（艦種だけのグループを作らない）", () => {
    it("最後の国籍のタグを外すと、艦種の行（タグ・「＋ 艦種」）が消え、保存する文書から国籍・艦種の両方が消える", async () => {
      // 準備
      const { user, repository } = await renderUsaGroupC([2]);
      expect(shipTypeTags(boostGroupNamed("連合艦隊C"))).toEqual(["駆逐"]);

      // 実行
      await user.click(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: "アメリカを外す" }));

      // 検証
      const groupC = boostGroupNamed("連合艦隊C");
      expect(queryShipTypeList(groupC)).toBeNull();
      expect(queryAddShipTypeButton(groupC)).toBeNull();
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      const saved = groupCIn(content);
      expect(Object.hasOwn(saved, "nationalities")).toBe(false);
      expect(Object.hasOwn(saved, "shipTypes")).toBe(false);
    });

    it("艦種を選ぶ欄を開いたまま、国籍を選ぶ欄で最後の国籍のチェックを外すと、艦種を選ぶ欄も消える", async () => {
      // 準備：艦種を選ぶ欄と国籍を選ぶ欄の両方を開く
      const { user } = await renderUsaGroupC([2]);
      await openPicker(user);
      await user.click(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: "＋ 国籍" }));

      // 実行
      await user.click(
        within(screen.getByRole("group", { name: "国籍を選ぶ" })).getByRole("checkbox", { name: "アメリカ" }),
      );

      // 検証
      expect(queryPicker()).not.toBeInTheDocument();
      expect(queryAddShipTypeButton(boostGroupNamed("連合艦隊C"))).toBeNull();
    });
  });

  describe("保存", () => {
    it("艦種を変えて保存すると、保存の記録の文に「…の艦種を変更（追加：駆逐）」が入る", async () => {
      // 準備
      const { user, repository } = await renderUsaGroupC();
      const picker = await openPicker(user);
      await user.click(within(picker).getByRole("checkbox", { name: "駆逐" }));

      // 実行
      await user.click(saveDraftButton());

      // 検証
      const input = await savedDraftInput(repository);
      expect(input.logs).toContainEqual({
        mapLabel: "E2",
        summary: "E2 ゲージ3 の特効「連合艦隊C」の艦種を変更（追加：駆逐）",
      });
    });
  });

  describe("外からの文書の差し替えで国籍が空になったとき（PR #39 のレビュー指摘）", () => {
    it("艦種を選ぶ欄を開いたまま、保存で相手の変更（連合艦隊C の国籍を全部外した）を合わせて国籍が空になり、その後に国籍を足しても、艦種を選ぶ欄は閉じている", async () => {
      // 準備：開いたときの版は 連合艦隊C が国籍 アメリカ。相手（版 8）は連合艦隊C の国籍を全部外して先に保存していた
      const draftContent = makeDoc((draft) => {
        const group = draft.stages.flatMap((s) => s.boosts).find((g) => g.id === "E2-3-C");
        if (group === undefined) throw new Error("テスト用の定義に連合艦隊C がありません");
        group.nationalities = ["usa"];
      });
      const theirs = makeDoc();
      const data = makeData({ latestEvent: makeEvent({ draftContent }) });
      const repository = createFakeRepository(data);
      repository.saveDraft.mockResolvedValueOnce({
        status: "conflict",
        version: DRAFT_VERSION + 1,
        content: theirs,
        updatedByName: "協力者B",
        updatedAt: "2026-10-17T11:52:00+09:00",
      });
      const { user } = await renderEditor(data, { repository });
      await selectStage(user, "E2", "ゲージ3");
      // 自分は艦種を選ぶ欄を開いて駆逐を入れる（欄は開いたまま）
      const picker = await openPicker(user);
      await user.click(within(picker).getByRole("checkbox", { name: "駆逐" }));

      // 実行 1：保存する（衝突しないので、相手の変更を合わせた文書に差し替えて保存し直す）
      await user.click(saveDraftButton());
      await savedDraftInput(repository, 2);

      // 検証 1：合わせた文書では連合艦隊C の国籍が空なので、艦種の行も欄も出ない
      await waitFor(() => {
        expect(queryAddShipTypeButton(boostGroupNamed("連合艦隊C"))).toBeNull();
      });
      expect(queryPicker()).not.toBeInTheDocument();

      // 実行 2：国籍を選ぶ欄で、もう一度アメリカを入れる
      await user.click(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: "＋ 国籍" }));
      await user.click(
        within(screen.getByRole("group", { name: "国籍を選ぶ" })).getByRole("checkbox", { name: "アメリカ" }),
      );

      // 検証 2：艦種の行（「＋ 艦種」）は出るが、艦種を選ぶ欄は開いた状態で出ない
      const groupC = boostGroupNamed("連合艦隊C");
      expect(queryAddShipTypeButton(groupC)).not.toBeNull();
      expect(queryAddShipTypeButton(groupC)).toHaveAttribute("aria-expanded", "false");
      expect(queryPicker()).not.toBeInTheDocument();
    });
  });
});
