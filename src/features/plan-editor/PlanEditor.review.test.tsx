import { act, render, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DefinitionDoc } from "@/domain/definition-edit";
import { summer2026Definition } from "@/test/fixtures";
import { PlanEditor } from "./PlanEditor";
import {
  ADMIN,
  AUTUMN_EVENT_ID,
  autumn2025Definition,
  blurInput,
  boostGroupNamed,
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
  LATEST_NAME,
  LATEST_START,
  makeData,
  makeEvent,
  publishAsLatestButton,
  publishButton,
  PUBLISH_RESULT,
  renderEditor,
  restoreClock,
  saveDraftButton,
  savedDraftInput,
  selectStage,
  stageButton,
  stageIn,
  switchToCreate,
  textContaining,
} from "./test-helpers";
import type { CreatedEvent, PublishResult, SaveDraftResult } from "./types";

// イベント定義の画面（PR-11a）のレビュー・Codex の指摘への直し方を、先に画面テストにしたもの（TDD の Red）。
// 直し方は親（取りまとめ）が決めた。番号は親の指示の番号
//  1. 元にするイベントの選択は、イベントを作る前だけ（レビュー M1）
//  2. 元にするイベントの読み込みに失敗したら、選択を前の値に戻す（レビュー M2・Codex）
//  3. 札の編集で名前を空にして「変更する」と、理由を出して閉じない（レビュー M3）
//  4. 新規作成の 1 回目の保存（createEvent）の間は、イベント名・日時の欄を操作できない（Codex）
//  5. 終了したイベントに「開催中」を出さない（Codex）
//  6. イベント名・日時の更新は 1 つずつ順に送り、終わるまで保存・公開を待つ（Codex）
//  7. 艦名の入力で Esc を押した後に開き直しても、入力した艦名が消えない（Codex）
//  8. 入力の誤りがある間は保存・公開を押せない（レビュー提案 1）
//  9. 新規作成でも終了日時が今以前なら「終了日時は今より後にしてください」（レビュー提案 2）
// 10. 協力者で最新のイベントがないときの文（レビュー提案 5）
// 11. イベント名・日時の更新に失敗したら、表示を保存済みの値に戻し、理由を出す（レビュー提案 5）
// 12. 既存のイベントの下書きの保存・公開の途中は、イベント名・日時の欄を操作できない（Codex）
// 13. 元にするイベントの読み込みは、要求ごとの番号で新しさを見分ける（Codex）
//
// 今は 2026-10-17 12:00（日本時間）。最新のイベントは 2026夏イベ（開始 2026/08/07 12:00、終了日時は未定）

const END_BEFORE_START = "終了日時は開始日時より後にしてください";
const END_IN_PAST_SHORT = "終了日時は今より後にしてください";
const MULTIPLIER_RANGE = /1 以上 10 以下/;
const NO_EVENT_FOR_COLLAB = "更新できるイベントがありません。管理者が新規作成するまでお待ちください";

/** イベント名の入力欄 */
function nameInput(): HTMLElement {
  return screen.getByRole("textbox", { name: "イベント名" });
}

/** 開始日時の入力欄（新規作成では「必須」の印が付くため前方一致で探す） */
function startInput(): HTMLElement {
  return screen.getByLabelText(/^開始日時/);
}

/** 終了日時の入力欄（「任意」の印が付くため前方一致で探す） */
function endInput(): HTMLElement {
  return screen.getByLabelText(/^終了日時/);
}

/** 新規作成の「元にするイベント」の選択欄 */
function baseSelect(): HTMLElement {
  return screen.getByRole("combobox", { name: "元にするイベント" });
}

/** 新規作成の「元にするイベント」の選択欄（なければ null） */
function queryBaseSelect(): HTMLElement | null {
  return screen.queryByRole("combobox", { name: "元にするイベント" });
}

/** 新規作成の「元にするイベント」を選ぶ（文書の読み込みは非同期なので、写した段階が出るのは呼び出し側で待つ） */
async function chooseBase(user: UserEvent, optionText: string): Promise<void> {
  await user.selectOptions(baseSelect(), optionText);
}

/** 新規作成で、元にするイベントに 2025秋イベを選び、写した段階が出るまで待つ */
async function startFromAutumn(user: UserEvent): Promise<void> {
  await switchToCreate(user);
  await chooseBase(user, "2025秋イベ");
  await waitFor(() => {
    expectStages("E1", [["ゲージ1", "機動部隊"]]);
  });
}

/** 新規作成のイベント名・開始日時・終了日時を入れて確定する（空文字の欄は入れない） */
async function fillNewEvent(user: UserEvent, fields: { name: string; start: string; end: string }): Promise<void> {
  if (fields.name !== "") {
    await user.type(nameInput(), fields.name);
  }
  if (fields.start !== "") {
    enterDateTime(startInput(), fields.start);
    blurInput(startInput());
  }
  if (fields.end !== "") {
    enterDateTime(endInput(), fields.end);
    blurInput(endInput());
  }
}

