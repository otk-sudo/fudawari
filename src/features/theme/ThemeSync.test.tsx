import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setThemeMode, ThemeSync, useThemeMode } from "@/features/theme";

const html = document.documentElement;

describe("画面モードの切り替え（@/features/theme）", () => {
  beforeEach(() => {
    // 前のテストのモードを残さない（部品はまだ置いていないので、ここでは反映されない）
    setThemeMode("system");
  });

  afterEach(() => {
    html.removeAttribute("data-theme");
  });

  it("ダークを選ぶと <html data-theme> が dark になる", () => {
    // 準備
    render(<ThemeSync />);

    // 実行
    act(() => {
      setThemeMode("dark");
    });

    // 検証
    expect(html).toHaveAttribute("data-theme", "dark");
  });

  it("ライトを選ぶと <html data-theme> が light になる", () => {
    // 準備
    render(<ThemeSync />);

    // 実行
    act(() => {
      setThemeMode("light");
    });

    // 検証
    expect(html).toHaveAttribute("data-theme", "light");
  });

  it("端末に合わせるを選ぶと <html> から data-theme を外す（端末の設定に従う）", () => {
    // 準備：いったんライトにしておく
    render(<ThemeSync />);
    act(() => {
      setThemeMode("light");
    });
    expect(html).toHaveAttribute("data-theme", "light");

    // 実行
    act(() => {
      setThemeMode("system");
    });

    // 検証
    expect(html).not.toHaveAttribute("data-theme");
  });

  it("ThemeSync を置く前に選んでいたモードも、置いたときに反映する", () => {
    // 準備：部品を置く前にライトを選ぶ（PR-08 で保存したモードを起動時に戻す場面）
    setThemeMode("light");

    // 実行
    render(<ThemeSync />);

    // 検証
    expect(html).toHaveAttribute("data-theme", "light");
  });

  it("useThemeMode は今の画面モードを返し、切り替えると新しいモードになる", () => {
    // 準備
    const { result } = renderHook(() => useThemeMode());
    expect(result.current).toBe("system");

    // 実行
    act(() => {
      setThemeMode("light");
    });

    // 検証
    expect(result.current).toBe("light");
  });
});
