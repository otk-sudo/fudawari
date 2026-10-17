import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DefinitionDoc } from "@/domain/definition-edit";
import type { Mutable } from "@/test/fixtures";
import { expectInDocumentOrder } from "@/test/dom-order";
import {
  boostGroupNamed,
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

// イベント定義の画面の特効グループの国籍（v1.1「特効グループに国籍の条件を足す」の仕様 7 章）
//
// 部品の公開する形（実装の担当向け。テストはこの形で探す）
// - 特効グループ（group「特効グループ n：グループ名」）の中、艦名のタグ（<ul aria-label="艦名">）の下に国籍の行
// - 選んだ国籍のタグの一覧は <ul aria-label="国籍">。タグは表示名（例「アメリカ」）で、並びは文書の順（BOOST_NATIONALITIES の順）。
//   タグの × はボタン（aria-label「アメリカを外す」）。国籍がないときは、この一覧を出さなくてもよい
// - グループの中にボタン「＋ 国籍」。押すと国籍を選ぶ欄（role="group"。<fieldset> と <legend>「国籍を選ぶ」でよい）を開く。
//   欄の中に 12 か国のチェックボックス（ラベルは表示名。日本・アメリカ・イギリス・ドイツ・イタリア・フランス・ソ連・オランダ・
//   オーストラリア・スウェーデン・ノルウェー・タイの順）。選んでいる国籍はチェック済み。
//   チェックを入れる・外すと、すぐ文書に反映する（setGroupNationalities。欄は開いたまま）
// - 欄の中のボタン「閉じる」か Esc で欄を閉じる（閉じても選んだ国籍はそのまま）
// - 艦名も国籍もないグループでも誤りにはしない（今と同じ）
//
// テスト用の定義の E2 ゲージ3（連合艦隊・難所）の特効：連合艦隊C ×1.27、連合艦隊B ×1.24、連合艦隊A ×1.18（どれも国籍なし）

/** 仕様の表示名（BOOST_NATIONALITIES の順） */
const NATIONALITY_LABELS = [
  "日本",
  "アメリカ",
  "イギリス",
  "ドイツ",
  "イタリア",
  "フランス",
  "ソ連",
  "オランダ",
  "オーストラリア",
  "スウェーデン",
  "ノルウェー",
  "タイ",
] as const;

/** 2026夏イベの文書の、E2 ゲージ3 の連合艦隊C を書き換えた下書きで画面を描く */
async function renderWithGroupC(change: (group: Record<string, unknown>) => void) {
  const draftContent = makeDoc((draft: Mutable<DefinitionDoc>) => {
    const group = draft.stages.flatMap((s) => s.boosts).find((g) => g.id === "E2-3-C");
    if (group === undefined) throw new Error("テスト用の定義に連合艦隊C がありません");
    change(group as unknown as Record<string, unknown>);
  });
  return renderEditor(makeData({ latestEvent: makeEvent({ draftContent }) }));
}

/** 特効グループの国籍のタグの一覧（<ul aria-label="国籍">）。なければ null */
function queryNationalityList(group: HTMLElement): HTMLElement | null {
  return within(group).queryByRole("list", { name: "国籍" });
}

/** 特効グループの国籍のタグ（表示名。並びは画面の順）。タグの × の aria-label「〇〇を外す」から読む */
function nationalityTags(group: HTMLElement): string[] {
  const list = queryNationalityList(group);
  if (list === null) return [];
  return within(list)
    .queryAllByRole("button", { name: /を外す$/ })
    .map((button) => (button.getAttribute("aria-label") ?? "").replace(/を外す$/, ""));
}

/** 国籍を選ぶ欄（role="group"「国籍を選ぶ」）。なければ null */
function queryPicker(): HTMLElement | null {
  return screen.queryByRole("group", { name: "国籍を選ぶ" });
}

/** 国籍を選ぶ欄（開いていなければテストを失敗させる） */
function getPicker(): HTMLElement {
  return screen.getByRole("group", { name: "国籍を選ぶ" });
}

/** 連合艦隊C の「＋ 国籍」を押して、国籍を選ぶ欄を開く */
async function openPicker(user: UserEvent): Promise<HTMLElement> {
  await user.click(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: "＋ 国籍" }));
  return getPicker();
}

/** 保存した文書の連合艦隊C */
function groupCIn(content: DefinitionDoc) {
  const group = stageIn(content, "E2-3").boosts.find((g) => g.id === "E2-3-C");
  if (group === undefined) throw new Error("保存した文書に連合艦隊C がありません");
  return group;
}

