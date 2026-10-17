import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN,
  AUTUMN_EVENT_ID,
  autumn2025Definition,
  blurInput,
  COLLAB,
  createFakeRepository,
  CREATED_EVENT_ID,
  detailRegion,
  DRAFT_VERSION,
  enterDateTime,
  expectStages,
  expectTextNotShown,
  expectTextShown,
  fixClock,
  fudaItem,
  fudaItems,
  LATEST_EVENT_ID,
  makeData,
  makeDoc,
  makeEvent,
  publishAsLatestButton,
  publishButton,
  queryAreaRow,
  renderEditor,
  restoreClock,
  saveDraftButton,
  savedDraftInput,
  selectStage,
  stageIn,
  switchToCreate,
  textContaining,
} from "./test-helpers";

// イベント定義の画面の「下書きを保存」「変更を公開する」「新規作成」（要件 3.7、roadmap T3-8・T3-11 の画面の部分）
// 保管庫の関数を正しい引数で呼ぶところまでを確かめる（Supabase の RPC での実装、衝突の確認のウィンドウは PR-11b）。
//
// 決めたこと（実装の担当・PR-11b の担当向け）
// - 「変更を公開する」は、保存していない変更があれば先に下書きを保存し、返った版を公開する（publish_definition は保存済みの下書きを公開するため）。
//   変更がなければ、読み込んだ（最後に保存した）版をそのまま公開する
// - 新規作成の「公開して最新にする」は、イベントを作成（create_event）してから、返った版を最新にして公開する
// - 新規作成の「下書きを保存」は、1 回目はイベントを作成し、2 回目からは作成したイベントの下書きを保存する
// - 保存の前の文書の問題（findDocumentIssues）は、理由を文で出してボタンを押せなくする。
//   ただし段階が 1 つもない（no_stages）ことは、下書きの保存では止めず、公開では止める

const NO_STAGES = "段階が 1 つもありません。段階を 1 つ以上置いてください";
const NEED_NAME_AND_START = "イベント名と開始日時を入力してください";
const END_BEFORE_START = "終了日時は開始日時より後にしてください";

/**
 * 保存済みの下書きに、公開中から未公開の変更（E2 ゲージ3 の大事さを「重要」）がある状態の読み込み結果。
 * 画面で何も変えていなくても、公開する内容がある
 */
function dataWithUnpublishedDraft(user = ADMIN): ReturnType<typeof makeData> {
  const draftContent = makeDoc((draft) => {
    const e23 = draft.stages.find((s) => s.id === "E2-3");
    if (e23 === undefined) throw new Error("テスト用の定義に段階がありません");
    e23.importance = "important";
  });
  return makeData({ user, latestEvent: makeEvent({ draftContent }) });
}

/** E2 ゲージ3 の大事さを「重要」に変える（保存していない変更を作る） */
async function changeE23Importance(user: UserEvent): Promise<void> {
  await selectStage(user, "E2", "ゲージ3");
  await user.click(within(within(detailRegion()).getByRole("group", { name: "大事さ" })).getByRole("button", { name: "重要" }));
}

/** 新規作成のイベント名・開始日時・終了日時を入れる（空文字の欄は入れない） */
async function fillNewEvent(user: UserEvent, fields: { name: string; start: string; end: string }): Promise<void> {
  if (fields.name !== "") {
    await user.type(screen.getByRole("textbox", { name: "イベント名" }), fields.name);
  }
  if (fields.start !== "") {
    enterDateTime(screen.getByLabelText(/^開始日時/), fields.start);
    blurInput(screen.getByLabelText(/^開始日時/));
  }
  if (fields.end !== "") {
    enterDateTime(screen.getByLabelText(/^終了日時/), fields.end);
    blurInput(screen.getByLabelText(/^終了日時/));
  }
}

/** 新規作成の「元にするイベント」を選ぶ（文書の読み込みは非同期なので、写した段階が出るのは呼び出し側で待つ） */
async function chooseBase(user: UserEvent, optionText: string): Promise<void> {
  await user.selectOptions(screen.getByRole("combobox", { name: "元にするイベント" }), optionText);
}

