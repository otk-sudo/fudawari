import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { summer2026Definition } from "@/test/fixtures";
import {
  ADMIN,
  blurInput,
  confirmPublish,
  createFakeRepository,
  enterDateTime,
  expectTextShown,
  findPublishConfirm,
  fixClock,
  LATEST_NAME,
  makeData,
  makeDoc,
  makeEvent,
  publishAsLatestButton,
  publishButton,
  PUBLISH_RESULT,
  queryPublishConfirm,
  renderEditor,
  restoreClock,
  saveDraftButton,
  switchToCreate,
} from "./test-helpers";

// 公開の前の確認と、イベント情報の欄の折りたたみの追加のテスト（PR #44 の独立レビューの指摘）
// - 確認で「公開する」を押したら、公開が終わった後に押した公開のボタンへフォーカスを戻す（公開の途中はボタンが押せないため）
// - 確認のウィンドウの説明（aria-describedby）に警告の一覧を含める
// - 名前・倍率はあるが艦名も国籍もない特効グループ（効く艦がない）も警告する（親の決定）
// - Esc でも公開をやめる。新規作成で必須の欄が空なら確認を出さない
// - イベント情報の欄を閉じても「下書きを保存」「変更を公開する」・イベント名・入力の誤りの文は残す

/** テスト用の定義に出てくる艦名すべて（艦船マスタにある艦名として渡す） */
const ALL_SHIP_NAMES: ReadonlySet<string> = new Set(
  summer2026Definition.stages.flatMap((stage) => stage.boosts.flatMap((group) => [...group.shipNames])),
);

/** 要素が hidden 属性の中にない（見えている） */
function isShown(element: HTMLElement): boolean {
  return element.closest("[hidden]") === null;
}

describe("イベント定義の画面（PlanEditor）：公開の前の確認の追加（PR #44 の独立レビュー）", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  it("確認で「公開する」を押すと、公開の途中（ボタンを押せない間）に確認を閉じても、公開が終わった後にフォーカスを「変更を公開する」へ戻す", async () => {
    // 準備：公開の返事を止めておく（確認を閉じた時点では、公開の途中で公開のボタンを押せない）
    const repository = createFakeRepository();
    let finishPublish: (() => void) | undefined;
    repository.publish.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPublish = () => resolve(PUBLISH_RESULT);
        }),
    );
    const { user } = await renderEditor(makeData(), { repository, knownShipNames: ALL_SHIP_NAMES });
    await user.click(publishButton());

    // 実行：「公開する」を押し、確認が閉じて公開の途中になってから、公開の返事を返す
    await confirmPublish(user);
    await waitFor(() => {
      expect(repository.publish).toHaveBeenCalledTimes(1);
    });
    expect(queryPublishConfirm()).not.toBeInTheDocument();
    expect(publishButton()).toBeDisabled();
    await act(async () => {
      finishPublish?.();
      await Promise.resolve();
    });

    // 検証
    await waitFor(() => {
      expectTextShown("変更を公開しました");
    });
    await waitFor(() => {
      expect(publishButton()).toHaveFocus();
    });
  });

  it("確認のウィンドウの説明（aria-describedby）に警告の一覧を含める", async () => {
    // 準備：千代田がマスタにない
    const known = new Set([...ALL_SHIP_NAMES].filter((name) => name !== "千代田"));
    const { user } = await renderEditor(makeData(), { knownShipNames: known });

    // 実行
    await user.click(publishButton());

    // 検証
    expect(await findPublishConfirm()).toHaveAccessibleDescription(/艦船マスタにない艦名：千代田/);
  });

  it("名前・倍率はあるが艦名も国籍もない特効グループ（E3 ギミック）を「効く艦がない特効グループ」と段階名で警告する", async () => {
    // 準備
    const draftContent = makeDoc((draft) => {
      const stage = draft.stages.find((s) => s.id === "E3-G");
      if (stage === undefined) throw new Error("テスト用の定義に E3 ギミックがありません");
      stage.boosts.push({ id: "E3-G-N", name: "米艦", multiplier: 1.2, shipNames: [] });
    });
    const { user } = await renderEditor(makeData({ latestEvent: makeEvent({ draftContent }) }), {
      knownShipNames: ALL_SHIP_NAMES,
    });

    // 実行
    await user.click(publishButton());

    // 検証
    const dialog = await findPublishConfirm();
    expect(dialog).toHaveTextContent("効く艦がない特効グループ");
    expect(dialog).toHaveTextContent("E3 ギミック");
    expect(dialog).not.toHaveTextContent("空の特効グループ");
  });

  it("確認で Esc を押すと、公開せずに閉じ、フォーカスを「変更を公開する」へ戻す", async () => {
    // 準備
    const { user, repository } = await renderEditor(makeData(), { knownShipNames: ALL_SHIP_NAMES });
    await user.click(publishButton());
    await findPublishConfirm();

    // 実行
    await user.keyboard("{Escape}");

    // 検証
    await waitFor(() => {
      expect(queryPublishConfirm()).not.toBeInTheDocument();
    });
    expect(repository.saveDraft).not.toHaveBeenCalled();
    expect(repository.publish).not.toHaveBeenCalled();
    expect(publishButton()).toHaveFocus();
  });

  it("新規作成でイベント名・開始日時が空のまま「公開して最新にする」を押すと、確認を出さずに入力の誤りを出す", async () => {
    // 準備：段階のある状態にする（元にするイベントを選ぶ）
    const { user, repository } = await renderEditor(makeData({ user: ADMIN }));
    await switchToCreate(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "元にするイベント" }), "2025秋イベ");
    await waitFor(() => {
      expect(publishAsLatestButton()).toBeEnabled();
    });

    // 実行
    await user.click(publishAsLatestButton());

    // 検証
    expectTextShown("イベント名と開始日時を入力してください");
    expect(queryPublishConfirm()).not.toBeInTheDocument();
    expect(repository.createEvent).not.toHaveBeenCalled();
  });
});

describe("イベント定義の画面（PlanEditor）：イベント情報の欄を閉じても残すもの（PR #44 の独立レビュー）", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  it("閉じても「下書きを保存」「変更を公開する」・イベント名・入力の誤りの文は見えたまま", async () => {
    // 準備：管理者で、終了日時を開始日時より前にした（入力の誤りの文が出る）
    const { user } = await renderEditor(makeData({ user: ADMIN }));
    const end = screen.getByLabelText(/^終了日時/);
    enterDateTime(end, "2026-08-01T12:00");
    blurInput(end);
    expectTextShown("終了日時は開始日時より後にしてください");

    // 実行：閉じる
    await user.click(screen.getByRole("button", { name: "イベントの情報を閉じる" }));

    // 検証
    expect(isShown(saveDraftButton())).toBe(true);
    expect(isShown(publishButton())).toBe(true);
    expect(screen.getAllByText(LATEST_NAME, { exact: true }).some(isShown)).toBe(true);
    const errors = screen.getAllByRole("alert").filter((alert) => alert.textContent?.includes("終了日時は開始日時より後"));
    expect(errors.some(isShown)).toBe(true);
    expect(within(screen.getByRole("region", { name: "イベントの情報" })).getByRole("button", { name: "イベントの情報を開く" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
