import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import DefinitionPage from "@/app/definition/page";
import { setRole } from "@/features/auth";

// イベント定義のページ（/definition。要件 2.3・3.7）
// 権限ごとの中身は src/features/plan-editor/DefinitionScreen.test.tsx で確かめる。ここではページがその中身を使っていることだけを見る

describe("イベント定義のページ（/definition）", () => {
  afterEach(() => {
    setRole("user");
  });

  it("一般利用者が URL を直接開くと、見出し「イベント定義」と「このページは管理者・協力者のみ使えます」を出す", () => {
    // 準備
    setRole("user");

    // 実行
    render(<DefinitionPage />);

    // 検証
    expect(screen.getByRole("heading", { level: 1, name: "イベント定義" })).toBeInTheDocument();
    expect(screen.getByText(/このページは管理者・協力者のみ使えます/)).toBeInTheDocument();
  });
});