/** 段階の詳細の「大事さ」のボタン */
function importanceButton(label: string): HTMLElement {
  return within(within(detailRegion()).getByRole("group", { name: "大事さ" })).getByRole("button", { name: label });
}

/** E2 ゲージ3 の大事さを「重要」に変える（保存していない変更を作る） */
async function changeE23Importance(user: UserEvent): Promise<void> {
  await selectStage(user, "E2", "ゲージ3");
  await user.click(importanceButton("重要"));
}

/** 入力欄を操作できない（disabled か readOnly）ことを確かめる */
function expectLocked(input: HTMLElement, label: string): void {
  const element = input as HTMLInputElement;
  expect(element.disabled || element.readOnly, `${label}の欄を操作できない（disabled か readOnly）`).toBe(true);
}

/** 入力欄を操作できる（disabled でも readOnly でもない）ことを確かめる */
function expectEditable(input: HTMLElement, label: string): void {
  const element = input as HTMLInputElement;
  expect(element.disabled || element.readOnly, `${label}の欄を操作できる`).toBe(false);
}

/** 「元にするイベント」の選択欄が出ていないか、押せない（disabled）ことを確かめる */
function expectBaseChoiceLocked(): void {
  const select = queryBaseSelect() as HTMLSelectElement | null;
  expect(select === null || select.disabled, "「元にするイベント」の選択欄が出ていないか、押せない").toBe(true);
}