describe("イベント定義の画面（PlanEditor）：下書きの保存・公開・新規作成", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  describe("下書きの保存（既存を更新）", () => {
    it("「下書きを保存」で、イベント ID・開いたときの版・変えた文書・保存の記録の文を渡して保存し、保存したことを伝える", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await changeE23Importance(user);

      // 実行
      await user.click(saveDraftButton());

      // 検証
      const input = await savedDraftInput(repository);
      expect(input.eventId).toBe(LATEST_EVENT_ID);
      expect(input.baseVersion).toBe(DRAFT_VERSION);
      expect(stageIn(input.content, "E2-3").importance).toBe("important");
      expect(input.logs).toContainEqual({
        mapLabel: "E2",
        summary: expect.stringContaining("E2 ゲージ3 の大事さを「難所」→「重要」"),
      });
      expect(await screen.findAllByText(textContaining("下書きを保存しました"))).not.toHaveLength(0);
    });

    it("2 回目の保存では、1 回目の保存で返った版（8）を開いたときの版として渡す", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await changeE23Importance(user);
      await user.click(saveDraftButton());
      await savedDraftInput(repository, 1);

      // 実行
      await user.click(within(within(detailRegion()).getByRole("group", { name: "大事さ" })).getByRole("button", { name: "普通" }));
      await user.click(saveDraftButton());

      // 検証
      const second = await savedDraftInput(repository, 2);
      expect(second.baseVersion).toBe(DRAFT_VERSION + 1);
      expect(stageIn(second.content, "E2-3").importance).toBe("normal");
    });

    it("保存に失敗したら、理由を警告（role=alert）で出す", async () => {
      // 準備
      const repository = createFakeRepository();
      repository.saveDraft.mockRejectedValue(new Error("このイベントは終了したため、更新できません"));
      const { user } = await renderEditor(undefined, { repository });
      await changeE23Importance(user);

      // 実行
      await user.click(saveDraftButton());

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent("このイベントは終了したため、更新できません");
    });

    it("保存できない内容（段階の名前が空）なら、保存を呼ばず、理由を警告（role=alert）で出す", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      await user.clear(within(detailRegion()).getByRole("textbox", { name: "段階の名前" }));

      // 実行
      await user.click(saveDraftButton());

      // 検証
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(repository.saveDraft).not.toHaveBeenCalled();
    });

    it("文書に問題（別々の札に同じ札番号）があれば、理由の文を出し、「下書きを保存」「変更を公開する」を押せなくする", async () => {
      // 準備：第六艦隊の札番号を連合艦隊と同じ 3 にした下書き（2 人の保存を合わせた結果など）
      const draftContent = makeDoc((draft) => {
        const sixth = draft.fudas.find((f) => f.id === "sixth");
        if (sixth === undefined) throw new Error("テスト用の定義に札がありません");
        sixth.gameNumber = 3;
      });

      // 実行
      await renderEditor(makeData({ latestEvent: makeEvent({ draftContent }) }));

      // 検証
      expectTextShown("札番号 3 が「連合艦隊」と「第六艦隊」で重複しています");
      expect(saveDraftButton()).toBeDisabled();
      expect(publishButton()).toBeDisabled();
    });

    it("文書の問題を直すと（札番号を 5 にする）、理由の文を消し、ボタンを押せるようにする", async () => {
      // 準備
      const draftContent = makeDoc((draft) => {
        const sixth = draft.fudas.find((f) => f.id === "sixth");
        if (sixth === undefined) throw new Error("テスト用の定義に札がありません");
        sixth.gameNumber = 3;
      });
      const { user } = await renderEditor(makeData({ latestEvent: makeEvent({ draftContent }) }));

      // 実行：札の編集の欄で第六艦隊の札番号を 5 にする
      await user.click(within(fudaItem("第六艦隊")).getByRole("button", { name: /編集/ }));
      const form = screen.getByRole("form", { name: "札を編集" });
      const numberBox = within(form).getByLabelText(/^札番号/);
      await user.clear(numberBox);
      await user.type(numberBox, "5");
      await user.click(within(form).getByRole("button", { name: "変更する" }));

      // 検証
      expectTextNotShown("札番号 3 が「連合艦隊」と「第六艦隊」で重複しています");
      expect(saveDraftButton()).toBeEnabled();
      expect(publishButton()).toBeEnabled();
    });
  });

  describe("変更を公開する（既存を更新）", () => {
    it("協力者にも「変更を公開する」を出す", async () => {
      // 準備・実行
      await renderEditor(dataWithUnpublishedDraft(COLLAB));

      // 検証
      expect(publishButton()).toBeEnabled();
    });

    it("保存していない変更があれば、先に下書きを保存し、返った版（8）を最新にせずに公開する", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await changeE23Importance(user);

      // 実行
      await user.click(publishButton());

      // 検証
      await waitFor(() => {
        expect(repository.publish).toHaveBeenCalledWith({
          eventId: LATEST_EVENT_ID,
          baseVersion: DRAFT_VERSION + 1,
          makeLatest: false,
        });
      });
      const saved = await savedDraftInput(repository);
      expect(saved.baseVersion).toBe(DRAFT_VERSION);
      expect(stageIn(saved.content, "E2-3").importance).toBe("important");
      const saveOrder = repository.saveDraft.mock.invocationCallOrder[0] ?? Infinity;
      const publishOrder = repository.publish.mock.invocationCallOrder[0] ?? -Infinity;
      expect(saveOrder).toBeLessThan(publishOrder);
    });

    it("保存していない変更がなければ、下書きを保存せず、読み込んだ版（7）を公開する", async () => {
      // 準備：保存済みの下書きに未公開の変更がある
      const { user, repository } = await renderEditor(dataWithUnpublishedDraft());

      // 実行
      await user.click(publishButton());

      // 検証
      await waitFor(() => {
        expect(repository.publish).toHaveBeenCalledWith({
          eventId: LATEST_EVENT_ID,
          baseVersion: DRAFT_VERSION,
          makeLatest: false,
        });
      });
      expect(repository.saveDraft).not.toHaveBeenCalled();
    });

    it("協力者が公開しても、最新にはしない（makeLatest は false）", async () => {
      // 準備
      const { user, repository } = await renderEditor(dataWithUnpublishedDraft(COLLAB));

      // 実行
      await user.click(publishButton());

      // 検証
      await waitFor(() => {
        expect(repository.publish).toHaveBeenCalledWith(expect.objectContaining({ makeLatest: false }));
      });
    });

    it("公開したら、公開中の版の表示を新しい版（2026/10/17 版）に変え、「未公開の変更」を消す", async () => {
      // 準備
      const { user } = await renderEditor();
      await changeE23Importance(user);

      // 実行
      await user.click(publishButton());

      // 検証
      await waitFor(() => {
        expectTextShown("公開中：2026/10/17 版");
      });
      expectTextNotShown("未公開の変更");
    });

    it("公開に失敗したら、理由を警告（role=alert）で出す", async () => {
      // 準備
      const repository = createFakeRepository(dataWithUnpublishedDraft());
      repository.publish.mockRejectedValue(new Error("下書きの版が違うため、公開できません"));
      const { user } = await renderEditor(undefined, { repository });

      // 実行
      await user.click(publishButton());

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent("下書きの版が違うため、公開できません");
    });
  });

  describe("新規作成（管理者）", () => {
    it("新規作成に切り替えると、元にするイベント・イベント名・開始日時・終了日時の欄と「公開して最新にする」を出し、E1 だけの空の状態から始める", async () => {
      // 準備
      const { user } = await renderEditor(makeData({ user: ADMIN }));

      // 実行
      await switchToCreate(user);

      // 検証
      expect(screen.getByRole("radio", { name: "新規作成" })).toBeChecked();
      const base = screen.getByRole("combobox", { name: "元にするイベント" });
      expect(within(base).getAllByRole("option").map((option) => option.textContent)).toEqual([
        "使わない（空から作る）",
        "2026夏イベ",
        "2025秋イベ",
      ]);
      expect(base).toHaveDisplayValue("使わない（空から作る）");
      expectTextShown("元にすると札と段階をコピーして始めます（特効は空）");
      expect(screen.getByRole("textbox", { name: "イベント名" })).toHaveValue("");
      expect(screen.getByLabelText(/^開始日時/)).toHaveValue("");
      expect(screen.getByLabelText(/^終了日時/)).toHaveValue("");
      expectTextShown("終了日時は未定なら空欄で構いません（あとから入れられます）");
      expect(publishAsLatestButton()).toBeInTheDocument();
      expect(saveDraftButton()).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "変更を公開する" })).not.toBeInTheDocument();
      expect(queryAreaRow("E1")).toBeInTheDocument();
      expect(queryAreaRow("E2")).not.toBeInTheDocument();
      expect(fudaItems()).toHaveLength(0);
      expectTextShown("まだ公開していません");
    });

    it("元にするイベントを選ぶと、そのイベントの文書を読み、札と段階を写して始める（特効は空）", async () => {
      // 準備
      const { user, repository } = await renderEditor(makeData({ user: ADMIN }));
      await switchToCreate(user);

      // 実行
      await chooseBase(user, "2025秋イベ");

      // 検証
      expect(repository.loadEventContent).toHaveBeenCalledWith(AUTUMN_EVENT_ID);
      await waitFor(() => {
        expectStages("E1", [["ゲージ1", "機動部隊"]]);
      });
      expectStages("E2", [["ゲージ2 輸送", "輸送部隊"]]);
      expect(fudaItems()).toHaveLength(2);
      await selectStage(user, "E1", "ゲージ1");
      expect(detailRegion()).toHaveTextContent("この段階の特効は未入力です");
    });

    it.each([
      ["イベント名と開始日時が空", "イベント名と開始日時を入力してください", { name: "", start: "", end: "" }],
      ["開始日時が空", "開始日時を入力してください", { name: "2026秋イベ", start: "", end: "" }],
      ["イベント名が空", "イベント名を入力してください", { name: "", start: "2026-11-14T11:00", end: "" }],
    ])("%sのまま「公開して最新にする」を押すと「%s」を出し、作成も公開もしない", async (_label, message, fields) => {
      // 準備：段階のある状態にする（元にするイベントを選ぶ）
      const { user, repository } = await renderEditor(makeData({ user: ADMIN }));
      await switchToCreate(user);
      await chooseBase(user, "2025秋イベ");
      await waitFor(() => {
        expectStages("E1", [["ゲージ1", "機動部隊"]]);
      });
      await fillNewEvent(user, fields);

      // 実行
      await user.click(publishAsLatestButton());

      // 検証：片方だけが空なら、2 つまとめた文は出さない
      expectTextShown(message);
      if (message !== NEED_NAME_AND_START) expectTextNotShown(NEED_NAME_AND_START);
      expect(repository.createEvent).not.toHaveBeenCalled();
      expect(repository.publish).not.toHaveBeenCalled();
    });

    it("終了日時が開始日時以前なら「終了日時は開始日時より後にしてください」を出し、「公開して最新にする」で作成しない", async () => {
      // 準備
      const { user, repository } = await renderEditor(makeData({ user: ADMIN }));
      await switchToCreate(user);
      await chooseBase(user, "2025秋イベ");
      await waitFor(() => {
        expectStages("E1", [["ゲージ1", "機動部隊"]]);
      });

      // 実行
      await fillNewEvent(user, { name: "2026秋イベ", start: "2026-11-14T11:00", end: "2026-11-14T11:00" });

      // 検証：押す前から出す
      expectTextShown(END_BEFORE_START);
      await user.click(publishAsLatestButton());
      expect(repository.createEvent).not.toHaveBeenCalled();
    });

    it("段階が 1 つもなければ、理由の文を出して「公開して最新にする」を押せなくする（下書きの保存は押せる）", async () => {
      // 準備
      const { user } = await renderEditor(makeData({ user: ADMIN }));
      await switchToCreate(user);

      // 実行
      await fillNewEvent(user, { name: "2026秋イベ", start: "2026-11-14T11:00", end: "" });

      // 検証
      expectTextShown(NO_STAGES);
      expect(publishAsLatestButton()).toBeDisabled();
      expect(saveDraftButton()).toBeEnabled();
    });

    it("段階が 1 つもなくても「下書きを保存」はでき、名前・日時と文書を渡してイベントを作成する", async () => {
      // 準備
      const { user, repository } = await renderEditor(makeData({ user: ADMIN }));
      await switchToCreate(user);
      await fillNewEvent(user, { name: "2026秋イベ", start: "2026-11-14T11:00", end: "" });

      // 実行
      await user.click(saveDraftButton());

      // 検証
      await waitFor(() => {
        expect(repository.createEvent).toHaveBeenCalledTimes(1);
      });
      const input = repository.createEvent.mock.calls[0]?.[0];
      expect(input).toMatchObject({ name: "2026秋イベ", startAt: "2026-11-14T11:00+09:00", endAt: null });
      expect(input?.content.stages).toEqual([]);
      expect(input?.content.areas.map((a) => a.name)).toEqual(["E1"]);
      expect(repository.publish).not.toHaveBeenCalled();
    });

    it("新規作成の 2 回目の「下書きを保存」は、作成したイベントの下書き（版 1）を保存する（作成は 1 回だけ）", async () => {
      // 準備
      const { user, repository } = await renderEditor(makeData({ user: ADMIN }));
      await switchToCreate(user);
      await chooseBase(user, "2025秋イベ");
      await waitFor(() => {
        expectStages("E1", [["ゲージ1", "機動部隊"]]);
      });
      await fillNewEvent(user, { name: "2026秋イベ", start: "2026-11-14T11:00", end: "" });
      await user.click(saveDraftButton());
      await waitFor(() => {
        expect(repository.createEvent).toHaveBeenCalledTimes(1);
      });

      // 実行
      await selectStage(user, "E1", "ゲージ1");
      await user.click(within(within(detailRegion()).getByRole("group", { name: "大事さ" })).getByRole("button", { name: "難所" }));
      await user.click(saveDraftButton());

      // 検証
      const input = await savedDraftInput(repository);
      expect(input.eventId).toBe(CREATED_EVENT_ID);
      expect(input.baseVersion).toBe(1);
      expect(stageIn(input.content, "A-E1-1").importance).toBe("hard");
      expect(repository.createEvent).toHaveBeenCalledTimes(1);
    });

    it("新規作成の「下書きを保存」も、イベント名と開始日時が空なら「イベント名と開始日時を入力してください」を出して作成しない", async () => {
      // 準備
      const { user, repository } = await renderEditor(makeData({ user: ADMIN }));
      await switchToCreate(user);

      // 実行
      await user.click(saveDraftButton());

      // 検証
      expectTextShown(NEED_NAME_AND_START);
      expect(repository.createEvent).not.toHaveBeenCalled();
    });

    it("「公開して最新にする」で、イベントを作成してから、返った版（1）を最新にして公開する（期間の更新は呼ばない）", async () => {
      // 準備
      const { user, repository } = await renderEditor(makeData({ user: ADMIN }));
      await switchToCreate(user);
      await chooseBase(user, "2025秋イベ");
      await waitFor(() => {
        expectStages("E1", [["ゲージ1", "機動部隊"]]);
      });
      await fillNewEvent(user, { name: "2026秋イベ", start: "2026-11-14T11:00", end: "2026-12-02T11:00" });

      // 実行
      await user.click(publishAsLatestButton());

      // 検証
      await waitFor(() => {
        expect(repository.publish).toHaveBeenCalledWith({
          eventId: CREATED_EVENT_ID,
          baseVersion: 1,
          makeLatest: true,
        });
      });
      expect(repository.createEvent).toHaveBeenCalledTimes(1);
      const input = repository.createEvent.mock.calls[0]?.[0];
      expect(input).toMatchObject({
        name: "2026秋イベ",
        startAt: "2026-11-14T11:00+09:00",
        endAt: "2026-12-02T11:00+09:00",
      });
      expect(input?.content.fudas).toEqual(autumn2025Definition.fudas);
      expect(input?.content.stages.map((s) => ({ name: s.name, fudaId: s.fudaId, boosts: s.boosts }))).toEqual([
        { name: "ゲージ1", fudaId: "kido", boosts: [] },
        { name: "ゲージ2 輸送", fudaId: "yuso", boosts: [] },
      ]);
      const createOrder = repository.createEvent.mock.invocationCallOrder[0] ?? Infinity;
      const publishOrder = repository.publish.mock.invocationCallOrder[0] ?? -Infinity;
      expect(createOrder).toBeLessThan(publishOrder);
      expect(repository.updateEventMeta).not.toHaveBeenCalled();
    });

    it("「既存を更新」に戻すと、最新のイベントの内容に戻る", async () => {
      // 準備
      const { user } = await renderEditor(makeData({ user: ADMIN }));
      await switchToCreate(user);

      // 実行
      await user.click(screen.getByRole("radio", { name: "既存を更新" }));

      // 検証
      expect(screen.getByRole("radio", { name: "既存を更新" })).toBeChecked();
      expectStages("E2", [
        ["ギミック", "第三十一戦隊"],
        ["ゲージ1 輸送", "多号作戦部隊"],
        ["ゲージ2", "連合艦隊"],
        ["ゲージ3", "連合艦隊"],
      ]);
      expect(publishButton()).toBeInTheDocument();
    });

    describe("未公開の新規イベントがある（U18：管理者が作成して、まだ公開していない）", () => {
      const unpublishedEvent = (): ReturnType<typeof makeEvent> =>
        makeEvent({
          id: "2026-autumn",
          name: "2026秋イベ",
          startAt: "2026-11-14T11:00:00+09:00",
          draftContent: autumn2025Definition,
          draftVersion: 3,
          publishedContent: null,
        });

      it("新規作成に切り替えると、そのイベントの名前・開始日時・文書から続きを始める", async () => {
        // 準備
        const { user } = await renderEditor(makeData({ user: ADMIN, unpublishedEvent: unpublishedEvent() }));

        // 実行
        await switchToCreate(user);

        // 検証
        expect(screen.getByRole("textbox", { name: "イベント名" })).toHaveValue("2026秋イベ");
        expect(screen.getByLabelText(/^開始日時/)).toHaveValue("2026-11-14T11:00");
        expectStages("E1", [["ゲージ1", "機動部隊"]]);
      });

      it("「下書きを保存」は、イベントを作成せず、そのイベントの下書き（版 3）を保存する", async () => {
        // 準備
        const { user, repository } = await renderEditor(
          makeData({ user: ADMIN, unpublishedEvent: unpublishedEvent() }),
        );
        await switchToCreate(user);
        await selectStage(user, "E1", "ゲージ1");
        await user.click(within(within(detailRegion()).getByRole("group", { name: "大事さ" })).getByRole("button", { name: "重要" }));

        // 実行
        await user.click(saveDraftButton());

        // 検証
        const input = await savedDraftInput(repository);
        expect(input.eventId).toBe("2026-autumn");
        expect(input.baseVersion).toBe(3);
        expect(repository.createEvent).not.toHaveBeenCalled();
      });

      it("「公開して最新にする」は、イベントを作成せず、そのイベントを最新にして公開する", async () => {
        // 準備
        const { user, repository } = await renderEditor(
          makeData({ user: ADMIN, unpublishedEvent: unpublishedEvent() }),
        );
        await switchToCreate(user);

        // 実行
        await user.click(publishAsLatestButton());

        // 検証
        await waitFor(() => {
          expect(repository.publish).toHaveBeenCalledWith({ eventId: "2026-autumn", baseVersion: 3, makeLatest: true });
        });
        expect(repository.createEvent).not.toHaveBeenCalled();
      });
    });

    it("最新のイベントがまだない（初めてのイベント）なら、管理者は初めから新規作成になる", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: ADMIN, latestEvent: null }));

      // 検証
      expect(screen.getByRole("radio", { name: "新規作成" })).toBeChecked();
      expect(publishAsLatestButton()).toBeInTheDocument();
    });
  });
});
