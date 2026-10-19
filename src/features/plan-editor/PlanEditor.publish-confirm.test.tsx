import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DefinitionDoc } from "@/domain/definition-edit";
import { type Mutable, summer2026Definition } from "@/test/fixtures";
import {
  ADMIN,
  autumn2025Definition,
  boostGroups,
  confirmPublish,
  detailRegion,
  DRAFT_VERSION,
  expectTextShown,
  findPublishConfirm,
  fixClock,
  LATEST_EVENT_ID,
  makeData,
  makeDoc,
  makeEvent,
  publishAsLatestButton,
  publishButton,
  queryPublishConfirm,
  renderEditor,
  restoreClock,
  savedDraftInput,
  selectStage,
  stageIn,
  switchToCreate,
} from "./test-helpers";
import type { PlanEditorData } from "./types";

// イベント定義の画面の、公開の前の確認（UI／UX の指摘 中8。親が決めた直し方・ユーザーの承認済み）
//
// 指摘：空の特効グループ（名前なし・×1・艦名なし・国籍なし）をそのまま公開でき、公開はボタン一つで即実行される。
// 直し方
// - 「変更を公開する」「公開して最新にする」を押したら、確認のウィンドウ（role="alertdialog"）を出す。
//   中身は警告の一覧と「公開する」「やめる」。警告がなくても確認は出す（「公開すると一般の画面に反映されます」）
// - 警告：空の特効グループ（段階名とともに）、ゲーム内の札番号が未入力の札（差分の対象外になる）、艦船マスタにない艦名
// - 「やめる」なら公開しない（下書きの保存もしない）。空の特効グループは保存のときに除かず、警告だけ（ユーザーが消す）
//
// 部品の公開する形（実装の担当向け。テストはこの形で探す）
// - 確認のウィンドウ：role="alertdialog"、名前「公開の確認」（test-helpers の PUBLISH_CONFIRM_NAME）。
//   中にボタン「公開する」「やめる」
// - 警告の文は要点の語句で確かめる：「空の特効グループ」と段階名（海域名＋段階名。例「E3 ギミック」）、
//   札名と「札番号」「差分」、「艦船マスタにない」と艦名。警告がないときは「公開すると一般の画面に反映されます」
// - 警告は文書全体（今選んでいない段階を含む）から集める
// - 「やめる」で閉じたら、押した公開のボタンにフォーカスを戻す（保存の確認のウィンドウと同じ扱い）
// - 「公開する」の後の流れ（保存していない変更があれば先に下書きを保存して公開する、など）は今のまま
//
// 既存のテストで、仕様が変わったため確認の「公開する」を押す手順（confirmPublish）を足したもの：
// PlanEditor.save／lifecycle／pr12b／review／conflict／followups の各テストの公開のボタンを押す所

/** テスト用の定義に出てくる艦名すべて（艦船マスタにある艦名として渡す） */
const ALL_SHIP_NAMES: ReadonlySet<string> = new Set(
  summer2026Definition.stages.flatMap((stage) => stage.boosts.flatMap((group) => [...group.shipNames])),
);

/** 警告がないときの文 */
const NO_WARNING_NOTE = "公開すると一般の画面に反映されます";
/** 空の特効グループの警告の語句 */
const EMPTY_GROUP_PHRASE = "空の特効グループ";
/** 札番号が未入力の札の警告の語句 */
const GAME_NUMBER_PHRASE = "札番号";
/** 札番号が未入力の札は差分の対象外になることの語句 */
const DRIFT_PHRASE = "差分";
/** 艦船マスタにない艦名の警告の語句 */
const UNKNOWN_SHIP_PHRASE = "艦船マスタにない";

/** 下書きを書き換えた読み込み結果（公開中の版は 2026夏イベのまま。画面で何も変えなくても公開できる） */
function dataWithDraft(change: (draft: Mutable<DefinitionDoc>) => void): PlanEditorData {
  return makeData({ latestEvent: makeEvent({ draftContent: makeDoc(change) }) });
}

/** E2 ゲージ3 の大事さを「重要」に変える（保存していない変更を作る） */
async function changeE23Importance(user: UserEvent): Promise<void> {
  await selectStage(user, "E2", "ゲージ3");
  await user.click(within(within(detailRegion()).getByRole("group", { name: "大事さ" })).getByRole("button", { name: "重要" }));
}

/** 確認のウィンドウの中のボタン */
function dialogButton(dialog: HTMLElement, name: "公開する" | "やめる"): HTMLElement {
  return within(dialog).getByRole("button", { name });
}