/** 待っている処理（Promise の続きとタイマー 1 回分）を進める */
async function flushPending(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("イベント定義の画面（PlanEditor）：レビュー・Codex の指摘の直し方", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  describe("1. 元にするイベントの選択は、イベントを作る前だけ（レビュー M1）", () => {
    it("新規作成の 1 回目の「下書きを保存」でイベントを作った後は、「元にするイベント」を選べず、作成したイベントの文書を置き換えない", async () => {
      // 準備：2025秋イベを元にして、イベントを作成する
      const { user, repository } = await renderEditor(makeData({ user: ADMIN }));
      await startFromAutumn(user);
      await fillNewEvent(user, { name: "2026秋イベ", start: "2026-11-14T11:00", end: "" });

      // 実行
      await user.click(saveDraftButton());
      await waitFor(() => {
        expect(repository.createEvent).toHaveBeenCalledTimes(1);
      });
      expect(await screen.findByText(textContaining("下書きを保存しました"))).toBeInTheDocument();

      // 検証：選択欄を出さないか、押せない
      expectBaseChoiceLocked();

      // 実行：（出ていれば）別のイベントを選ぼうとする
      const select = queryBaseSelect();
      if (select !== null) await user.selectOptions(select, "2026夏イベ");

      // 検証：文書を読み直さず、作成したイベントの段階のまま
      expect(repository.loadEventContent).toHaveBeenCalledTimes(1);
      expectStages("E1", [["ゲージ1", "機動部隊"]]);
      expectStages("E2", [["ゲージ2 輸送", "輸送部隊"]]);
    });

    const unpublishedEvent = (): ReturnType<typeof makeEvent> =>
      makeEvent({
        id: "2026-autumn",
        name: "2026秋イベ",
        startAt: "2026-11-14T11:00:00+09:00",
        draftContent: autumn2025Definition,
        draftVersion: 3,
        publishedContent: null,
      });

    it("未公開の新規イベントの続き（新規作成に切り替えたとき）では、「元にするイベント」を選べない", async () => {
      // 準備
      const { user, repository } = await renderEditor(makeData({ user: ADMIN, unpublishedEvent: unpublishedEvent() }));

      // 実行
      await switchToCreate(user);

      // 検証：続きの文書が出ていることを確かめてから、選択欄を見る
      expectStages("E1", [["ゲージ1", "機動部隊"]]);
      expectBaseChoiceLocked();
      expect(repository.loadEventContent).not.toHaveBeenCalled();
    });

    it("未公開の新規イベントの続き（最新のイベントがまだなく、初めから新規作成）でも、「元にするイベント」を選べない", async () => {
      // 準備・実行
      const { repository } = await renderEditor(
        makeData({ user: ADMIN, latestEvent: null, unpublishedEvent: unpublishedEvent() }),
      );

      // 検証
      expect(screen.getByRole("radio", { name: "新規作成" })).toBeChecked();
      expectStages("E1", [["ゲージ1", "機動部隊"]]);
      expectBaseChoiceLocked();
      expect(repository.loadEventContent).not.toHaveBeenCalled();
    });
  });

  describe("2. 元にするイベントの読み込みに失敗したら、選択を前の値に戻す（レビュー M2・Codex）", () => {
    it("読み込みに失敗したら理由を知らせ、選択欄と状態の文を前の値（使わない）に戻す。同じイベントを選び直せる", async () => {
      // 準備：1 回目の読み込みだけ失敗する
      const repository = createFakeRepository(makeData({ user: ADMIN }));
      repository.loadEventContent.mockRejectedValueOnce(new Error("通信に失敗しました（テスト）"));
      const { user } = await renderEditor(undefined, { repository });
      await switchToCreate(user);

      // 実行
      await chooseBase(user, "2025秋イベ");

      // 検証：失敗の知らせと理由
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/読み込め/);
      expect(alert).toHaveTextContent("通信に失敗しました（テスト）");
      // 検証：選択欄・状態の文・文書は前の値（使わない）のまま
      expect(baseSelect()).toHaveDisplayValue("使わない（空から作る）");
      expectTextShown("まだ公開していません");
      expectTextNotShown("2025秋イベを元に作成");
      expect(fudaItems()).toHaveLength(0);

      // 実行：同じイベントを選び直す
      await chooseBase(user, "2025秋イベ");

      // 検証：読み直して、札と段階を写す
      expect(repository.loadEventContent).toHaveBeenCalledTimes(2);
      expect(repository.loadEventContent).toHaveBeenLastCalledWith(AUTUMN_EVENT_ID);
      await waitFor(() => {
        expectStages("E1", [["ゲージ1", "機動部隊"]]);
      });
      expect(baseSelect()).toHaveDisplayValue("2025秋イベ");
      expectTextShown("2025秋イベを元に作成");
    });

    it("前に別のイベント（2026夏イベ）を元にしていたら、読み込みに失敗したとき、選択欄・状態の文・文書をそのイベントのままにする", async () => {
      // 準備：2026夏イベを元にする（成功）
      const repository = createFakeRepository(makeData({ user: ADMIN }));
      const { user } = await renderEditor(undefined, { repository });
      await switchToCreate(user);
      await chooseBase(user, "2026夏イベ");
      await waitFor(() => {
        expectStages("E1", [["ギミック〜ゲージ3", "第三十一戦隊"]]);
      });
      repository.loadEventContent.mockRejectedValueOnce(new Error("通信に失敗しました（テスト）"));

      // 実行
      await chooseBase(user, "2025秋イベ");

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent("通信に失敗しました（テスト）");
      expect(baseSelect()).toHaveDisplayValue("2026夏イベ");
      expectTextShown("2026夏イベを元に作成");
      expectTextNotShown("2025秋イベを元に作成");
      expectStages("E1", [["ギミック〜ゲージ3", "第三十一戦隊"]]);
      expect(fudaItems()).toHaveLength(5);
    });
  });

  describe("3. 札の編集で名前を空にして「変更する」と、理由を出して閉じない（レビュー M3）", () => {
    it.each([
      ["空", ""],
      ["空白だけ", "　 "],
    ])("札の名前を%sにして「変更する」と「札の名前を入力してください」を出し、編集の欄を閉じず、札の名前も変えない", async (_label, typed) => {
      // 準備：第六艦隊の編集の欄を開く
      const { user } = await renderEditor();
      await user.click(within(fudaItem("第六艦隊")).getByRole("button", { name: /編集/ }));
      const form = screen.getByRole("form", { name: "札を編集" });
      const nameBox = within(form).getByRole("textbox", { name: "札の名前" });
      await user.clear(nameBox);
      if (typed !== "") await user.type(nameBox, typed);

      // 実行
      await user.click(within(form).getByRole("button", { name: "変更する" }));

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent("札の名前を入力してください");
      expect(screen.getByRole("form", { name: "札を編集" })).toBeInTheDocument();
      expect(fudaItem("第六艦隊")).toHaveTextContent(/1 ?段階/);
      expect(stageButton("E3", "ゲージ3")).toHaveTextContent("第六艦隊");
    });
  });

  describe("4. 新規作成の 1 回目の保存（createEvent）の間は、イベント名・日時の欄を操作できない（Codex）", () => {
    it("「下書きを保存」でイベントを作成している間はイベント名・開始日時・終了日時の欄を操作できず、作成が終わったら入力した値のまま操作できるようになる", async () => {
      // 準備：イベントの作成が終わらない保管庫
      const repository = createFakeRepository(makeData({ user: ADMIN }));
      const creating = Promise.withResolvers<CreatedEvent>();
      repository.createEvent.mockImplementation(() => creating.promise);
      const { user } = await renderEditor(undefined, { repository });
      await switchToCreate(user);
      await fillNewEvent(user, { name: "2026秋イベ", start: "2026-11-14T11:00", end: "2026-12-02T11:00" });

      // 実行
      await user.click(saveDraftButton());
      await waitFor(() => {
        expect(repository.createEvent).toHaveBeenCalledTimes(1);
      });

      // 検証：作成の途中
      expectLocked(nameInput(), "イベント名");
      expectLocked(startInput(), "開始日時");
      expectLocked(endInput(), "終了日時");

      // 実行：作成が終わる
      await act(async () => {
        creating.resolve({ eventId: CREATED_EVENT_ID, draftVersion: 1 });
      });

      // 検証：入力した値は消えず、また操作できる
      expect(await screen.findByText(textContaining("下書きを保存しました"))).toBeInTheDocument();
      expect(nameInput()).toHaveValue("2026秋イベ");
      expect(startInput()).toHaveValue("2026-11-14T11:00");
      expect(endInput()).toHaveValue("2026-12-02T11:00");
      expectEditable(nameInput(), "イベント名");
      expectEditable(startInput(), "開始日時");
      expectEditable(endInput(), "終了日時");
    });

    it("「公開して最新にする」でイベントを作成している間も、イベント名・開始日時・終了日時の欄を操作できない", async () => {
      // 準備：段階のある状態で、イベントの作成が終わらない保管庫
      const repository = createFakeRepository(makeData({ user: ADMIN }));
      const creating = Promise.withResolvers<CreatedEvent>();
      repository.createEvent.mockImplementation(() => creating.promise);
      const { user } = await renderEditor(undefined, { repository });
      await startFromAutumn(user);
      await fillNewEvent(user, { name: "2026秋イベ", start: "2026-11-14T11:00", end: "2026-12-02T11:00" });

      // 実行
      await user.click(publishAsLatestButton());
      await waitFor(() => {
        expect(repository.createEvent).toHaveBeenCalledTimes(1);
      });

      // 検証：作成の途中
      expectLocked(nameInput(), "イベント名");
      expectLocked(startInput(), "開始日時");
      expectLocked(endInput(), "終了日時");

      // 実行：作成が終わる（続けて公開する）
      await act(async () => {
        creating.resolve({ eventId: CREATED_EVENT_ID, draftVersion: 1 });
      });

      // 検証：公開して「既存を更新」に切り替わっても、入力した値のまま
      await waitFor(() => {
        expect(repository.publish).toHaveBeenCalledTimes(1);
      });
      expect(await screen.findByText(textContaining("最新のイベントにしました"))).toBeInTheDocument();
      expect(nameInput()).toHaveValue("2026秋イベ");
      expect(startInput()).toHaveValue("2026-11-14T11:00");
      expect(endInput()).toHaveValue("2026-12-02T11:00");
    });
  });

  describe("5. 終了したイベントに「開催中」を出さない（Codex）", () => {
    it.each([
      ["管理者", ADMIN],
      ["協力者", COLLAB],
    ])("%sが開いた、保存済みの終了日時（2026/10/10 11:00）を過ぎたイベントには「開催中」を出さず、終了の表示だけを出す", async (_label, user) => {
      // 準備・実行
      await renderEditor(makeData({ user, latestEvent: makeEvent({ endAt: "2026-10-10T11:00:00+09:00" }) }));

      // 検証
      expectTextShown("このイベントは終了しました（2026/10/10 11:00 終了）");
      expect(screen.queryByText("開催中")).not.toBeInTheDocument();
    });

    it("（比べる元）終了日時がまだ来ていない（2026/10/20 11:00）開催中のイベントには、管理者のイベント名の横に「開催中」を出す", async () => {
      // 準備・実行
      await renderEditor(makeData({ user: ADMIN, latestEvent: makeEvent({ endAt: "2026-10-20T11:00:00+09:00" }) }));

      // 検証
      expect(screen.getByText("開催中")).toBeInTheDocument();
      expectTextNotShown("このイベントは終了しました");
    });
  });

  describe("6. イベント名・日時の更新は 1 つずつ順に送り、終わるまで保存・公開を待つ（Codex）", () => {
    it("イベント名の更新が終わる前に終了日時を確定したら、前の更新が終わってから次の更新を呼ぶ（確定した順。後の値が最後に届く）", async () => {
      // 準備：1 回目の更新が終わらない保管庫
      const repository = createFakeRepository(makeData({ user: ADMIN }));
      const firstUpdate = Promise.withResolvers<void>();
      repository.updateEventMeta.mockImplementationOnce(() => firstUpdate.promise);
      const { user } = await renderEditor(undefined, { repository });

      // 実行：イベント名を確定する（1 回目の更新）
      await user.clear(nameInput());
      await user.type(nameInput(), "2026夏イベ 後段");
      await user.tab();
      await waitFor(() => {
        expect(repository.updateEventMeta).toHaveBeenCalledTimes(1);
      });

      // 実行：1 回目が終わる前に終了日時を確定する
      enterDateTime(endInput(), "2026-10-20T11:00");
      blurInput(endInput());
      await flushPending();

      // 検証：まだ 2 回目を呼ばない
      expect(repository.updateEventMeta).toHaveBeenCalledTimes(1);

      // 実行：1 回目が終わる
      await act(async () => {
        firstUpdate.resolve();
      });

      // 検証：2 回目を呼ぶ。後の更新は両方の欄の新しい値を持つ
      await waitFor(() => {
        expect(repository.updateEventMeta).toHaveBeenCalledTimes(2);
      });
      expect(repository.updateEventMeta.mock.calls[0]?.[0]).toEqual({
        eventId: LATEST_EVENT_ID,
        name: "2026夏イベ 後段",
        startAt: LATEST_START,
        endAt: null,
      });
      expect(repository.updateEventMeta.mock.calls[1]?.[0]).toEqual({
        eventId: LATEST_EVENT_ID,
        name: "2026夏イベ 後段",
        startAt: LATEST_START,
        endAt: "2026-10-20T11:00+09:00",
      });
    });

    it("終了日時の更新の途中で「下書きを保存」を押したら、更新が終わってから下書きを保存する（文書の終了日時は新しい値）", async () => {
      // 準備：更新が終わらない保管庫。保存していない変更を作ってから、終了日時を確定する
      const repository = createFakeRepository(makeData({ user: ADMIN }));
      const update = Promise.withResolvers<void>();
      repository.updateEventMeta.mockImplementationOnce(() => update.promise);
      const { user } = await renderEditor(undefined, { repository });
      await changeE23Importance(user);
      enterDateTime(endInput(), "2026-10-20T11:00");
      blurInput(endInput());
      await waitFor(() => {
        expect(repository.updateEventMeta).toHaveBeenCalledTimes(1);
      });

      // 実行：更新の途中で押す
      await user.click(saveDraftButton());
      await flushPending();

      // 検証：まだ保存しない
      expect(repository.saveDraft).not.toHaveBeenCalled();

      // 実行：更新が終わる
      await act(async () => {
        update.resolve();
      });

      // 検証：更新が終わってから保存する
      const input = await savedDraftInput(repository);
      expect(input.content.event.endAt).toBe("2026-10-20T11:00+09:00");
      expect(stageIn(input.content, "E2-3").importance).toBe("important");
      const updateOrder = repository.updateEventMeta.mock.invocationCallOrder[0] ?? Infinity;
      const saveOrder = repository.saveDraft.mock.invocationCallOrder[0] ?? -Infinity;
      expect(updateOrder).toBeLessThan(saveOrder);
    });

    it("終了日時の更新の途中で「変更を公開する」を押したら、更新が終わってから下書きの保存・公開を呼ぶ", async () => {
      // 準備：更新が終わらない保管庫。保存していない変更を作ってから、終了日時を確定する
      const repository = createFakeRepository(makeData({ user: ADMIN }));
      const update = Promise.withResolvers<void>();
      repository.updateEventMeta.mockImplementationOnce(() => update.promise);
      const { user } = await renderEditor(undefined, { repository });
      await changeE23Importance(user);
      enterDateTime(endInput(), "2026-10-20T11:00");
      blurInput(endInput());
      await waitFor(() => {
        expect(repository.updateEventMeta).toHaveBeenCalledTimes(1);
      });

      // 実行：更新の途中で押す
      await user.click(publishButton());
      await flushPending();

      // 検証：まだ保存も公開もしない
      expect(repository.saveDraft).not.toHaveBeenCalled();
      expect(repository.publish).not.toHaveBeenCalled();

      // 実行：更新が終わる
      await act(async () => {
        update.resolve();
      });

      // 検証：更新が終わってから、保存して公開する
      await waitFor(() => {
        expect(repository.publish).toHaveBeenCalledWith(
          expect.objectContaining({ eventId: LATEST_EVENT_ID, makeLatest: false }),
        );
      });
      const input = await savedDraftInput(repository);
      expect(input.content.event.endAt).toBe("2026-10-20T11:00+09:00");
    });
  });

  describe("7. 艦名の入力で Esc を押した後に開き直しても、入力した艦名が消えない（Codex）", () => {
    it("「＋ 艦名」→ Esc でやめた後に開き直し、艦名を入れて欄の外を押すと、その艦名を足す（Esc でやめた艦名は足さない）", async () => {
      // 準備
      const { user, repository } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      const group = (): HTMLElement => boostGroupNamed("連合艦隊C");

      // 実行：入れかけて Esc でやめる
      await user.click(within(group()).getByRole("button", { name: "＋ 艦名" }));
      await user.type(within(group()).getByRole("textbox", { name: "追加する艦名" }), "大和");
      await user.keyboard("{Escape}");

      // 検証：欄を閉じ、足さない
      expect(within(group()).queryByRole("textbox", { name: "追加する艦名" })).not.toBeInTheDocument();
      expect(within(group()).queryByText("大和")).not.toBeInTheDocument();

      // 実行：開き直して艦名を入れ、欄の外を押す
      await user.click(within(group()).getByRole("button", { name: "＋ 艦名" }));
      await user.type(within(group()).getByRole("textbox", { name: "追加する艦名" }), "雪風");
      await user.click(document.body);

      // 検証
      expect(within(group()).getByText("雪風")).toBeInTheDocument();
      await user.click(saveDraftButton());
      const { content } = await savedDraftInput(repository);
      const shipNames = stageIn(content, "E2-3").boosts.find((g) => g.id === "E2-3-C")?.shipNames;
      expect(shipNames?.at(-1)).toBe("雪風");
      expect(shipNames).not.toContain("大和");
    });
  });

  describe("8. 入力の誤りがある間は保存・公開を押せない（レビュー提案 1）", () => {
    it("イベント名を空にして確定し、その場のエラーの文が出ている間は「下書きを保存」「変更を公開する」を押せない。直すと押せる", async () => {
      // 準備
      const { user } = await renderEditor(makeData({ user: ADMIN }));

      // 実行
      await user.clear(nameInput());
      await user.tab();

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent("イベント名を入力してください");
      expect(saveDraftButton()).toBeDisabled();
      expect(publishButton()).toBeDisabled();

      // 実行：直す
      await user.type(nameInput(), LATEST_NAME);
      await user.tab();

      // 検証
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(saveDraftButton()).toBeEnabled();
      expect(publishButton()).toBeEnabled();
    });

    it.each([
      ["開始日時以前", "2026-08-07T11:00", END_BEFORE_START],
      ["今以前", "2026-10-16T12:00", END_IN_PAST_SHORT],
    ])(
      "終了日時を%s（%s）にしてその場のエラーの文が出ている間は「下書きを保存」「変更を公開する」を押せない。直すと押せる",
      async (_label, value, message) => {
        // 準備
        await renderEditor(makeData({ user: ADMIN }));

        // 実行
        enterDateTime(endInput(), value);

        // 検証
        expect(await screen.findByRole("alert")).toHaveTextContent(message);
        expect(saveDraftButton()).toBeDisabled();
        expect(publishButton()).toBeDisabled();

        // 実行：直して確定する
        enterDateTime(endInput(), "2026-10-20T11:00");
        blurInput(endInput());

        // 検証
        await waitFor(() => {
          expect(saveDraftButton()).toBeEnabled();
        });
        expect(publishButton()).toBeEnabled();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      },
    );

    it("倍率を範囲の外（12）にして確定し、エラーの文が出ている間は「下書きを保存」「変更を公開する」を押せない。直すと押せる", async () => {
      // 準備
      const { user } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");
      const multiplier = (): HTMLElement =>
        within(boostGroupNamed("連合艦隊C")).getByRole("spinbutton", { name: "倍率" });

      // 実行
      await user.clear(multiplier());
      await user.type(multiplier(), "12");
      await user.tab();

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent(MULTIPLIER_RANGE);
      expect(saveDraftButton()).toBeDisabled();
      expect(publishButton()).toBeDisabled();

      // 実行：直す
      await user.clear(multiplier());
      await user.type(multiplier(), "1.3");
      await user.tab();

      // 検証
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(saveDraftButton()).toBeEnabled();
      expect(publishButton()).toBeEnabled();
    });

    it("新規作成で終了日時を開始日時以前にしてエラーの文が出ている間は「下書きを保存」「公開して最新にする」を押せない。直すと押せる", async () => {
      // 準備：段階のある状態にする
      const { user } = await renderEditor(makeData({ user: ADMIN }));
      await startFromAutumn(user);

      // 実行
      await fillNewEvent(user, { name: "2026秋イベ", start: "2026-11-14T11:00", end: "2026-11-14T11:00" });

      // 検証
      expectTextShown(END_BEFORE_START);
      expect(saveDraftButton()).toBeDisabled();
      expect(publishAsLatestButton()).toBeDisabled();

      // 実行：直す
      enterDateTime(endInput(), "2026-12-02T11:00");
      blurInput(endInput());

      // 検証
      expectTextNotShown(END_BEFORE_START);
      expect(saveDraftButton()).toBeEnabled();
      expect(publishAsLatestButton()).toBeEnabled();
    });
  });

  describe("9. 新規作成でも終了日時が今以前なら「終了日時は今より後にしてください」（レビュー提案 2）", () => {
    it.each([
      ["今より前", "2026-10-16T12:00"],
      ["今と同じ時刻", "2026-10-17T12:00"],
    ])("新規作成で終了日時を%s（%s）にすると「終了日時は今より後にしてください」を出し、イベントを作成も公開もしない", async (_label, value) => {
      // 準備：段階のある状態で、開始日時は過去（2026/10/01 11:00）
      const { user, repository } = await renderEditor(makeData({ user: ADMIN }));
      await startFromAutumn(user);
      await fillNewEvent(user, { name: "2026秋イベ", start: "2026-10-01T11:00", end: value });

      // 実行
      await user.click(saveDraftButton());
      await user.click(publishAsLatestButton());

      // 検証
      expectTextShown(END_IN_PAST_SHORT);
      expect(repository.createEvent).not.toHaveBeenCalled();
      expect(repository.publish).not.toHaveBeenCalled();
    });
  });

  describe("10. 協力者で最新のイベントがないとき（レビュー提案 5）", () => {
    it("「更新できるイベントがありません。管理者が新規作成するまでお待ちください」を出し、切り替え・本文・保存と公開のボタンを出さない", async () => {
      // 準備
      const repository = createFakeRepository(makeData({ user: COLLAB, latestEvent: null }));

      // 実行
      render(<PlanEditor repository={repository} />);

      // 検証
      expect(await screen.findByText(textContaining(NO_EVENT_FOR_COLLAB))).toBeInTheDocument();
      expectTextShown("ログイン中：協力者A（協力者）");
      expect(screen.queryByRole("radio", { name: "新規作成" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "攻略の流れ" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "下書きを保存" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "変更を公開する" })).not.toBeInTheDocument();
    });
  });

  describe("11. イベント名・日時の更新に失敗したら、表示を保存済みの値に戻し、理由を出す（レビュー提案 5）", () => {
    it("終了日時の更新に失敗したら理由を出し、入力欄・期間の表示を保存済みの値（未定）に戻す。その後に保存する文書の終了日時も未定のまま", async () => {
      // 準備
      const repository = createFakeRepository(makeData({ user: ADMIN }));
      repository.updateEventMeta.mockRejectedValue(new Error("通信に失敗しました（テスト）"));
      const { user } = await renderEditor(undefined, { repository });

      // 実行
      enterDateTime(endInput(), "2026-10-20T11:00");
      blurInput(endInput());

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent("通信に失敗しました（テスト）");
      expect(endInput()).toHaveValue("");
      expectTextShown("期間：2026/08/07 12:00 〜 終了日時は未定");
      expect(screen.queryByRole("button", { name: "終了日時を消す" })).not.toBeInTheDocument();

      // 実行：ほかの所を変えて保存する
      await changeE23Importance(user);
      await user.click(saveDraftButton());

      // 検証
      const input = await savedDraftInput(repository);
      expect(input.content.event.endAt).toBeNull();
    });

    it("イベント名の更新に失敗したら理由を出し、イベント名の欄と「更新するイベント」を保存済みの名前に戻す", async () => {
      // 準備
      const repository = createFakeRepository(makeData({ user: ADMIN }));
      repository.updateEventMeta.mockRejectedValue(new Error("通信に失敗しました（テスト）"));
      const { user } = await renderEditor(undefined, { repository });

      // 実行
      await user.clear(nameInput());
      await user.type(nameInput(), "2026夏イベ 後段");
      await user.tab();

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent("通信に失敗しました（テスト）");
      expect(nameInput()).toHaveValue(LATEST_NAME);
      expectTextShown(`更新するイベント：${LATEST_NAME}（最新）`);
      expectTextNotShown("2026夏イベ 後段");
    });

    it("イベント名の更新が成功した後に終了日時の更新が失敗したら、イベント名は新しい値のまま、終了日時だけを保存済みの値（未定）に戻す", async () => {
      // 準備：1 回目（イベント名）は成功し、2 回目（終了日時）は失敗する
      const repository = createFakeRepository(makeData({ user: ADMIN }));
      repository.updateEventMeta
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("通信に失敗しました（テスト）"));
      const { user } = await renderEditor(undefined, { repository });
      await user.clear(nameInput());
      await user.type(nameInput(), "2026夏イベ 後段");
      await user.tab();
      await waitFor(() => {
        expect(repository.updateEventMeta).toHaveBeenCalledTimes(1);
      });

      // 実行
      enterDateTime(endInput(), "2026-10-20T11:00");
      blurInput(endInput());

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent("通信に失敗しました（テスト）");
      expect(nameInput()).toHaveValue("2026夏イベ 後段");
      expectTextShown("更新するイベント：2026夏イベ 後段（最新）");
      expect(endInput()).toHaveValue("");
      expectTextShown("期間：2026/08/07 12:00 〜 終了日時は未定");
    });
  });

  describe("12. 既存のイベントの下書きの保存・公開の途中は、イベント名・日時の欄を操作できない（Codex）", () => {
    /** 「終了日時を消す」のボタン */
    const clearEndButton = (): HTMLElement => screen.getByRole("button", { name: "終了日時を消す" });

    /** イベント名・開始日時・終了日時の欄と「終了日時を消す」を操作できない（disabled）ことを確かめる */
    function expectMetaDisabled(): void {
      expect(nameInput()).toBeDisabled();
      expect(startInput()).toBeDisabled();
      expect(endInput()).toBeDisabled();
      expect(clearEndButton()).toBeDisabled();
    }

    /** イベント名・開始日時・終了日時の欄と「終了日時を消す」を操作できることを確かめる */
    function expectMetaEnabled(): void {
      expect(nameInput()).toBeEnabled();
      expect(startInput()).toBeEnabled();
      expect(endInput()).toBeEnabled();
      expect(clearEndButton()).toBeEnabled();
    }

    /** 終了日時が決まっている（「終了日時を消す」を出す）最新のイベント */
    const dataWithEnd = (): ReturnType<typeof makeData> =>
      makeData({ user: ADMIN, latestEvent: makeEvent({ endAt: "2026-10-20T11:00:00+09:00" }) });

    it("「下書きを保存」で下書きを保存している間はイベント名・開始日時・終了日時の欄と「終了日時を消す」を操作できず、保存が終わったら操作できる", async () => {
      // 準備：下書きの保存が終わらない保管庫。保存していない変更を作る
      const repository = createFakeRepository(dataWithEnd());
      const saving = Promise.withResolvers<SaveDraftResult>();
      repository.saveDraft.mockImplementation(() => saving.promise);
      const { user } = await renderEditor(undefined, { repository });
      await changeE23Importance(user);

      // 実行
      await user.click(saveDraftButton());
      await waitFor(() => {
        expect(repository.saveDraft).toHaveBeenCalledTimes(1);
      });

      // 検証：保存の途中
      expectMetaDisabled();

      // 実行：保存が終わる
      await act(async () => {
        saving.resolve({ status: "saved", version: DRAFT_VERSION + 1 });
      });

      // 検証
      expect(await screen.findByText(textContaining("下書きを保存しました"))).toBeInTheDocument();
      expectMetaEnabled();
    });

    it("「変更を公開する」で公開している間はイベント名・開始日時・終了日時の欄と「終了日時を消す」を操作できず、公開が終わったら操作できる", async () => {
      // 準備：公開が終わらない保管庫（保存していない変更はないので、下書きの保存はせずに公開する）
      const repository = createFakeRepository(dataWithEnd());
      const publishing = Promise.withResolvers<PublishResult>();
      repository.publish.mockImplementation(() => publishing.promise);
      const { user } = await renderEditor(undefined, { repository });

      // 実行
      await user.click(publishButton());
      await waitFor(() => {
        expect(repository.publish).toHaveBeenCalledTimes(1);
      });

      // 検証：公開の途中
      expectMetaDisabled();

      // 実行：公開が終わる
      await act(async () => {
        publishing.resolve(PUBLISH_RESULT);
      });

      // 検証
      expect(await screen.findByText(textContaining("変更を公開しました"))).toBeInTheDocument();
      expectMetaEnabled();
    });
  });

  describe("13. 元にするイベントの読み込みは、要求ごとの番号で新しさを見分ける（Codex）", () => {
    /**
     * 新規作成に切り替え、元にするイベントを 2025秋イベ → 2026夏イベ → 2025秋イベ の順に選ぶ。
     * 3 回の読み込みはどれも、返した resolvers で終わらせるまで終わらない
     */
    async function chooseAutumnSummerAutumn(): Promise<{
      first: PromiseWithResolvers<DefinitionDoc>;
      second: PromiseWithResolvers<DefinitionDoc>;
      third: PromiseWithResolvers<DefinitionDoc>;
    }> {
      const repository = createFakeRepository(makeData({ user: ADMIN }));
      const first = Promise.withResolvers<DefinitionDoc>();
      const second = Promise.withResolvers<DefinitionDoc>();
      const third = Promise.withResolvers<DefinitionDoc>();
      repository.loadEventContent
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise)
        .mockImplementationOnce(() => third.promise);
      const { user } = await renderEditor(undefined, { repository });
      await switchToCreate(user);
      await chooseBase(user, "2025秋イベ");
      await chooseBase(user, "2026夏イベ");
      await chooseBase(user, "2025秋イベ");
      expect(repository.loadEventContent).toHaveBeenCalledTimes(3);
      return { first, second, third };
    }

    it("1 回目の 2025秋イベの読み込みが失敗しても、選択は 2025秋イベのまま（知らせも出さない）。3 回目の読み込みが終わったら 2025秋イベの文書にする", async () => {
      // 準備
      const { first, second, third } = await chooseAutumnSummerAutumn();

      // 実行：1 回目（古い要求）が失敗する
      await act(async () => {
        first.reject(new Error("通信に失敗しました（テスト）"));
      });
      await flushPending();

      // 検証：選択は 3 回目の 2025秋イベのまま。古い要求の失敗は知らせない
      expect(baseSelect()).toHaveDisplayValue("2025秋イベ");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      // 実行：3 回目（新しい要求）が終わる
      await act(async () => {
        third.resolve(autumn2025Definition);
      });

      // 検証：2025秋イベの札と段階を写す
      await waitFor(() => {
        expectStages("E1", [["ゲージ1", "機動部隊"]]);
      });
      expect(baseSelect()).toHaveDisplayValue("2025秋イベ");
      expectTextShown("2025秋イベを元に作成");

      // 実行：2 回目（古い要求）が後から終わる
      await act(async () => {
        second.resolve(summer2026Definition);
      });
      await flushPending();

      // 検証：古い要求の文書で置き換えない
      expectStages("E1", [["ゲージ1", "機動部隊"]]);
      expect(fudaItems()).toHaveLength(2);
      expect(baseSelect()).toHaveDisplayValue("2025秋イベ");
    });

    it("1 回目の 2025秋イベの読み込みが後から成功しても、3 回目の読み込みが終わるまでは文書を置き換えない", async () => {
      // 準備
      const { first, third } = await chooseAutumnSummerAutumn();

      // 実行：1 回目（古い要求）が成功する
      await act(async () => {
        first.resolve(autumn2025Definition);
      });
      await flushPending();

      // 検証：文書は空のまま（E1 だけ・札なし）。選択は 2025秋イベのまま
      expect(fudaItems()).toHaveLength(0);
      expectStages("E1", []);
      expectTextNotShown("2025秋イベを元に作成");
      expect(baseSelect()).toHaveDisplayValue("2025秋イベ");

      // 実行：3 回目（新しい要求）が終わる
      await act(async () => {
        third.resolve(autumn2025Definition);
      });

      // 検証
      await waitFor(() => {
        expectStages("E1", [["ゲージ1", "機動部隊"]]);
      });
      expectTextShown("2025秋イベを元に作成");
    });
  });
});
