import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
// `@/` の別名が Vitest でも解決できることを兼ねて確かめるため、別名で読み込む
import HomePage from "@/app/page";

describe("トップ画面", () => {
  it("見出し「札割りプランナー」を表示する", () => {
    // 準備・実行
    render(<HomePage />);

    // 検証
    expect(
      screen.getByRole("heading", { level: 1, name: "札割りプランナー（CI 失敗確認）" }),
    ).toBeInTheDocument();
  });
});