describe("イベント定義の画面（PlanEditor）：公開の前の確認（UI／UX の指摘 中8）", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  describe("確認のウィンドウ", () => {
    it("「変更を公開する」を押すと、確認のウィンドウ（名前「公開の確認」）に「公開する」「やめる」を出し、この時点では下書きの保存も公開もしない", async () => {
      // 準備：保存していない変更がある
      const { user, repository } = await renderEditor(makeData(), { knownShipNames: ALL_SHIP_NAMES });
      await changeE23Importance(user);

      // 実行
      await user.click(publishButton());

      // 検証
      const dialog = await findPublishConfirm();
      expect(dialogButton(dialog, "公開する")).toBeInTheDocument();
      expect(dialogButton(dialog, "やめる")).toBeInTheDocument();
      expect(repository.saveDraft).not.toHaveBeenCalled();
      expect(repository.publish).not.toHaveBeenCalled();
    });

    it("警告がないときも確認を出し、「公開すると一般の画面に反映されます」と書く（警告の語句は出さない）", async () => {
      // 準備：空の特効グループなし・札番号はすべて入力済み・艦名はすべて艦船マスタにある
      const { user } = await renderEditor(makeData(), { knownShipNames: ALL_SHIP_NAMES });
      await changeE23Importance(user);

      // 実行
      await user.click(publishButton());

      // 検証
      const dialog = await findPublishConfirm();
      expect(dialog).toHaveTextContent(NO_WARNING_NOTE);
      expect(dialog).not.toHaveTextContent(EMPTY_GROUP_PHRASE);
      expect(dialog).not.toHaveTextContent(GAME_NUMBER_PHRASE);
      expect(dialog).not.toHaveTextContent(UNKNOWN_SHIP_PHRASE);
    });

    it("「公開する」を押すと確認を閉じ、保存していない変更を下書きに保存してから、返った版（8）を公開する", async () => {
      // 準備
      const { user, repository } = await renderEditor(makeData(), { knownShipNames: ALL_SHIP_NAMES });
      await changeE23Importance(user);
      await user.click(publishButton());
      const dialog = await findPublishConfirm();

      // 実行
      await user.click(dialogButton(dialog, "公開する"));

      // 検証
      await waitFor(() => {
        expect(repository.publish).toHaveBeenCalledWith({
          eventId: LATEST_EVENT_ID,
          baseVersion: DRAFT_VERSION + 1,
          makeLatest: false,
        });
      });
      expect(repository.publish).toHaveBeenCalledTimes(1);
      const saved = await savedDraftInput(repository);
      expect(stageIn(saved.content, "E2-3").importance).toBe("important");
      expect(queryPublishConfirm()).not.toBeInTheDocument();
      await waitFor(() => {
        expectTextShown("変更を公開しました");
      });
    });

    it("「やめる」を押すと確認を閉じ、下書きの保存も公開もせず、編集した内容は残り、フォーカスは「変更を公開する」に戻る", async () => {
      // 準備
      const { user, repository } = await renderEditor(makeData(), { knownShipNames: ALL_SHIP_NAMES });
      await changeE23Importance(user);
      await user.click(publishButton());
      const dialog = await findPublishConfirm();

      // 実行
      await user.click(dialogButton(dialog, "やめる"));

      // 検証
      await waitFor(() => {
        expect(queryPublishConfirm()).not.toBeInTheDocument();
      });
      expect(repository.saveDraft).not.toHaveBeenCalled();
      expect(repository.publish).not.toHaveBeenCalled();
      expect(
        within(within(detailRegion()).getByRole("group", { name: "大事さ" })).getByRole("button", { name: "重要" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(publishButton()).toHaveFocus();
    });
  });

  describe("警告の一覧", () => {
    it("空の特効グループ（名前なし・×1・艦名なし・国籍なし）が、選んでいない段階（E3 ギミック）にあっても、「空の特効グループ」と段階名を警告する", async () => {
      // 準備：E3 ギミック（特効なし）に空の特効グループを置いた下書き。開いたときに選ばれているのは E1 の段階
      const data = dataWithDraft((draft) => {
        const stage = draft.stages.find((s) => s.id === "E3-G");
        if (stage === undefined) throw new Error("テスト用の定義に E3 ギミックがありません");
        stage.boosts.push({ id: "E3-G-X", name: "", multiplier: 1, shipNames: [] });
      });
      const { user } = await renderEditor(data, { knownShipNames: ALL_SHIP_NAMES });

      // 実行
      await user.click(publishButton());

      // 検証
      const dialog = await findPublishConfirm();
      expect(dialog).toHaveTextContent(EMPTY_GROUP_PHRASE);
      expect(dialog).toHaveTextContent("E3 ギミック");
    });

    it("国籍だけの特効グループ（名前なし・艦名なし・アメリカ ×1.2）は、空の特効グループとして警告しない", async () => {
      // 準備：要件 3.7 の例「米艦 ×1.2」の形（艦名を入れずに国籍だけを選んだグループ）
      const data = dataWithDraft((draft) => {
        const stage = draft.stages.find((s) => s.id === "E3-G");
        if (stage === undefined) throw new Error("テスト用の定義に E3 ギミックがありません");
        stage.boosts.push({ id: "E3-G-U", name: "", multiplier: 1.2, shipNames: [], nationalities: ["usa"] });
      });
      const { user } = await renderEditor(data, { knownShipNames: ALL_SHIP_NAMES });

      // 実行
      await user.click(publishButton());

      // 検証
      const dialog = await findPublishConfirm();
      expect(dialog).not.toHaveTextContent(EMPTY_GROUP_PHRASE);
    });

    it("画面で足した空の特効グループは、警告するが除かずに、そのまま下書きに保存して公開する", async () => {
      // 準備：E2 ゲージ3 に「＋ 特効グループを追加」で空のグループを足す
      const { user, repository } = await renderEditor(makeData(), { knownShipNames: ALL_SHIP_NAMES });
      await selectStage(user, "E2", "ゲージ3");
      await user.click(within(detailRegion()).getByRole("button", { name: "＋ 特効グループを追加" }));
      expect(boostGroups()).toHaveLength(4);
      await user.click(publishButton());
      const dialog = await findPublishConfirm();
      expect(dialog).toHaveTextContent(EMPTY_GROUP_PHRASE);
      expect(dialog).toHaveTextContent("E2 ゲージ3");

      // 実行
      await user.click(dialogButton(dialog, "公開する"));

      // 検証
      const saved = await savedDraftInput(repository);
      const boosts = stageIn(saved.content, "E2-3").boosts;
      expect(boosts).toHaveLength(4);
      expect(boosts[3]).toMatchObject({ name: "", multiplier: 1, shipNames: [] });
      await waitFor(() => {
        expect(repository.publish).toHaveBeenCalledTimes(1);
      });
    });

    it("ゲーム内の札番号が未入力の札（多号作戦部隊）があると、札名と、札番号が未入力で差分の対象外になることを警告する", async () => {
      // 準備
      const data = dataWithDraft((draft) => {
        const fuda = draft.fudas.find((f) => f.id === "tago");
        if (fuda === undefined) throw new Error("テスト用の定義に多号作戦部隊がありません");
        fuda.gameNumber = null;
      });
      const { user } = await renderEditor(data, { knownShipNames: ALL_SHIP_NAMES });

      // 実行
      await user.click(publishButton());

      // 検証
      const dialog = await findPublishConfirm();
      expect(dialog).toHaveTextContent("多号作戦部隊");
      expect(dialog).toHaveTextContent(GAME_NUMBER_PHRASE);
      expect(dialog).toHaveTextContent(DRIFT_PHRASE);
    });

    it("艦船マスタにない艦名（選んでいない段階 E2 ゲージ3 の千代田）があると、「艦船マスタにない」とその艦名を警告する", async () => {
      // 準備：千代田がマスタにない
      const known = new Set([...ALL_SHIP_NAMES].filter((name) => name !== "千代田"));
      const { user } = await renderEditor(makeData(), { knownShipNames: known });
      await changeE23Importance(user);
      await selectStage(user, "E1", "ギミック〜ゲージ3");

      // 実行
      await user.click(publishButton());

      // 検証
      const dialog = await findPublishConfirm();
      expect(dialog).toHaveTextContent(UNKNOWN_SHIP_PHRASE);
      expect(dialog).toHaveTextContent("千代田");
    });

    it("艦船マスタの艦名を渡していなければ（マスタを読めない）、艦船マスタにない艦名の警告は出さない", async () => {
      // 準備
      const { user } = await renderEditor();
      await changeE23Importance(user);

      // 実行
      await user.click(publishButton());

      // 検証
      const dialog = await findPublishConfirm();
      expect(dialog).not.toHaveTextContent(UNKNOWN_SHIP_PHRASE);
    });
  });

  describe("新規作成の「公開して最新にする」", () => {
    /** 未公開の新規イベント（2026秋イベ。2025秋イベの文書、下書きの版 3） */
    const unpublishedEvent = (): ReturnType<typeof makeEvent> =>
      makeEvent({
        id: "2026-autumn",
        name: "2026秋イベ",
        startAt: "2026-11-14T11:00:00+09:00",
        draftContent: autumn2025Definition,
        draftVersion: 3,
        publishedContent: null,
      });

    it("「公開して最新にする」でも確認を出し、「公開する」を押すと最新にして公開する", async () => {
      // 準備
      const { user, repository } = await renderEditor(makeData({ user: ADMIN, unpublishedEvent: unpublishedEvent() }));
      await switchToCreate(user);

      // 実行
      await user.click(publishAsLatestButton());
      const dialog = await findPublishConfirm();
      expect(repository.publish).not.toHaveBeenCalled();
      await confirmPublish(user);

      // 検証
      await waitFor(() => {
        expect(repository.publish).toHaveBeenCalledWith({ eventId: "2026-autumn", baseVersion: 3, makeLatest: true });
      });
      expect(dialog).not.toBeInTheDocument();
    });

    it("「公開して最新にする」の確認で「やめる」を押すと、作成も公開もしない", async () => {
      // 準備
      const { user, repository } = await renderEditor(makeData({ user: ADMIN, unpublishedEvent: unpublishedEvent() }));
      await switchToCreate(user);
      await user.click(publishAsLatestButton());
      const dialog = await findPublishConfirm();

      // 実行
      await user.click(dialogButton(dialog, "やめる"));

      // 検証
      await waitFor(() => {
        expect(queryPublishConfirm()).not.toBeInTheDocument();
      });
      expect(repository.createEvent).not.toHaveBeenCalled();
      expect(repository.publish).not.toHaveBeenCalled();
      expect(screen.getByRole("radio", { name: "新規作成" })).toBeChecked();
    });
  });
});
