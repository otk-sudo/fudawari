import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detailRegion,
  fixClock,
  renderEditor,
  restoreClock,
  selectStage,
  textContaining,
} from "./test-helpers";

// イベント定義の画面の上部の欄の折りたたみと、開いた欄へのフォーカス（UI／UX の指摘 中11。親が決めた直し方・ユーザーの承認済み）
//
// 指摘：1366×768 では上部のイベント情報の欄が約 270px あり、段階の詳細が画面の外。
//       「攻略サイトの艦名リストを貼り付け」を押しても開いた欄が画面外。
// 直し方
// - イベント情報の欄を折りたためる（開閉のボタン、aria-expanded）
// - 段階を選んだら段階の詳細へ、貼り付けの欄を開いたらその欄へスクロールし、貼り付けの欄ではフォーカスを移す
//   （スクロールして画面の中に見えることは e2e/definition-layout.spec.ts の 1366×768 で確かめる。jsdom には配置がないため）
//
// 部品の公開する形（実装の担当向け。テストはこの形で探す）
// - 開閉のボタン：名前に「イベントの情報」を含むボタン（例「イベントの情報を閉じる」「イベントの情報を開く」）で、aria-expanded を持つ。
//   最初に開いているか閉じているかは決めない
// - 閉じている間は、状態の表示の行（「共有の下書き：…」「編集できる人：…」）を出さない
//   （描かない、または hidden 属性。CSS のクラスだけで隠すと jsdom では見分けられないため、どちらかにする）
// - 「攻略サイトの艦名リストを貼り付け」を押して開いた欄では、入力欄「艦名リスト」にフォーカスを移す
//
// 実装の注意：jsdom の要素には scrollIntoView がない。スクロールに scrollIntoView を使うなら、
// 呼ぶ前に有無を確かめる（例 element.scrollIntoView?.(...)）か、src/test/setup.ts で用意する

/** 上部の欄の開閉のボタン（名前に「イベントの情報」を含み、aria-expanded を持つボタン） */
function eventInfoToggle(): HTMLElement {
  const found = screen
    .getAllByRole("button", { name: /イベントの情報/ })
    .filter((button) => button.hasAttribute("aria-expanded"));
  expect(found, "上部の欄の開閉のボタン（名前に「イベントの情報」、aria-expanded）").toHaveLength(1);
  return found[0] as HTMLElement;
}

/** 状態の表示の行が見えているか（描いていない・hidden 属性の中なら見えていない） */
function isLineShown(...parts: string[]): boolean {
  const found = screen.queryAllByText(textContaining(...parts));
  return found.some((element) => element.closest("[hidden]") === null);
}

/** 上部の欄を開いた状態にする（最初が閉じていれば開閉のボタンを押す） */
async function openEventInfo(user: UserEvent): Promise<void> {
  if (eventInfoToggle().getAttribute("aria-expanded") === "false") await user.click(eventInfoToggle());
}

describe("イベント定義の画面（PlanEditor）：上部の欄の折りたたみと、開いた欄へのフォーカス（UI／UX の指摘 中11）", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  describe("イベント情報の欄の折りたたみ", () => {
    it("開閉のボタンで閉じると aria-expanded が false になり、「共有の下書き」「編集できる人」の行を出さない。開き直すと出す", async () => {
      // 準備
      const { user } = await renderEditor();
      await openEventInfo(user);
      expect(eventInfoToggle()).toHaveAttribute("aria-expanded", "true");
      expect(isLineShown("共有の下書き：")).toBe(true);
      expect(isLineShown("編集できる人：")).toBe(true);

      // 実行：閉じる
      await user.click(eventInfoToggle());

      // 検証
      expect(eventInfoToggle()).toHaveAttribute("aria-expanded", "false");
      expect(isLineShown("共有の下書き：")).toBe(false);
      expect(isLineShown("編集できる人：")).toBe(false);

      // 実行：開き直す
      await user.click(eventInfoToggle());

      // 検証
      expect(eventInfoToggle()).toHaveAttribute("aria-expanded", "true");
      expect(isLineShown("共有の下書き：")).toBe(true);
      expect(isLineShown("編集できる人：")).toBe(true);
    });
  });

  describe("開いた貼り付けの欄へのフォーカス", () => {
    it("「攻略サイトの艦名リストを貼り付け」を押すと、開いた欄の入力欄「艦名リスト」にフォーカスを移す", async () => {
      // 準備
      const { user } = await renderEditor();
      await selectStage(user, "E2", "ゲージ3");

      // 実行
      await user.click(within(detailRegion()).getByRole("button", { name: "攻略サイトの艦名リストを貼り付け" }));

      // 検証
      expect(within(detailRegion()).getByRole("textbox", { name: "艦名リスト" })).toHaveFocus();
    });
  });
});
