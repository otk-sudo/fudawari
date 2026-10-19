import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { summer2026Definition } from "@/test/fixtures";
import {
  boostGroupNamed,
  boostGroups,
  detailRegion,
  expectStages,
  expectTextNotShown,
  expectTextShown,
  fixClock,
  fudaItem,
  makeData,
  makeDoc,
  makeEvent,
  renderEditor,
  restoreClock,
  saveDraftButton,
  savedDraftInput,
  selectStage,
  shipNameInput,
  stageButton,
  stageButtons,
  stageIn,
  switchToCreate,
} from "./test-helpers";

// イベント定義の画面の「段階の詳細」と特効グループ（要件 3.7「段階の詳細」、U11・U16、PR-02 レビュー 4・6）
// テスト用の定義の E2 ゲージ3（連合艦隊・難所）の特効：連合艦隊C ×1.27、連合艦隊B ×1.24、連合艦隊A ×1.18

/** テスト用の定義に出てくる艦名すべて（艦船マスタにある艦名として渡す） */
const ALL_SHIP_NAMES: ReadonlySet<string> = new Set(
  summer2026Definition.stages.flatMap((stage) => stage.boosts.flatMap((group) => [...group.shipNames])),
);

const DELETE_CONFIRM_TEXT =
  "「E2 ゲージ3」を削除しますか？ 設定した札・大事さ・特効もまとめて消えます。「変更を公開する」を押すまでは一般の画面には反映されません";
const NO_BOOSTS_TEXT = "この段階の特効は未入力です";
const MULTIPLIER_RANGE = /1 以上 10 以下/;

/** 段階の詳細の「大事さ」のボタン */
function importanceButton(label: string): HTMLElement {
  return within(within(detailRegion()).getByRole("group", { name: "大事さ" })).getByRole("button", { name: label });
}

/** 段階の詳細の「この段階で使う札」の選択肢 */
function fudaChoice(name: string): HTMLElement {
  return within(within(detailRegion()).getByRole("radiogroup", { name: "この段階で使う札" })).getByRole("radio", {
    name,
  });
}

