import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DefinitionDoc } from "@/domain/definition-edit";
import { summer2026Definition } from "@/test/fixtures";
import { createDeferred } from "@/test/deferred";
import { PlanEditor } from "./PlanEditor";
import {
  ADMIN,
  autumn2025Definition,
  confirmPublish,
  createFakeRepository,
  detailRegion,
  expectStages,
  expectTextNotShown,
  expectTextShown,
  fixClock,
  flowRegion,
  fudaRegion,
  makeData,
  makeEvent,
  publishAsLatestButton,
  publishButton,
  renderEditor,
  restoreClock,
  saveDraftButton,
  savedDraftInput,
  selectStage,
  stageIn,
  switchToCreate,
} from "./test-helpers";
import type { PlanEditorData } from "./types";

// イベント定義の画面（PlanEditor）の、DB と結合するときの振る舞い（PR-11b）
// - PR-11a の Codex の指摘の残り 2 件
//   1. 保管庫（repository）が変わったら、読み込み中に戻し、新しい保管庫の内容で編集画面を作り直す
//      （前の保管庫で読んだ内容・編集した内容・版を持ち越さない）
//   2. 新規作成の「元にするイベント」の読み込み中は、本文（攻略の流れ・札・段階の詳細）を操作できない（inert）
// - 公開の後の文：公開から一般の画面への反映（Deploy Hook）は DB の Webhook が行うので、画面は
//   「公開しました。数分で一般の画面に反映されます」を出す。公開中の版の日付は publish の戻り値の versionDate

/** 2 つ目の保管庫が返す最新のイベント（2026秋イベ。下書きは版 2、文書は 2025秋イベの写し） */
const AUTUMN26_ID = "2026-autumn";

function autumn26Data(): PlanEditorData {
  return makeData({
    latestEvent: makeEvent({
      id: AUTUMN26_ID,
      name: "2026秋イベ",
      startAt: "2026-11-14T11:00:00+09:00",
      draftContent: autumn2025Definition,
      draftVersion: 2,
      publishedContent: autumn2025Definition,
      versionDate: "2026-10-16",
    }),
  });
}

/** 段階の詳細の大事さのボタン */
function importanceButton(label: string): HTMLElement {
  return within(within(detailRegion()).getByRole("group", { name: "大事さ" })).getByRole("button", { name: label });
}

/** 新規作成の「元にするイベント」を選ぶ */
async function chooseBase(user: UserEvent, optionText: string): Promise<void> {
  await user.selectOptions(screen.getByRole("combobox", { name: "元にするイベント" }), optionText);
}

