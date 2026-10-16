import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { SettingsDialog } from "@/components/SettingsDialog";
import { closeSettingsDialog } from "@/components/settings-dialog-store";
import { SideNav } from "@/components/SideNav";
import { type Role, setRole } from "@/features/auth";
import { expectInDocumentOrder } from "@/test/dom-order";

// メニューの 1 項目：役割（リンクかボタンか）と名前
type MenuEntry = readonly [role: "link" | "button", name: string];

// 一般の項目（全員に出る）。「設定」は画面を移動しないのでボタン
const GENERAL_ENTRIES: readonly MenuEntry[] = [
  ["link", "ホームへ"],
  ["link", "一覧"],
  ["link", "割振"],
  ["link", "取込"],
  ["link", "差分"],
  ["button", "設定"],
];

// 権限を決めて左メニューを描き、そのナビゲーションを返す
function renderSideNav(role: Role, currentPath = "/"): HTMLElement {
  setRole(role);
  render(<SideNav currentPath={currentPath} />);
  return screen.getByRole("navigation", { name: "メインメニュー" });
}

function getEntries(
  nav: HTMLElement,
  entries: readonly MenuEntry[],
): HTMLElement[] {
  return entries.map(([role, name]) => within(nav).getByRole(role, { name }));
}

// メニューの中のリンクとボタンの数（余計な項目がないことの確認に使う）
function countMenuItems(nav: HTMLElement): number {
  return (
    within(nav).queryAllByRole("link").length +
    within(nav).queryAllByRole("button").length
  );
}

describe("左メニュー（SideNav）", () => {
  beforeEach(() => {
    setRole("user");
    closeSettingsDialog();
  });

  describe("権限ごとの項目と順番（要件 2.2）", () => {
    it("一般利用者には「札」・一覧・割振・取込・差分・設定だけがこの順で並び、「管理」の区切りはない", () => {
      // 準備・実行
      const nav = renderSideNav("user");

      // 検証
      expectInDocumentOrder(getEntries(nav, GENERAL_ENTRIES));
      expect(countMenuItems(nav)).toBe(GENERAL_ENTRIES.length);
      expect(within(nav).queryByText("管理")).not.toBeInTheDocument();
      expect(
        within(nav).queryByRole("link", { name: "定義" }),
      ).not.toBeInTheDocument();
      expect(
        within(nav).queryByRole("link", { name: "協力者" }),
      ).not.toBeInTheDocument();
    });

    it("協力者には一般の項目の後に「管理」の区切りがあり、その下に「定義」だけが並ぶ", () => {
      // 準備・実行
      const nav = renderSideNav("collab");

      // 検証
      expectInDocumentOrder([
        ...getEntries(nav, GENERAL_ENTRIES),
        within(nav).getByText("管理"),
        within(nav).getByRole("link", { name: "定義" }),
      ]);
      expect(countMenuItems(nav)).toBe(GENERAL_ENTRIES.length + 1);
      expect(
        within(nav).queryByRole("link", { name: "協力者" }),
      ).not.toBeInTheDocument();
    });

    it("管理者には「管理」の区切りの下に「定義」「協力者」がこの順で並ぶ", () => {
      // 準備・実行
      const nav = renderSideNav("admin");

      // 検証
      expectInDocumentOrder([
        ...getEntries(nav, GENERAL_ENTRIES),
        within(nav).getByText("管理"),
        within(nav).getByRole("link", { name: "定義" }),
        within(nav).getByRole("link", { name: "協力者" }),
      ]);
      expect(countMenuItems(nav)).toBe(GENERAL_ENTRIES.length + 2);
    });

    it.each<Role>(["user", "collab", "admin"])(
      "%s のメニューに「履歴」は置かない",
      (role) => {
        // 準備・実行
        const nav = renderSideNav(role);

        // 検証：メニューが出ていることを確かめてから、「履歴」がないことを見る
        expect(within(nav).getByRole("link", { name: "一覧" })).toBeVisible();
        expect(within(nav).queryByText("履歴")).not.toBeInTheDocument();
      },
    );
  });

  describe("「札」（ホームへ）", () => {
    it("先頭に「札」と書かれたホーム（/）へのリンクがある", () => {
      // 準備・実行
      const nav = renderSideNav("user", "/list");

      // 検証
      const homeLink = within(nav).getByRole("link", { name: "ホームへ" });
      expect(homeLink).toHaveTextContent("札");
      expect(homeLink).toHaveAttribute("href", "/");
      expect(within(nav).getAllByRole("link")[0]).toBe(homeLink);
    });
  });

  describe("各項目の行き先", () => {
    it.each([
      ["一覧", "/list"],
      ["割振", "/assign"],
      ["取込", "/import"],
      ["差分", "/drift"],
      ["定義", "/definition"],
      ["協力者", "/collaborators"],
    ])("「%s」は %s へのリンク", (name, href) => {
      // 準備・実行：すべての項目が出る管理者で見る
      const nav = renderSideNav("admin");

      // 検証
      expect(within(nav).getByRole("link", { name })).toHaveAttribute(
        "href",
        href,
      );
    });
  });

  describe("今いる画面の表示（aria-current）", () => {
    it.each([
      ["/", "ホームへ"],
      ["/list", "一覧"],
      ["/assign", "割振"],
      ["/import", "取込"],
      ["/drift", "差分"],
      ["/definition", "定義"],
      ["/collaborators", "協力者"],
    ])("%s にいるときは「%s」だけが aria-current=page", (path, name) => {
      // 準備・実行
      const nav = renderSideNav("admin", path);

      // 検証
      const current = within(nav).getByRole("link", { name });
      expect(current).toHaveAttribute("aria-current", "page");
      const others = [
        ...within(nav).getAllByRole("link"),
        ...within(nav).getAllByRole("button"),
      ].filter((element) => element !== current);
      for (const other of others) {
        expect(other).not.toHaveAttribute("aria-current", "page");
      }
    });

    it("メニューにない画面（/login）では、どの項目も aria-current=page にしない", () => {
      // 準備・実行
      const nav = renderSideNav("admin", "/login");

      // 検証
      const items = [
        ...within(nav).getAllByRole("link"),
        ...within(nav).getAllByRole("button"),
      ];
      expect(items).toHaveLength(GENERAL_ENTRIES.length + 2);
      for (const item of items) {
        expect(item).not.toHaveAttribute("aria-current", "page");
      }
    });
  });

  describe("設定", () => {
    it("「設定」は画面を移動しないボタンで、ウィンドウを開くことを示す（aria-haspopup=dialog）", () => {
      // 準備・実行
      const nav = renderSideNav("user");

      // 検証
      expect(
        within(nav).queryByRole("link", { name: "設定" }),
      ).not.toBeInTheDocument();
      expect(within(nav).getByRole("button", { name: "設定" })).toHaveAttribute(
        "aria-haspopup",
        "dialog",
      );
    });

    it("「設定」を押すと設定のウィンドウが開く", async () => {
      // 準備：ウィンドウはレイアウトに 1 つ置く想定なので、左メニューと並べて描く
      const user = userEvent.setup();
      setRole("user");
      render(
        <>
          <SideNav currentPath="/list" />
          <SettingsDialog />
        </>,
      );
      const nav = screen.getByRole("navigation", { name: "メインメニュー" });

      // 実行
      await user.click(within(nav).getByRole("button", { name: "設定" }));

      // 検証
      expect(screen.getByRole("dialog", { name: "設定" })).toBeInTheDocument();
    });
  });
});