describe("イベント定義の画面（PlanEditor）：段階の詳細", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  describe("段階の名前・札・大事さ", () => {
    it("選んだ段階の海域と段階名・札名、段階の名前の欄、使う札（札の一覧の札から 1 つ）、大事さを出す", async () => {
      // 準備
      const { user } = await renderEditor();

      // 実行
      await selectStage(user, "E2", "ゲージ3");

      // 検証
      const detail = detailRegion();
      expect(detail).toHaveTextContent("E2 ゲージ3");
      expect(detail).toHaveTextContent("連合艦隊");
      expect(within(detail).getByRole("textbox", { name: "段階の名前" })).toHaveValue("ゲージ3");
      const choices = within(within(detail).getByRole("radiogroup", { name: "この段階で使う札" })).getAllByRole(
        "radio",
      );
      expect(choices).toHaveLength(5);
      expect(fudaChoice("連合艦隊")).toBeChecked();
      expect(fudaChoice("第六艦隊")).not.toBeChecked();
      expect(importanceButton("難所")).toHaveAttribute("aria-pressed", "true");
      expect(importanceButton("普通")).toHaveAttribute("aria-pressed", "false");
      expect(importanceButton("重要")).toHaveAttribute("aria-pressed", "false");
    });

    it("段階の名前を変えると、攻略の流れの段階名もすぐ変わり、保存する文書の段階名も変わる", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      const nameBox = within(detailRegion()).getByRole("textbox", { name: "段階の名前" });

      // 実行
      await user.clear(nameBox);
      await user.type(nameBox, "ゲージ3 ボス");

      // 検証
      expect(stageButton("E2", "ゲージ3 ボス")).toHaveAttribute("aria-pressed", "true");
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      expect(stageIn(content, "E2-3").name).toBe("ゲージ3 ボス");
    });

    it("使う札を選び直すと、詳細欄・攻略の流れの札名と、札の一覧の段階の数が変わり、保存する文書の札も変わる", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");

      // 実行
      await user.click(fudaChoice("第六艦隊"));

      // 検証
      expect(fudaChoice("第六艦隊")).toBeChecked();
      expect(detailRegion()).toHaveTextContent("第六艦隊");
      expect(stageButton("E2", "ゲージ3")).toHaveTextContent("第六艦隊");
      expect(fudaItem("連合艦隊")).toHaveTextContent(/1 ?段階/);
      expect(fudaItem("第六艦隊")).toHaveTextContent(/2 ?段階/);
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      expect(stageIn(content, "E2-3").fudaId).toBe("sixth");
    });

    it("大事さを「重要」にすると選んだ状態になり、保存する文書の大事さも変わる", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");

      // 実行
      await user.click(importanceButton("重要"));

      // 検証
      expect(importanceButton("重要")).toHaveAttribute("aria-pressed", "true");
      expect(importanceButton("難所")).toHaveAttribute("aria-pressed", "false");
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      expect(stageIn(content, "E2-3").importance).toBe("important");
    });
  });

  describe("段階の削除", () => {
    it("「この段階を削除」を押すと、削除の確認（「削除する」「やめる」）を出す", async () => {
      // 準備
      const { user } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");

      // 実行
      await user.click(within(detailRegion()).getByRole("button", { name: "この段階を削除" }));

      // 検証
      const confirm = screen.getByRole("alertdialog", { name: "段階の削除の確認" });
      expect(confirm).toHaveTextContent(DELETE_CONFIRM_TEXT);
      expect(within(confirm).getByRole("button", { name: "削除する" })).toBeInTheDocument();
      expect(within(confirm).getByRole("button", { name: "やめる" })).toBeInTheDocument();
    });

    it("削除の確認で「やめる」を押すと、段階を消さずに確認を閉じる", async () => {
      // 準備
      const { user } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      await user.click(within(detailRegion()).getByRole("button", { name: "この段階を削除" }));

      // 実行
      await user.click(
        within(screen.getByRole("alertdialog", { name: "段階の削除の確認" })).getByRole("button", { name: "やめる" }),
      );

      // 検証
      expect(screen.queryByRole("alertdialog", { name: "段階の削除の確認" })).not.toBeInTheDocument();
      expect(stageButtons("E2")).toHaveLength(4);
    });

    it("「削除する」で段階を消し、同じ海域の隣の段階（E2 ゲージ2）を選ぶ。保存する文書からもその段階が消える", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      await user.click(within(detailRegion()).getByRole("button", { name: "この段階を削除" }));

      // 実行
      await user.click(
        within(screen.getByRole("alertdialog", { name: "段階の削除の確認" })).getByRole("button", { name: "削除する" }),
      );

      // 検証
      expectStages("E2", [
        ["ギミック", "第三十一戦隊"],
        ["ゲージ1 輸送", "多号作戦部隊"],
        ["ゲージ2", "連合艦隊"],
      ]);
      expect(detailRegion()).toHaveTextContent("E2 ゲージ2");
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      expect(content.stages.some((s) => s.id === "E2-3")).toBe(false);
    });

    it("イベント全体で段階が 1 つしかないときは「この段階を削除」を押せない", async () => {
      // 準備：E1 の段階だけの下書き
      const draftContent = makeDoc((draft) => {
        draft.stages = draft.stages.filter((s) => s.id === "E1-1");
      });

      // 実行
      await renderEditor(makeData({ latestEvent: makeEvent({ draftContent }) }));

      // 検証
      expect(within(detailRegion()).getByRole("button", { name: "この段階を削除" })).toBeDisabled();
    });

    it("段階がまったくないときは、詳細欄の代わりに段階の作り方の文を出す（新規作成の空の状態）", async () => {
      // 準備
      const { user } = await renderEditor();

      // 実行
      await switchToCreate(user);

      // 検証
      expectTextShown("まだ段階がありません。上の攻略の流れで＋を押して札を選ぶと、ここで中身を編集できます");
      expect(screen.queryByRole("region", { name: "段階の詳細" })).not.toBeInTheDocument();
    });
  });

  describe("この段階のボスで効く特効", () => {
    it("見出し「この段階のボスで効く特効」と「艦名は改装段階を問わず一致します」を出す", async () => {
      // 準備・実行
      await renderEditor();

      // 検証
      expect(detailRegion()).toHaveTextContent("この段階のボスで効く特効");
      expect(detailRegion()).toHaveTextContent("艦名は改装段階を問わず一致します");
    });

    it("特効グループごとに倍率・グループ名・艦名のタグを、定義の順に出す", async () => {
      // 準備
      const { user } = await renderEditor();

      // 実行
      await selectStage(user, "E2", "ゲージ3");

      // 検証
      const groups = boostGroups();
      expect(groups).toHaveLength(3);
      const expected: ReadonlyArray<readonly [number, string]> = [
        [1.27, "連合艦隊C"],
        [1.24, "連合艦隊B"],
        [1.18, "連合艦隊A"],
      ];
      expected.forEach(([multiplier, name], index) => {
        const group = groups[index] as HTMLElement;
        expect(within(group).getByRole("spinbutton", { name: "倍率" })).toHaveValue(multiplier);
        expect(within(group).getByRole("textbox", { name: "グループ名" })).toHaveValue(name);
      });
      const groupC = boostGroupNamed("連合艦隊C");
      for (const ship of ["千歳", "千代田", "瑞鳳", "瑞鶴", "初霜", "潮", "響"]) {
        expect(within(groupC).getByText(ship)).toBeInTheDocument();
      }
      expect(within(groupC).getByRole("button", { name: "＋ 艦名" })).toBeInTheDocument();
    });

    it("特効がない段階では「この段階の特効は未入力です」を出す", async () => {
      // 準備
      const { user } = await renderEditor();

      // 実行：E3 ギミックは特効なし
      await selectStage(user, "E3", "ギミック");

      // 検証
      expect(detailRegion()).toHaveTextContent(NO_BOOSTS_TEXT);
      expect(boostGroups()).toHaveLength(0);
    });

    it("「＋ 特効グループを追加」で空のグループ（倍率 1・名前なし）を足し、未入力の文を消す。保存する文書にも入る", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await selectStage(user, "E3", "ギミック");

      // 実行
      await user.click(within(detailRegion()).getByRole("button", { name: "＋ 特効グループを追加" }));

      // 検証
      const groups = boostGroups();
      expect(groups).toHaveLength(1);
      expect(within(groups[0] as HTMLElement).getByRole("spinbutton", { name: "倍率" })).toHaveValue(1);
      expect(within(groups[0] as HTMLElement).getByRole("textbox", { name: "グループ名" })).toHaveValue("");
      expect(detailRegion()).not.toHaveTextContent(NO_BOOSTS_TEXT);
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      expect(stageIn(content, "E3-G").boosts).toEqual([
        expect.objectContaining({ name: "", multiplier: 1, shipNames: [] }),
      ]);
    });

    it("倍率をその場で変えて確定すると、保存する文書の倍率が変わる", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      const multiplier = within(boostGroupNamed("連合艦隊C")).getByRole("spinbutton", { name: "倍率" });

      // 実行
      await user.clear(multiplier);
      await user.type(multiplier, "1.3");
      await user.tab();
      await user.click(saveDraftButton());

      // 検証
      const { content } = await savedDraftInput(repository);
      expect(stageIn(content, "E2-3").boosts.find((g) => g.id === "E2-3-C")?.multiplier).toBe(1.3);
    });

    it("倍率は上限の 10 まで入れられる", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      const multiplier = within(boostGroupNamed("連合艦隊C")).getByRole("spinbutton", { name: "倍率" });

      // 実行
      await user.clear(multiplier);
      await user.type(multiplier, "10");
      await user.tab();
      await user.click(saveDraftButton());

      // 検証
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      const { content } = await savedDraftInput(repository);
      expect(stageIn(content, "E2-3").boosts.find((g) => g.id === "E2-3-C")?.multiplier).toBe(10);
    });

    it.each([
      ["10 より大きい", "12"],
      ["1 より小さい", "0.5"],
    ])("倍率を%s値（%s）にして確定すると「1 以上 10 以下」の範囲を示すエラーを出す", async (_label, value) => {
      // 準備
      const { user } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      const multiplier = within(boostGroupNamed("連合艦隊C")).getByRole("spinbutton", { name: "倍率" });

      // 実行
      await user.clear(multiplier);
      await user.type(multiplier, value);
      await user.tab();

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent(MULTIPLIER_RANGE);
    });

    it("グループ名をその場で変えて確定すると、保存する文書のグループ名が変わる", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      const nameBox = within(boostGroupNamed("連合艦隊C")).getByRole("textbox", { name: "グループ名" });

      // 実行
      await user.clear(nameBox);
      await user.type(nameBox, "連合艦隊C（第二）");
      await user.tab();
      await user.click(saveDraftButton());

      // 検証
      const { content } = await savedDraftInput(repository);
      expect(stageIn(content, "E2-3").boosts.find((g) => g.id === "E2-3-C")?.name).toBe("連合艦隊C（第二）");
    });

    it("艦名のタグの × で艦名を外す。保存する文書の艦名からも消える", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      const groupC = boostGroupNamed("連合艦隊C");

      // 実行
      await user.click(within(groupC).getByRole("button", { name: /^千歳を(外す|削除)$/ }));

      // 検証
      expect(within(boostGroupNamed("連合艦隊C")).queryByText("千歳")).not.toBeInTheDocument();
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      const shipNames = stageIn(content, "E2-3").boosts.find((g) => g.id === "E2-3-C")?.shipNames;
      expect(shipNames).toEqual(["千代田", "瑞鳳", "瑞鶴", "初霜", "潮", "響"]);
    });

    it("特効グループの × でグループを消す。保存する文書からも消える", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");

      // 実行
      await user.click(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: /グループ.*削除/ }));

      // 検証
      expect(boostGroups()).toHaveLength(2);
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      expect(stageIn(content, "E2-3").boosts.map((g) => g.id)).toEqual(["E2-3-B", "E2-3-A"]);
    });

    it("「＋ 艦名」で艦名を入れて Enter を押すと、前後の空白を除いた艦名のタグを最後に足す。保存する文書にも入る", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");

      // 実行
      await user.click(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: "＋ 艦名" }));
      await user.type(
        shipNameInput(boostGroupNamed("連合艦隊C")),
        " 雪風 {Enter}",
      );

      // 検証
      expect(within(boostGroupNamed("連合艦隊C")).getByText("雪風")).toBeInTheDocument();
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      const shipNames = stageIn(content, "E2-3").boosts.find((g) => g.id === "E2-3-C")?.shipNames;
      expect(shipNames?.at(-1)).toBe("雪風");
    });

    it("「攻略サイトの艦名リストを貼り付け」で貼った艦名の一覧から、新しい特効グループを作る（区切りの読み取り・空白と重複の除去）", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      await user.click(within(detailRegion()).getByRole("button", { name: "攻略サイトの艦名リストを貼り付け" }));
      await user.click(within(detailRegion()).getByRole("textbox", { name: "艦名リスト" }));

      // 実行：読点・改行・スラッシュの区切り、前後の空白、重複を含む
      await user.paste("雪風、時雨\n 浜風 /雪風");
      await user.click(within(detailRegion()).getByRole("button", { name: "特効グループとして追加" }));

      // 検証
      const groups = boostGroups();
      expect(groups).toHaveLength(4);
      const added = groups[3] as HTMLElement;
      for (const ship of ["雪風", "時雨", "浜風"]) {
        expect(within(added).getAllByText(ship)).toHaveLength(1);
      }
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      const boosts = stageIn(content, "E2-3").boosts;
      expect(boosts).toHaveLength(4);
      expect(boosts[3]?.shipNames).toEqual(["雪風", "時雨", "浜風"]);
    });

    it("貼り付けの「やめる」で、特効グループを作らずに閉じる", async () => {
      // 準備
      const { user } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      await user.click(within(detailRegion()).getByRole("button", { name: "攻略サイトの艦名リストを貼り付け" }));
      await user.click(within(detailRegion()).getByRole("textbox", { name: "艦名リスト" }));
      await user.paste("雪風、時雨");

      // 実行
      await user.click(within(detailRegion()).getByRole("button", { name: "やめる" }));

      // 検証
      expect(within(detailRegion()).queryByRole("textbox", { name: "艦名リスト" })).not.toBeInTheDocument();
      expect(boostGroups()).toHaveLength(3);
    });
  });

  describe("知らない艦名の警告（PR-02 レビュー 4）", () => {
    it("艦船マスタにない艦名を足すと「艦船マスタにない艦名」とその艦名を警告する（タグは足す）", async () => {
      // 準備
      const { user } = await renderEditor(makeData(), { knownShipNames: ALL_SHIP_NAMES });
      await selectStage(user, "E2", "ゲージ3");

      // 実行
      await user.click(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: "＋ 艦名" }));
      await user.type(
        shipNameInput(boostGroupNamed("連合艦隊C")),
        "ユキカゼ{Enter}",
      );

      // 検証
      // タグを足したこと（警告の文にも艦名が出るため、タグの × ボタンで確かめる）
      expect(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: /^ユキカゼを(外す|削除)$/ })).toBeInTheDocument();
      expectTextShown("艦船マスタにない艦名", "ユキカゼ");
    });

    it("読み込んだ定義の艦名でも、艦船マスタにない艦名は警告する", async () => {
      // 準備：響がマスタにない
      const known = new Set([...ALL_SHIP_NAMES].filter((name) => name !== "響"));
      const { user } = await renderEditor(makeData(), { knownShipNames: known });

      // 実行
      await selectStage(user, "E2", "ゲージ3");

      // 検証
      expectTextShown("艦船マスタにない艦名", "響");
    });

    it("艦名がすべて艦船マスタにあれば警告しない", async () => {
      // 準備
      const { user } = await renderEditor(makeData(), { knownShipNames: ALL_SHIP_NAMES });

      // 実行
      await selectStage(user, "E2", "ゲージ3");

      // 検証
      expect(boostGroups()).toHaveLength(3);
      expectTextNotShown("艦船マスタにない艦名");
    });

    it("艦船マスタの艦名を渡していなければ警告しない", async () => {
      // 準備
      const { user } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");

      // 実行
      await user.click(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: "＋ 艦名" }));
      await user.type(
        shipNameInput(boostGroupNamed("連合艦隊C")),
        "ユキカゼ{Enter}",
      );

      // 検証
      // タグを足したこと（警告の文にも艦名が出るため、タグの × ボタンで確かめる）
      expect(within(boostGroupNamed("連合艦隊C")).getByRole("button", { name: /^ユキカゼを(外す|削除)$/ })).toBeInTheDocument();
      expectTextNotShown("艦船マスタにない艦名");
    });
  });
});
