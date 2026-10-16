import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRole, useRole } from "@/features/auth";

describe("権限の入口（@/features/auth）", () => {
  beforeEach(() => {
    setRole("user");
  });

  it("既定（ログインしていない状態）は一般利用者（user）である", async () => {
    // 準備：ほかのテストで切り替えた値が残らないよう、読み込み直した新しい入口を使う
    vi.resetModules();
    const fresh = await import("@/features/auth");

    // 実行
    const { result } = renderHook(() => fresh.useRole());

    // 検証
    expect(result.current).toBe("user");
  });

  it("setRole で切り替えると、useRole を使っている部品に新しい権限が届く", () => {
    // 準備
    const { result } = renderHook(() => useRole());

    // 実行・検証：管理者に切り替える
    act(() => {
      setRole("admin");
    });
    expect(result.current).toBe("admin");

    // 実行・検証：協力者に切り替える
    act(() => {
      setRole("collab");
    });
    expect(result.current).toBe("collab");
  });
});
