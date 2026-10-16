import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { SettingsDialog } from "@/components/SettingsDialog";
import {
  closeSettingsDialog,
  openSettingsDialog,
} from "@/components/settings-dialog-store";

// 設定のウィンドウを開いて、その dialog を返す
function openAndGetDialog(): HTMLElement {
  act(() => {
    openSettingsDialog();
  });
  return screen.getByRole("dialog", { name: "設定" });
}

// 右上の「×」と下の「閉じる」は、どちらも名前が「閉じる」のボタン（モックどおり）。文字で見分ける
function getCloseButtons(dialog: HTMLElement): {
  cross: HTMLElement;
  footer: HTMLElement;
} {
  const buttons = within(dialog).getAllByRole("button", { name: "閉じる" });
  expect(buttons).toHaveLength(2);
  const cross = buttons.find((button) => button.textContent?.trim() === "×");
  const footer = buttons.find(
    (button) => button.textContent?.trim() === "閉じる",
  );
  if (!cross || !footer) {
    throw new Error("「×」と「閉じる」のボタンが見つからない");
  }
  return { cross, footer };
}

describe("設定のウィンドウ（SettingsDialog）", () => {
  beforeEach(() => {
    // 開閉の状態は部品の外にあるため、前のテストで開いたままにしない
    closeSettingsDialog();
  });

  it("閉じている間はウィンドウを出さず、openSettingsDialog で開く", () => {
    // 準備
    render(<SettingsDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // 実行
    act(() => {
      openSettingsDialog();
    });

    // 検証
    expect(screen.getByRole("dialog", { name: "設定" })).toBeInTheDocument();
  });

  it("ウィンドウは名前「設定」・aria-modal=true で、説明「表示などの設定はこのブラウザに保存されます」を持つ", () => {
    // 準備
    render(<SettingsDialog />);

    // 実行
    const dialog = openAndGetDialog();

    // 検証
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(
      "表示などの設定はこのブラウザに保存されます",
    );
  });

  it("右上の「×」で閉じる", async () => {
    // 準備
    const user = userEvent.setup();
    render(<SettingsDialog />);
    const { cross } = getCloseButtons(openAndGetDialog());

    // 実行
    await user.click(cross);

    // 検証
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("下の「閉じる」で閉じる", async () => {
    // 準備
    const user = userEvent.setup();
    render(<SettingsDialog />);
    const { footer } = getCloseButtons(openAndGetDialog());

    // 実行
    await user.click(footer);

    // 検証
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("背景の暗い部分をクリックすると閉じる", async () => {
    // 準備
    const user = userEvent.setup();
    render(<SettingsDialog />);
    openAndGetDialog();

    // 実行
    await user.click(screen.getByTestId("settings-dialog-overlay"));

    // 検証
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ウィンドウの中をクリックしても閉じない", async () => {
    // 準備
    const user = userEvent.setup();
    render(<SettingsDialog />);
    const dialog = openAndGetDialog();

    // 実行：説明の文をクリックする
    await user.click(
      within(dialog).getByText("表示などの設定はこのブラウザに保存されます"),
    );

    // 検証
    expect(screen.getByRole("dialog", { name: "設定" })).toBeInTheDocument();
  });

  it("開いている間は後ろの画面の部品を操作できず（支援技術からも隠れる）、閉じると戻る", async () => {
    // 準備：後ろの画面の代わりにボタンを 1 つ置く
    const user = userEvent.setup();
    render(
      <>
        <button type="button">後ろの画面のボタン</button>
        <SettingsDialog />
      </>,
    );
    expect(
      screen.getByRole("button", { name: "後ろの画面のボタン" }),
    ).toBeInTheDocument();

    // 実行・検証：開いている間は見つからない
    const { footer } = getCloseButtons(openAndGetDialog());
    expect(
      screen.queryByRole("button", { name: "後ろの画面のボタン" }),
    ).not.toBeInTheDocument();

    // 実行・検証：閉じると戻る
    await user.click(footer);
    expect(
      screen.getByRole("button", { name: "後ろの画面のボタン" }),
    ).toBeInTheDocument();
  });

  it("中身（PR-08 で作る設定項目）を children で差し込める", () => {
    // 準備
    render(
      <SettingsDialog>
        <p>表示の設定項目（仮）</p>
      </SettingsDialog>,
    );

    // 実行
    const dialog = openAndGetDialog();

    // 検証
    expect(within(dialog).getByText("表示の設定項目（仮）")).toBeInTheDocument();
  });
});
