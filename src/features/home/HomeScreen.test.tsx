import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { SettingsDialog } from "@/components/SettingsDialog";
import { closeSettingsDialog } from "@/components/settings-dialog-store";
import { type Role, setRole } from "@/features/auth";
import { HomeScreen } from "@/features/home/HomeScreen";
import { expectInDocumentOrder } from "@/test/dom-order";

const RUNNING_EVENT = "2026夏イベ";

// 権限と開催中のイベントを決めてホームを描く
function renderHome(role: Role, runningEventName: string | null): void {
  setRole(role);
  render(<HomeScreen runningEventName={runningEventName} />);
}

// タイルの名前は「タイトル＋説明」になることがあるため、タイトルの前方一致で探す
function getTileLink(title: string): HTMLElement {
  return screen.getByRole("link", { name: new RegExp(`^${title}`) });
}

function queryTileLink(title: string): HTMLElement | null {
  return screen.queryByRole("link", { name: new RegExp(`^${title}`) });
}

function getSettingsTile(): HTMLElement {
  return screen.getByRole("button", { name: /^設定/ });
}

function queryAdminHeading(): HTMLElement | null {
  return screen.queryByRole("heading", { name: /^管理/ });
}

describe("ホーム（HomeScreen）", () => {
  beforeEach(() => {
    setRole("user");
    closeSettingsDialog();
  });

  describe("ヘッダー", () => {
    it("見出しにアプリ名「札割りプランナー」を出す", () => {
      // 準備・実行
      renderHome("user", null);

      // 検証
      expect(
        screen.getByRole("heading", { level: 1, name: "札割りプランナー" }),
      ).toBeInTheDocument();
    });

    it("開催中のイベントがあれば「開催中：（イベント名）」を出す", () => {
      // 準備・実行
      renderHome("user", RUNNING_EVENT);

      // 検証
      expect(screen.getByText(/開催中：2026夏イベ/)).toBeInTheDocument();
    });

    it("開催中のイベントがなければ「開催中：」を出さない", () => {
      // 準備・実行
      renderHome("user", null);

      // 検証：ヘッダーが出ていることを確かめてから、「開催中：」がないことを見る
      expect(
        screen.getByRole("heading", { level: 1, name: "札割りプランナー" }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/開催中：/)).not.toBeInTheDocument();
    });
  });

  describe("「札割り」の区分（全員）", () => {
    it("見出し「札割り」の下に、一覧・割り振り・取り込み・差分・設定のタイルがこの順で並ぶ", () => {
      // 準備・実行
      renderHome("user", null);

      // 検証
      expectInDocumentOrder([
        screen.getByRole("heading", { name: "札割り" }),
        getTileLink("一覧"),
        getTileLink("割り振り"),
        getTileLink("取り込み"),
        getTileLink("差分"),
        getSettingsTile(),
      ]);
    });

    it.each([
      ["一覧", "/list", "決めた札割りを札ごとに見る"],
      ["割り振り", "/assign", "特効を見ながら艦を札に割り振る"],
      ["取り込み", "/import", "制空権シミュレータの形式で艦娘を取り込む"],
      ["差分", "/drift", "イベント中に付いた札と計画を比べる"],
    ])("「%s」のタイルは %s へのリンクで、説明「%s」がある", (title, href, note) => {
      // 準備・実行
      renderHome("user", null);

      // 検証
      const tile = getTileLink(title);
      expect(tile).toHaveAttribute("href", href);
      expect(tile).toHaveTextContent(note);
    });

    it("「設定」のタイルは画面を移動しないボタンで、説明「画面モードや文字の大きさなど」がある", () => {
      // 準備・実行
      renderHome("user", null);

      // 検証
      expect(queryTileLink("設定")).not.toBeInTheDocument();
      expect(getSettingsTile()).toHaveTextContent("画面モードや文字の大きさなど");
    });

    it("「設定」のタイルを押すと設定のウィンドウが開く", async () => {
      // 準備：ウィンドウはレイアウトに 1 つ置く想定なので、ホームと並べて描く
      const user = userEvent.setup();
      setRole("user");
      render(
        <>
          <HomeScreen runningEventName={null} />
          <SettingsDialog />
        </>,
      );

      // 実行
      await user.click(getSettingsTile());

      // 検証
      expect(screen.getByRole("dialog", { name: "設定" })).toBeInTheDocument();
    });
  });

  describe("「管理」の区分（権限ごと）", () => {
    it("一般利用者には「管理」の区分もイベント定義・協力者のタイルも出さない", () => {
      // 準備・実行
      renderHome("user", RUNNING_EVENT);

      // 検証：「札割り」の区分が出ていることを確かめてから、「管理」がないことを見る
      expect(screen.getByRole("heading", { name: "札割り" })).toBeInTheDocument();
      expect(queryAdminHeading()).not.toBeInTheDocument();
      expect(queryTileLink("イベント定義")).not.toBeInTheDocument();
      expect(queryTileLink("協力者")).not.toBeInTheDocument();
    });

    it("協力者には見出し「管理」に「協力者」のバッジを付け、「イベント定義」（/definition）のタイルだけを出す", () => {
      // 準備・実行
      renderHome("collab", RUNNING_EVENT);

      // 検証
      const heading = screen.getByRole("heading", { name: /^管理/ });
      expect(within(heading).getByText("協力者")).toBeInTheDocument();
      expect(within(heading).queryByText("管理者")).not.toBeInTheDocument();
      expectInDocumentOrder([getSettingsTile(), heading, getTileLink("イベント定義")]);
      expect(getTileLink("イベント定義")).toHaveAttribute("href", "/definition");
      expect(queryTileLink("協力者")).not.toBeInTheDocument();
    });

    it("協力者のイベント定義の説明は、開催中のイベントがあれば「開催中イベントの札・段階・特効を更新」", () => {
      // 準備・実行
      renderHome("collab", RUNNING_EVENT);

      // 検証
      expect(getTileLink("イベント定義")).toHaveTextContent(
        "開催中イベントの札・段階・特効を更新",
      );
    });

    it("協力者のイベント定義の説明は、開催中のイベントがなければ「開催中のイベントがないため、いまは更新できるものはありません」", () => {
      // 準備・実行
      renderHome("collab", null);

      // 検証
      const tile = getTileLink("イベント定義");
      expect(tile).toHaveTextContent(
        "開催中のイベントがないため、いまは更新できるものはありません",
      );
      expect(tile).not.toHaveTextContent("開催中イベントの札・段階・特効を更新");
    });

    it("管理者には見出し「管理」に「管理者」のバッジを付け、「イベント定義」「協力者」をこの順で出す", () => {
      // 準備・実行
      renderHome("admin", RUNNING_EVENT);

      // 検証
      const heading = screen.getByRole("heading", { name: /^管理/ });
      expect(within(heading).getByText("管理者")).toBeInTheDocument();
      expectInDocumentOrder([
        getSettingsTile(),
        heading,
        getTileLink("イベント定義"),
        getTileLink("協力者"),
      ]);
      expect(getTileLink("イベント定義")).toHaveAttribute("href", "/definition");
      expect(getTileLink("協力者")).toHaveAttribute("href", "/collaborators");
      expect(getTileLink("協力者")).toHaveTextContent(
        "定義を編集できる人の招待・管理",
      );
    });

    it.each([
      ["あるとき", RUNNING_EVENT],
      ["ないとき", null],
    ])(
      "管理者のイベント定義の説明は、開催中のイベントが%sも「札・段階・特効の設定、新規イベントの作成」",
      (_label, runningEventName) => {
        // 準備・実行
        renderHome("admin", runningEventName);

        // 検証
        expect(getTileLink("イベント定義")).toHaveTextContent(
          "札・段階・特効の設定、新規イベントの作成",
        );
      },
    );
  });
});
