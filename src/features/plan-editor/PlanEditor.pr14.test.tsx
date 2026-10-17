import { act, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "@/test/deferred";
import {
  ADMIN,
  createFakeRepository,
  DRAFT_VERSION,
  detailRegion,
  expectTextShown,
  makeData,
  makeEvent,
  NOW,
  renderEditor,
  saveDraftButton,
  savedDraftInput,
  selectStage,
} from "./test-helpers";
import type { SaveDraftResult } from "./types";

// イベント定義の画面（PR-14：PR-12b のレビュー P1）の先に書いたテスト（TDD の Red）。直し方は親が決めた。
// - 保存・公開の途中（busy の間）は、既存を更新／新規作成の切り替えの radio だけでなく、ほかの経路
//   （終了したイベントの案内の「新しいイベントを作成」）から切り替えようとしても何もしない（既存を更新のまま）。
//   切り替えを受け持つ関数（switchMode）の入り口で busy を見る想定。ボタンを押せなくしてもよい（押せないボタンへの click は何も起こさない）
//
// 場面の作り方：既存を更新で下書きの保存を始め、その結果を待たせている間に、時計が保存済みの終了日時を過ぎる
// （画面は 30 秒ごとに今の時刻を取り直す〔useNow〕ので、偽の時計を進めて終了の案内を出す）。
// 終了の案内は管理者だけに「新しいイベントを作成」を出す（PlanEditor.top.test.tsx のとおり）

/** 保存済みの終了日時（今〔NOW：2026-10-17 12:00〕の 5 分後） */
const END_AT = "2026-10-17T12:05:00+09:00";
/** 画面が今の時刻を取り直す間隔（DefinitionEditor の useNow の既定） */
const NOW_INTERVAL_MS = 30_000;

/** 切り替えの radio */
function modeRadio(label: "既存を更新" | "新規作成"): HTMLElement {
  return screen.getByRole("radio", { name: label });
}

/** 段階を選んで、大事さを変える（下書きを保存できる変更を作る） */
async function setImportance(user: UserEvent, areaName: string, stageName: string, label: string): Promise<void> {
  await selectStage(user, areaName, stageName);
  await user.click(within(within(detailRegion()).getByRole("group", { name: "大事さ" })).getByRole("button", { name: label }));
}

describe("イベント定義の画面（PlanEditor）：PR-12b のレビュー P1（PR-14）", () => {
  beforeEach(() => {
    // 今の時刻（Date）と、今の時刻を取り直すタイマー（setInterval）を偽物にする。
    // Testing Library の待ち（findBy・waitFor）と user-event が止まらないよう、setTimeout は本物のまま、偽の時計も実際の時間に合わせて進める
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"], shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("下書きの保存の途中に終了日時を過ぎて終了の案内が出ても、「新しいイベントを作成」を押して新規作成に切り替わらない（既存を更新のまま）", async () => {
    // 準備：終了日時が 5 分後の最新イベントを管理者が開き、変更して保存を始める（保存の結果は待たせる）
    const data = makeData({ user: ADMIN, latestEvent: makeEvent({ endAt: END_AT }) });
    const repository = createFakeRepository(data);
    const pending = createDeferred<SaveDraftResult>();
    repository.saveDraft.mockImplementationOnce(() => pending.promise);
    const { user } = await renderEditor(data, { repository });
    await setImportance(user, "E2", "ゲージ3", "普通");
    await user.click(saveDraftButton());
    await savedDraftInput(repository, 1);

    // 準備：保存の途中に、時計が終了日時を過ぎる（画面が今の時刻を取り直すまで進める）
    vi.setSystemTime(new Date(new Date(END_AT).getTime() - 10_000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOW_INTERVAL_MS);
    });
    expectTextShown("このイベントは終了しました");

    // 実行：終了の案内の「新しいイベントを作成」を押す（押せないなら何もしない）
    const createButton = screen.getByRole("button", { name: "新しいイベントを作成" });
    await user.click(createButton);

    // 検証：既存を更新のまま（新規作成に切り替わらない）
    expect(modeRadio("既存を更新")).toBeChecked();
    expect(modeRadio("新規作成")).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "公開して最新にする" })).not.toBeInTheDocument();

    // 後片付け：保存を終わらせる
    pending.resolve({ status: "saved", version: DRAFT_VERSION + 1 });
    await waitFor(() => {
      expect(repository.saveDraft).toHaveBeenCalledTimes(1);
    });
  });

  it("保存が終わった後なら、終了の案内の「新しいイベントを作成」で新規作成に切り替わる（busy の間だけ止める）", async () => {
    // 準備：上と同じ場面を作り、保存を終わらせる
    const data = makeData({ user: ADMIN, latestEvent: makeEvent({ endAt: END_AT }) });
    const repository = createFakeRepository(data);
    const pending = createDeferred<SaveDraftResult>();
    repository.saveDraft.mockImplementationOnce(() => pending.promise);
    const { user } = await renderEditor(data, { repository });
    await setImportance(user, "E2", "ゲージ3", "普通");
    await user.click(saveDraftButton());
    await savedDraftInput(repository, 1);
    vi.setSystemTime(new Date(new Date(END_AT).getTime() - 10_000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOW_INTERVAL_MS);
    });
    expectTextShown("このイベントは終了しました");
    pending.resolve({ status: "saved", version: DRAFT_VERSION + 1 });
    await waitFor(() => {
      expect(modeRadio("新規作成")).toBeEnabled();
    });

    // 実行
    await user.click(screen.getByRole("button", { name: "新しいイベントを作成" }));

    // 検証
    expect(modeRadio("新規作成")).toBeChecked();
    expect(screen.getByRole("button", { name: "公開して最新にする" })).toBeInTheDocument();
  });
});
