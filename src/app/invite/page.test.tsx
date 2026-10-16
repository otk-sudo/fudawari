import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import InvitePage from "@/app/invite/page";
import { isStandalonePath } from "@/lib/routes";

// 招待（2026-10-17 にやめた。U3・U19）の古いリンク（/invite）を開いた人への案内のページ（親の決定：ページは残す）
// - 使われなくなったことと、協力者の追加は管理者が ID とパスワードを発行することを伝え、ホームへ戻れる
// - 単独の画面ではない（左メニューを出す）

describe("招待の案内のページ（/invite）", () => {
  it("見出し「協力者への招待」と、使われなくなったこと・今の追加のしかたを出し、ホーム（/）へ戻れる", () => {
    // 準備・実行
    render(<InvitePage />);

    // 検証
    expect(screen.getByRole("heading", { level: 1, name: "協力者への招待" })).toBeInTheDocument();
    expect(screen.getByText("このページは使われなくなりました")).toBeInTheDocument();
    expect(screen.getByText(/管理者が\s*ID\s*とパスワードを発行/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ホームに戻る" })).toHaveAttribute("href", "/");
  });

  it("ログインや招待のための入力欄を置かない", () => {
    // 準備・実行
    render(<InvitePage />);

    // 検証
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each(["/invite", "/invite/abc123"])("%s は左メニューを出す画面（単独の画面ではない）", (path) => {
    // 準備・実行・検証
    expect(isStandalonePath(path)).toBe(false);
  });
});