describe("イベント定義の画面（PlanEditor）：DB との結合（保管庫の差し替え・元にするイベントの読み込み中・公開の後）", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  describe("保管庫が変わったとき（PR-11a の Codex の指摘）", () => {
    it("読み込み中に戻し、前の保管庫で読んだ本文を消す", async () => {
      // 準備
      const first = createFakeRepository(makeData());
      const second = createFakeRepository(autumn26Data());
      second.load.mockReturnValueOnce(createDeferred<PlanEditorData>().promise);
      const { rerender } = render(<PlanEditor repository={first} />);
      await screen.findByRole("region", { name: "攻略の流れ" });

      // 実行
      rerender(<PlanEditor repository={second} />);

      // 検証
      expect(await screen.findByText(/読み込んでいます/)).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "攻略の流れ" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "下書きを保存" })).not.toBeInTheDocument();
      expect(second.load).toHaveBeenCalledTimes(1);
    });

    it("新しい保管庫の内容（2026秋イベ）で編集画面を作り直す", async () => {
      // 準備
      const first = createFakeRepository(makeData());
      const second = createFakeRepository(autumn26Data());
      const loading = createDeferred<PlanEditorData>();
      second.load.mockReturnValueOnce(loading.promise);
      const { rerender } = render(<PlanEditor repository={first} />);
      await screen.findByRole("region", { name: "攻略の流れ" });
      rerender(<PlanEditor repository={second} />);

      // 実行
      await act(async () => {
        loading.resolve(autumn26Data());
      });

      // 検証
      await waitFor(() => {
        expectTextShown("更新するイベント：", "2026秋イベ（最新）");
      });
      expectTextNotShown("2026夏イベ（最新）");
      expectStages("E1", [["ゲージ1", "機動部隊"]]);
      expectStages("E2", [["ゲージ2 輸送", "輸送部隊"]]);
      expectTextShown("公開中：2026/10/16 版");
    });

    it("前の保管庫で編集した内容を持ち越さない（同じ内容を読み直したら、編集する前の大事さに戻る）", async () => {
      // 準備：前の保管庫で E2 ゲージ3 の大事さを「難所」から「重要」に変えた
      const user = userEvent.setup();
      const first = createFakeRepository(makeData());
      const second = createFakeRepository(makeData());
      const { rerender } = render(<PlanEditor repository={first} />);
      await screen.findByRole("region", { name: "攻略の流れ" });
      await selectStage(user, "E2", "ゲージ3");
      await user.click(importanceButton("重要"));

      // 実行
      rerender(<PlanEditor repository={second} />);
      await waitFor(() => {
        expect(second.load).toHaveBeenCalledTimes(1);
      });
      await screen.findByRole("region", { name: "攻略の流れ" });
      await selectStage(user, "E2", "ゲージ3");

      // 検証
      expect(importanceButton("難所")).toHaveAttribute("aria-pressed", "true");
      expect(importanceButton("重要")).toHaveAttribute("aria-pressed", "false");
      expectTextNotShown("未公開の変更");
    });

    it("作り直した後の保存は、新しい保管庫に、新しいイベントの ID と版（2）で送る", async () => {
      // 準備
      const user = userEvent.setup();
      const first = createFakeRepository(makeData());
      const second = createFakeRepository(autumn26Data());
      const loading = createDeferred<PlanEditorData>();
      second.load.mockReturnValueOnce(loading.promise);
      const { rerender } = render(<PlanEditor repository={first} />);
      await screen.findByRole("region", { name: "攻略の流れ" });
      rerender(<PlanEditor repository={second} />);
      await act(async () => {
        loading.resolve(autumn26Data());
      });
      await waitFor(() => {
        expectTextShown("更新するイベント：", "2026秋イベ（最新）");
      });

      // 実行
      await selectStage(user, "E1", "ゲージ1");
      await user.click(importanceButton("難所"));
      await user.click(saveDraftButton());

      // 検証
      const input = await savedDraftInput(second);
      expect(input.eventId).toBe(AUTUMN26_ID);
      expect(input.baseVersion).toBe(2);
      expect(stageIn(input.content, "A-E1-1").importance).toBe("hard");
      expect(first.saveDraft).not.toHaveBeenCalled();
    });
  });

  describe("新規作成の元にするイベントの読み込み中（PR-11a の Codex の指摘）", () => {
    it("読み込み中は本文（攻略の流れ・札・段階の詳細）を操作できない状態（inert）にし、読み込めたら戻す", async () => {
      // 準備：一度 2025秋イベを元にして段階のある状態にしてから、2026夏イベを選び直す（読み込みを待たせる）
      const { user, repository } = await renderEditor(makeData({ user: ADMIN }));
      await switchToCreate(user);
      await chooseBase(user, "2025秋イベ");
      await waitFor(() => {
        expectStages("E1", [["ゲージ1", "機動部隊"]]);
      });
      expect(flowRegion().closest("[inert]")).toBeNull();
      const loading = createDeferred<DefinitionDoc>();
      repository.loadEventContent.mockReturnValueOnce(loading.promise);

      // 実行
      await chooseBase(user, "2026夏イベ");

      // 検証：読み込み中
      expect(flowRegion().closest("[inert]")).not.toBeNull();
      expect(fudaRegion().closest("[inert]")).not.toBeNull();
      expect(detailRegion().closest("[inert]")).not.toBeNull();

      // 実行：読み込めた
      await act(async () => {
        loading.resolve(summer2026Definition);
      });

      // 検証
      await waitFor(() => {
        expect(flowRegion().closest("[inert]")).toBeNull();
      });
      expect(fudaRegion().closest("[inert]")).toBeNull();
      expect(detailRegion().closest("[inert]")).toBeNull();
    });

    it("読み込みに失敗したら、本文を操作できる状態に戻す", async () => {
      // 準備
      const { user, repository } = await renderEditor(makeData({ user: ADMIN }));
      await switchToCreate(user);
      await chooseBase(user, "2025秋イベ");
      await waitFor(() => {
        expectStages("E1", [["ゲージ1", "機動部隊"]]);
      });
      const loading = createDeferred<DefinitionDoc>();
      repository.loadEventContent.mockReturnValueOnce(loading.promise);
      await chooseBase(user, "2026夏イベ");
      expect(flowRegion().closest("[inert]")).not.toBeNull();

      // 実行
      await act(async () => {
        loading.reject(new Error("通信に失敗しました（テスト）"));
      });

      // 検証
      await waitFor(() => {
        expect(flowRegion().closest("[inert]")).toBeNull();
      });
      expect(await screen.findByRole("alert")).toHaveTextContent("通信に失敗しました（テスト）");
    });
  });

  describe("公開の後", () => {
    it("「変更を公開する」で公開したら「公開しました。数分で一般の画面に反映されます」と、返った版の日付で「公開中：2026/10/18 版」を出す", async () => {
      // 準備
      const repository = createFakeRepository();
      repository.publish.mockResolvedValue({
        status: "published",
        id: "published-2",
        versionLabel: "2026/10/18 版",
        versionDate: "2026-10-18",
      });
      const { user } = await renderEditor(undefined, { repository });
      await selectStage(user, "E2", "ゲージ3");
      await user.click(importanceButton("重要"));

      // 実行
      await user.click(publishButton());
      await confirmPublish(user);

      // 検証
      await waitFor(() => {
        expectTextShown("公開しました。数分で一般の画面に反映されます");
      });
      expectTextShown("公開中：2026/10/18 版");
    });

    it("新規作成の「公開して最新にする」でも「数分で一般の画面に反映されます」を出す", async () => {
      // 準備：未公開の新規イベント（2026秋イベ）の続きから公開する
      const unpublishedEvent = makeEvent({
        id: AUTUMN26_ID,
        name: "2026秋イベ",
        startAt: "2026-11-14T11:00:00+09:00",
        draftContent: autumn2025Definition,
        draftVersion: 3,
        publishedContent: null,
      });
      const { user, repository } = await renderEditor(makeData({ user: ADMIN, unpublishedEvent }));
      await switchToCreate(user);

      // 実行
      await user.click(publishAsLatestButton());
      await confirmPublish(user);

      // 検証
      await waitFor(() => {
        expect(repository.publish).toHaveBeenCalledWith({ eventId: AUTUMN26_ID, baseVersion: 3, makeLatest: true });
      });
      await waitFor(() => {
        expectTextShown("数分で一般の画面に反映されます");
      });
    });
  });
});
