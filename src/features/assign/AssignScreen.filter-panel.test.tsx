// 割り振り画面の控えの「絞り込み」の欄を閉じる（2026-10-17 のユーザーの要望 1。要件 3.3「絞り込み」）の先に書いたテスト（TDD の Red）
//
// 要望：「絞り込み」を押すと改造状態・特効・特効が効く札の欄が開くが、利用者には閉じ方が分からない。
// - 欄の中に「閉じる」ボタン（または ×）を置き、押すと欄が閉じて、フォーカスが「絞り込み」のボタンに戻る
// - Esc でも閉じる（欄の中にフォーカスがあるとき・開いた直後で「絞り込み」のボタンにフォーカスがあるとき）
// - 「絞り込み」のボタン自体の開閉（aria-expanded）は今のまま（守りのテスト）
// - 閉じても、選んだ条件はそのまま（閉じるのは見た目だけで、条件を戻すのは「リセット」）
//
// 実装の担当が置く形（テストはこの形で探す）
// - 欄：今と同じく、「絞り込み」のボタンの aria-controls が指す要素（開いているときだけ）。その中に条件の group を置く
// - 「閉じる」ボタン：欄（aria-controls が指す要素）の中の button で、名前に「閉じる」を含むもの（例「閉じる」「絞り込みを閉じる」。
//   × の印だけにするなら aria-label に「閉じる」を含める）。欄の中に 1 つだけ
// - Esc：欄の中か「絞り込み」のボタンにフォーカスがあるときに Esc を押すと閉じる。欄の中から閉じたときは「絞り込み」のボタンにフォーカスを移す
//
// テスト用データ：AssignScreen.test.tsx と同じ（2026夏イベの定義・モックの所持艦 31 隻・一覧の割り当て。控えは 12 隻で、
// 初めは「特効のある艦だけ」が ON なので 11 隻を出す）。第六艦隊で特効のある控えの艦は伊168改だけ
import { act, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createShipMaster } from "@/domain/master";
import { AssignScreen } from "@/features/assign/AssignScreen";
import type { SaveAssignments } from "@/features/assign/assign-store";
import { getCard, getTray, trayCountPattern } from "@/test/assign-screen";
import { summer2026Assignments, summer2026Definition, summer2026MasterEntries, summer2026Ships } from "@/test/fixtures";

const MASTER = createShipMaster(summer2026MasterEntries);

/** 割り振り画面の中身を描く（テスト用データ。保存の関数は偽物ですぐに成功する） */
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
  return { user };
}

/** ボタン「絞り込み」（名前は「絞り込み」とバッジの数） */
function getFilterButton(): HTMLElement {
  return within(getTray()).getByRole("button", { name: /^絞り込み/ });
}

/** 絞り込みの欄（「絞り込み」のボタンの aria-controls が指す要素）。開いていなければ投げる */
function getFilterPanel(): HTMLElement {
  const id = getFilterButton().getAttribute("aria-controls");
  if (id === null || id === "") throw new Error("「絞り込み」のボタンに aria-controls がない（欄が開いていない）");
  const panel = document.getElementById(id);
  if (panel === null) throw new Error(`「絞り込み」のボタンの aria-controls（${id}）が指す要素がない`);
  return panel;
}

/** 絞り込みの欄の中の「閉じる」ボタン（名前に「閉じる」を含む button。欄の中に 1 つだけ） */
function getFilterCloseButton(): HTMLElement {
  return within(getFilterPanel()).getByRole("button", { name: /閉じる/ });
}

/** 絞り込みの条件の group（なければ null） */
function queryFilterGroup(name: string): HTMLElement | null {
  return within(getTray()).queryByRole("group", { name });
}

/** 絞り込みの条件のチェックボックス（group の名前とチェックボックスの名前で探す） */
function getFilterCheckbox(groupName: string, label: string): HTMLElement {
  return within(within(getTray()).getByRole("group", { name: groupName })).getByRole("checkbox", { name: label });
}

/** 欄が閉じている（「絞り込み」のボタンが aria-expanded="false" で、条件の group が見えない）ことを確かめる */
function expectFilterClosed(): void {
  expect(getFilterButton()).toHaveAttribute("aria-expanded", "false");
  for (const name of ["改造状態", "特効", "特効が効く札"]) {
    expect(queryFilterGroup(name)).not.toBeInTheDocument();
  }
}

