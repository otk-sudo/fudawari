// 割り振り画面：札へ移した艦のカードを閉じる（UI／UX レビューの【高3】）の先に書いた画面テスト（TDD の Red）
//
// 親が決めた直し方（ユーザーの承認済み）
// - 「ここに置く」（札の列）や「（札名）に置く」（選択中の艦のパネル）で札へ移したら、その艦のカードは閉じる
//   （aria-expanded="false"。開いた状態を残さないので、「特効を表示中：n隻」も増えない）
// - 要件 3.3「開いたカードは、別の艦を選んでも閉じない」はそのまま（置いたときだけ、置いた艦だけを閉じる）
// ドラッグで落としたときに閉じることは assign-store.place-close.test.ts（ストア）と e2e/assign-uiux-review.spec.ts で確かめる。
//
// テスト用データは AssignScreen.test.tsx と同じ（定義 2026夏イベ・モックの所持艦 31 隻・一覧の割り当て）
// - 利根改二（控え）：連合艦隊・ウルシー攻撃部隊で特効あり。速吸改（控え）：ウルシー攻撃部隊だけ。伊168改（控え）：第六艦隊だけ
// - 時雨改二（連合艦隊）
// 部品の探し方（role・名前・属性）は src/test/assign-screen.ts の冒頭にまとめてある。
//
// 仕様が変わる既存のテスト（このファイルでは変えない）
// - AssignScreen.test.tsx「置いた艦のカードは開いたままで、移った札の段階の倍率だけを並べる」
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createShipMaster } from "@/domain/master";
import { AssignScreen } from "@/features/assign/AssignScreen";
import type { SaveAssignments } from "@/features/assign/assign-store";
import { getCard, getColumn, getPanel, getTray } from "@/test/assign-screen";
import { summer2026Assignments, summer2026Definition, summer2026MasterEntries, summer2026Ships } from "@/test/fixtures";

const MASTER = createShipMaster(summer2026MasterEntries);

/** 割り振り画面の中身を描く */
function renderScreen() {
  const save = vi.fn<SaveAssignments>(() => Promise.resolve());
  const user = userEvent.setup();
  render(
    <AssignScreen
      definition={summer2026Definition}
      master={MASTER}
      ships={summer2026Ships}
      initialAssignments={summer2026Assignments}
      save={save}
      returnedCount={0}
    />,
  );
  return { user, save };
}

/** 「特効を表示中：n隻」の帯の文（なければ null） */
function queryOpenBand(): HTMLElement | null {
  return within(getTray()).queryByText(/特効を表示中/);
}

describe("割り振り画面：札へ移した艦のカードを閉じる（【高3】）", () => {
  it("控えの艦を選んで札の列の「ここに置く」で置くと、移った艦のカードは閉じ、「特効を表示中」の帯も出ない", async () => {
    // 準備
    const { user } = renderScreen();
    await user.click(getCard(getTray(), "利根改二"));
    expect(getCard(getTray(), "利根改二")).toHaveAttribute("aria-expanded", "true"); // 前提：開いている

    // 実行
    await user.click(within(getColumn("連合艦隊")).getByRole("button", { name: "ここに置く（特効あり）" }));

    // 検証
    const card = getCard(getColumn("連合艦隊"), "利根改二");
    expect(card).toHaveAttribute("aria-expanded", "false");
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(queryOpenBand()).not.toBeInTheDocument();
  });

  it("パネルの「（札名）に置く」で置いても、移った艦のカードは閉じる", async () => {
    // 準備
    const { user } = renderScreen();
    await user.click(getCard(getTray(), "利根改二"));

    // 実行
    await user.click(within(getPanel()).getByRole("button", { name: "ウルシー攻撃部隊に置く" }));

    // 検証
    expect(getCard(getColumn("ウルシー攻撃部隊"), "利根改二")).toHaveAttribute("aria-expanded", "false");
    expect(queryOpenBand()).not.toBeInTheDocument();
  });

  it("札に置いた艦を別の札の「ここに置く」で移しても、移った艦のカードは閉じる", async () => {
    // 準備
    const { user } = renderScreen();
    await user.click(getCard(getColumn("連合艦隊"), "時雨改二"));

    // 実行
    await user.click(within(getColumn("ウルシー攻撃部隊")).getByRole("button", { name: "ここに置く（特効あり）" }));

    // 検証
    expect(getCard(getColumn("ウルシー攻撃部隊"), "時雨改二")).toHaveAttribute("aria-expanded", "false");
    expect(queryOpenBand()).not.toBeInTheDocument();
  });

  it("置いた艦だけを閉じ、その前に開いていたほかの艦は開いたまま（帯は 1 隻）", async () => {
    // 準備：伊168改を開き、続けて速吸改を選ぶ（伊168改は開いたまま）
    const { user } = renderScreen();
    await user.click(getCard(getTray(), "伊168改"));
    await user.click(getCard(getTray(), "速吸改"));

    // 実行：速吸改をウルシー攻撃部隊へ置く
    await user.click(within(getColumn("ウルシー攻撃部隊")).getByRole("button", { name: "ここに置く（特効あり）" }));

    // 検証
    expect(getCard(getColumn("ウルシー攻撃部隊"), "速吸改")).toHaveAttribute("aria-expanded", "false");
    expect(getCard(getTray(), "伊168改")).toHaveAttribute("aria-expanded", "true");
    expect(queryOpenBand()).toHaveTextContent(/特効を表示中：\s*1\s*隻/);
  });

  it("別の艦を選んでも、前に開いていた艦は閉じない（既存の決まりの守り。今も通る）", async () => {
    // 準備
    const { user } = renderScreen();
    await user.click(getCard(getTray(), "伊168改"));

    // 実行
    await user.click(getCard(getTray(), "速吸改"));

    // 検証
    expect(getCard(getTray(), "伊168改")).toHaveAttribute("aria-expanded", "true");
    expect(getCard(getTray(), "速吸改")).toHaveAttribute("aria-expanded", "true");
    expect(queryOpenBand()).toHaveTextContent(/特効を表示中：\s*2\s*隻/);
  });
});
