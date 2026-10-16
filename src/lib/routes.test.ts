import { describe, expect, it } from "vitest";
import { isCurrentRoute, isStandalonePath, ROUTES } from "@/lib/routes";

describe("画面の経路（@/lib/routes）", () => {
  describe("isCurrentRoute：今いる画面がメニューの項目に当たるか", () => {
    it.each([
      ["/", ROUTES.home],
      ["/list", ROUTES.list],
      ["/list/", ROUTES.list],
      ["/definition/2026-summer", ROUTES.definition],
    ])("%s にいるときは %s の項目に当たる", (currentPath, href) => {
      // 準備・実行・検証
      expect(isCurrentRoute(currentPath, href)).toBe(true);
    });

    it.each([
      ["/list", ROUTES.home],
      ["/listing", ROUTES.list],
      ["/assign", ROUTES.list],
      ["/login", ROUTES.home],
    ])("%s にいるときは %s の項目に当たらない", (currentPath, href) => {
      // 準備・実行・検証
      expect(isCurrentRoute(currentPath, href)).toBe(false);
    });
  });

  describe("isStandalonePath：左メニューを出さない単独の画面か", () => {
    it.each(["/login", "/login/"])(
      "%s は単独の画面",
      (path) => {
        // 準備・実行・検証
        expect(isStandalonePath(path)).toBe(true);
      },
    );

    // 招待はやめた（U3・U19。2026-10-17）ので、/invite は単独の画面として扱わない
    it.each(["/", "/list", "/collaborators", "/invite", "/invite/abc123", "/loginx"])(
      "%s は左メニューを出す画面",
      (path) => {
        // 準備・実行・検証
        expect(isStandalonePath(path)).toBe(false);
      },
    );
  });

  it("招待の画面（/invite）の経路はない（U3・U19。招待をやめ、ID とパスワードの発行に変えた）", () => {
    // 準備・実行・検証
    expect(Object.values(ROUTES)).not.toContain("/invite");
  });
});
