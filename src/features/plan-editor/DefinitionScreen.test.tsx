import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Role, setRole } from "@/features/auth";
import { DefinitionScreen } from "./DefinitionScreen";
import { ADMIN, COLLAB, createFakeRepository, fixClock, makeData, restoreClock, textContaining } from "./test-helpers";

// イベント定義のページの中身（権限の出し分け。要件 2.3、3.7）
// - 一般利用者が定義画面の URL を直接開いたら、拒否の表示を出す（要件 2.3 の提案）。保管庫（Supabase）には接続しない
// - 協力者・管理者なら、保管庫を読んで定義画面（PlanEditor）を出す

const DENIED = "このページは管理者・協力者のみ使えます";

describe("イベント定義のページの中身（DefinitionScreen）", () => {
  beforeEach(() => {
    fixClock();
    setRole("user");
  });

  afterEach(() => {
    restoreClock();
    setRole("user");
  });

  it("一般利用者には見出し「イベント定義」と「このページは管理者・協力者のみ使えます」を出し、保管庫を読まない", () => {
    // 準備
    const repository = createFakeRepository();

    // 実行
    render(<DefinitionScreen repository={repository} />);

    // 検証
    expect(screen.getByRole("heading", { level: 1, name: "イベント定義" })).toBeInTheDocument();
    expect(screen.getByText(textContaining(DENIED))).toBeInTheDocument();
    expect(repository.load).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "攻略の流れ" })).not.toBeInTheDocument();
  });

  it.each<[string, Role]>([
    ["協力者", "collab"],
    ["管理者", "admin"],
  ])("%sなら保管庫を読んで定義画面を出し、拒否の表示は出さない", async (_label, role) => {
    // 準備
    setRole(role);
    const repository = createFakeRepository(makeData({ user: role === "admin" ? ADMIN : COLLAB }));

    // 実行
    render(<DefinitionScreen repository={repository} />);

    // 検証
    expect(await screen.findByRole("region", { name: "攻略の流れ" })).toBeInTheDocument();
    expect(repository.load).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByText(textContaining(DENIED))).toHaveLength(0);
  });
});