describe("イベント定義の画面（PlanEditor）：特効グループの国籍（v1.1）", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  describe("国籍のタグ", () => {
    it("国籍を持つグループは、艦名のタグの下に、国籍のタグ（表示名）を文書の順に出す", async () => {
      // 準備
      const { user } = await renderWithGroupC((group) => {
        group.nationalities = ["usa", "uk"];
      });

      // 実行
      await selectStage(user, "E2", "ゲージ3");

      // 検証
      const groupC = boostGroupNamed("連合艦隊C");
      expect(nationalityTags(groupC)).toEqual(["アメリカ", "イギリス"]);
      const list = queryNationalityList(groupC);
      expect(list).not.toBeNull();
      if (list !== null) {
        expectInDocumentOrder([within(groupC).getByRole("list", { name: "艦名" }), list]);
        expect(within(list).getByText("アメリカ")).toBeInTheDocument();
      }
    });

    it("国籍のないグループには国籍のタグを出さず、「＋ 国籍」ボタンを出す", async () => {
      // 準備
      const { user } = await renderEditor();

      // 実行
      await selectStage(user, "E2", "ゲージ3");

      // 検証
      for (const name of ["連合艦隊C", "連合艦隊B", "連合艦隊A"]) {
        const group = boostGroupNamed(name);
        expect(nationalityTags(group), name).toEqual([]);
        expect(within(group).getByRole("button", { name: "＋ 国籍" })).toBeInTheDocument();
      }
      expect(queryPicker()).not.toBeInTheDocument();
    });

    it("国籍のタグの ×（「アメリカを外す」）でその国籍を外す。保存する文書の国籍からも消える", async () => {
      // 準備
      const { user, repository } = await renderWithGroupC((group) => {
        group.nationalities = ["usa", "uk"];
      });
      await selectStage(user, "E2", "ゲージ3");

      // 実行
      await user.click(
        within(queryNationalityList(boostGroupNamed("連合艦隊C")) ?? document.body).getByRole("button", {
          name: "アメリカを外す",
        }),
      );

      // 検証
      expect(nationalityTags(boostGroupNamed("連合艦隊C"))).toEqual(["イギリス"]);
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      expect(groupCIn(content).nationalities).toEqual(["uk"]);
    });

    it("最後の国籍を外すと、保存する文書のグループは nationalities の項目を持たない（艦名・倍率はそのまま）", async () => {
      // 準備
      const { user, repository } = await renderWithGroupC((group) => {
        group.nationalities = ["germany"];
      });
      await selectStage(user, "E2", "ゲージ3");

      // 実行
      await user.click(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: "ドイツを外す" }));

      // 検証
      expect(nationalityTags(boostGroupNamed("連合艦隊C"))).toEqual([]);
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      const groupC = groupCIn(content);
      expect(Object.hasOwn(groupC, "nationalities")).toBe(false);
      expect(groupC).toMatchObject({ multiplier: 1.27, shipNames: ["千歳", "千代田", "瑞鳳", "瑞鶴", "初霜", "潮", "響"] });
    });
  });

  describe("国籍を選ぶ欄（「＋ 国籍」）", () => {
    it("「＋ 国籍」で国籍を選ぶ欄を開き、12 か国のチェックボックスを表示名で、日本・アメリカ・イギリス…タイの順に並べる", async () => {
      // 準備
      const { user } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");

      // 実行
      const picker = await openPicker(user);

      // 検証
      const boxes = within(picker).getAllByRole("checkbox");
      expect(boxes).toHaveLength(12);
      NATIONALITY_LABELS.forEach((label, index) => {
        expect(boxes[index]).toHaveAccessibleName(label);
        expect(boxes[index]).not.toBeChecked();
      });
    });

    it("選んでいる国籍のチェックボックスはチェック済み", async () => {
      // 準備
      const { user } = await renderWithGroupC((group) => {
        group.nationalities = ["usa", "uk"];
      });
      await selectStage(user, "E2", "ゲージ3");

      // 実行
      const picker = await openPicker(user);

      // 検証
      expect(within(picker).getByRole("checkbox", { name: "アメリカ" })).toBeChecked();
      expect(within(picker).getByRole("checkbox", { name: "イギリス" })).toBeChecked();
      expect(within(picker).getAllByRole("checkbox", { checked: true })).toHaveLength(2);
      expect(within(picker).getByRole("checkbox", { name: "日本" })).not.toBeChecked();
    });

    it("チェックを入れると、すぐ国籍のタグに出て（欄は開いたまま）、保存する文書にも BOOST_NATIONALITIES の順で入る", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      const picker = await openPicker(user);

      // 実行：イギリス → アメリカの順にチェックする
      await user.click(within(picker).getByRole("checkbox", { name: "イギリス" }));
      await user.click(within(getPicker()).getByRole("checkbox", { name: "アメリカ" }));

      // 検証
      expect(nationalityTags(boostGroupNamed("連合艦隊C"))).toEqual(["アメリカ", "イギリス"]);
      expect(within(getPicker()).getByRole("checkbox", { name: "アメリカ" })).toBeChecked();
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      expect(groupCIn(content).nationalities).toEqual(["usa", "uk"]);
      // ほかのグループは変わらない
      const groupB = stageIn(content, "E2-3").boosts.find((g) => g.id === "E2-3-B");
      expect(groupB !== undefined && Object.hasOwn(groupB, "nationalities")).toBe(false);
    });

    it("チェックを外すと、すぐ国籍のタグから消え、保存する文書からも消える", async () => {
      // 準備
      const { user, repository } = await renderWithGroupC((group) => {
        group.nationalities = ["usa", "uk"];
      });
      await selectStage(user, "E2", "ゲージ3");
      const picker = await openPicker(user);

      // 実行
      await user.click(within(picker).getByRole("checkbox", { name: "アメリカ" }));

      // 検証
      expect(nationalityTags(boostGroupNamed("連合艦隊C"))).toEqual(["イギリス"]);
      expect(within(getPicker()).getByRole("checkbox", { name: "アメリカ" })).not.toBeChecked();
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      expect(groupCIn(content).nationalities).toEqual(["uk"]);
    });

    it("欄の「閉じる」で欄を閉じる。選んだ国籍のタグはそのまま", async () => {
      // 準備
      const { user } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      const picker = await openPicker(user);
      await user.click(within(picker).getByRole("checkbox", { name: "ドイツ" }));

      // 実行
      await user.click(within(getPicker()).getByRole("button", { name: "閉じる" }));

      // 検証
      expect(queryPicker()).not.toBeInTheDocument();
      expect(nationalityTags(boostGroupNamed("連合艦隊C"))).toEqual(["ドイツ"]);
      expect(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: "＋ 国籍" })).toBeInTheDocument();
    });

    it("Esc で欄を閉じる。選んだ国籍のタグはそのまま", async () => {
      // 準備：チェックボックスを押して、欄の中にフォーカスがある状態にする
      const { user } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      const picker = await openPicker(user);
      await user.click(within(picker).getByRole("checkbox", { name: "イタリア" }));

      // 実行
      await user.keyboard("{Escape}");

      // 検証
      expect(queryPicker()).not.toBeInTheDocument();
      expect(nationalityTags(boostGroupNamed("連合艦隊C"))).toEqual(["イタリア"]);
    });
  });

  describe("保存", () => {
    it("国籍を変えて保存すると、保存の記録の文に「…の国籍を変更（追加：アメリカ）」が入る", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      const picker = await openPicker(user);
      await user.click(within(picker).getByRole("checkbox", { name: "アメリカ" }));

      // 実行
      await user.click(saveDraftButton());

      // 検証
      const input = await savedDraftInput(repository);
      expect(input.logs).toContainEqual({
        mapLabel: "E2",
        summary: "E2 ゲージ3 の特効「連合艦隊C」の国籍を変更（追加：アメリカ）",
      });
    });

    it("艦名がなく国籍だけのグループも誤りにせず保存できる", async () => {
      // 準備：連合艦隊C の艦名を空にし、国籍をアメリカだけにした下書き
      const { user, repository } = await renderWithGroupC((group) => {
        group.shipNames = [];
        group.nationalities = ["usa"];
      });
      await selectStage(user, "E2", "ゲージ3");
      const picker = await openPicker(user);
      await user.click(within(picker).getByRole("checkbox", { name: "イギリス" }));

      // 実行
      await user.click(saveDraftButton());

      // 検証
      const { content } = await savedDraftInput(repository);
      expect(groupCIn(content)).toMatchObject({ shipNames: [], nationalities: ["usa", "uk"] });
    });
  });
});
