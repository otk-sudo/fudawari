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
    it.each(["/login", "/invite", "/invite/abc123", "/login/"])(
      "%s は単独の画面",
      (path) => {
        // 準備・実行・検証
        expect(isStandalonePath(path)).toBe(true);
      },
    );

    it.each(["/", "/list", "/collaborators", "/invited", "/loginx"])(
      "%s は左メニューを出す画面",
      (path) => {
        // 準備・実行・検証
        expect(isStandalonePath(path)).toBe(false);
      },
    );
  });
});