describe("控えの「絞り込み」の欄を閉じる（2026-10-17 の要望 1）", () => {
  it("守り：「絞り込み」のボタンを押すと欄が開き（aria-expanded=true・aria-controls が条件の欄を指す）、もう一度押すと閉じる", async () => {
    // 準備
    const { user } = renderScreen();
    expectFilterClosed();

    // 実行：開く
    await user.click(getFilterButton());

    // 検証
    expect(getFilterButton()).toHaveAttribute("aria-expanded", "true");
    const panel = getFilterPanel();
    expect(within(panel).getByRole("group", { name: "改造状態" })).toBeInTheDocument();
    expect(within(panel).getByRole("group", { name: "特効" })).toBeInTheDocument();
    expect(within(panel).getByRole("group", { name: "特効が効く札" })).toBeInTheDocument();

    // 実行：もう一度押して閉じる
    await user.click(getFilterButton());

    // 検証
    expectFilterClosed();
  });

  it("開いた欄の中に「閉じる」ボタンが 1 つある（名前に「閉じる」を含む）", async () => {
    // 準備
    const { user } = renderScreen();

    // 実行
    await user.click(getFilterButton());

    // 検証
    const closeButtons = within(getFilterPanel()).getAllByRole("button", { name: /閉じる/ });
    expect(closeButtons).toHaveLength(1);
    expect(closeButtons[0]).toBeVisible();
  });

  it("欄の中の「閉じる」を押すと、欄が閉じて「絞り込み」のボタンが aria-expanded=false になり、フォーカスが「絞り込み」のボタンに戻る", async () => {
    // 準備
    const { user } = renderScreen();
    await user.click(getFilterButton());

    // 実行
    await user.click(getFilterCloseButton());

    // 検証
    expectFilterClosed();
    expect(getFilterButton()).toHaveFocus();
  });

  it("欄の中（チェックボックス）にフォーカスがあるとき Esc を押すと、欄が閉じてフォーカスが「絞り込み」のボタンに戻る", async () => {
    // 準備：欄を開き、札のチェックボックスにフォーカスを移す（押すと条件が変わるので、押さずにフォーカスだけ移す）
    const { user } = renderScreen();
    await user.click(getFilterButton());
    const box = getFilterCheckbox("特効が効く札", "第六艦隊");
    act(() => box.focus());
    expect(box).toHaveFocus();

    // 実行
    await user.keyboard("{Escape}");

    // 検証
    expectFilterClosed();
    expect(getFilterButton()).toHaveFocus();
  });

  it("「絞り込み」のボタンで開いた直後（フォーカスは「絞り込み」のボタン）に Esc を押しても欄が閉じ、フォーカスは「絞り込み」のボタンのまま", async () => {
    // 準備
    const { user } = renderScreen();
    await user.click(getFilterButton());
    expect(getFilterButton()).toHaveFocus();
    expect(getFilterButton()).toHaveAttribute("aria-expanded", "true");

    // 実行
    await user.keyboard("{Escape}");

    // 検証
    expectFilterClosed();
    expect(getFilterButton()).toHaveFocus();
  });

  it("「閉じる」で閉じても選んだ条件は残る（第六艦隊を選んだまま：控えは伊168改だけ・バッジ 2。開き直すとチェックが入っている）", async () => {
    // 準備
    const { user } = renderScreen();
    await user.click(getFilterButton());
    await user.click(getFilterCheckbox("特効が効く札", "第六艦隊"));
    expect(getTray()).toHaveTextContent(trayCountPattern(1, 12));

    // 実行
    await user.click(getFilterCloseButton());

    // 検証：閉じた後も条件はそのまま
    expectFilterClosed();
    expect(getTray()).toHaveTextContent(trayCountPattern(1, 12));
    expect(getCard(getTray(), "伊168改")).toBeInTheDocument();
    expect(getFilterButton()).toHaveTextContent(/絞り込み\D*2(?!\d)/);

    // 検証：開き直すとチェックが入っている
    await user.click(getFilterButton());
    expect(getFilterCheckbox("特効が効く札", "第六艦隊")).toBeChecked();
  });
});
