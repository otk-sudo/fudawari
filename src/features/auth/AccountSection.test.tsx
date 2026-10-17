import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSection, setRole, signIn, signOut, useRole } from "@/features/auth";
import { resetSupabaseClient } from "@/lib/supabase";
import {
  addManager,
  type FakeSupabase,
  installFakeSupabase,
  stubSupabaseEnv,
} from "@/test/supabase-fake";

// supabase-js の createClient を偽物に差し替える（Supabase に通信しない）
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(),
}));

// 設定のウィンドウの「アカウント」欄（要件 2.3・3.6、モック SettingsDialog.dc.html）
// - 協力者・管理者のときだけ、見出し「アカウント」、「ログイン中：（名前）」「権限：管理者／協力者」、「ログアウト」を出す
// - 一般利用者には、この欄もログインボタンも出さない
// 設定のウィンドウへの組み込みは PR-08 が行うので、ここでは部品だけを確かめる

const ADMIRAL = {
  loginId: "admiral",
  password: "admiral-pass-0001",
  userId: "user-admiral",
  displayName: "提督",
  role: "admin",
} as const;

const TARO = {
  loginId: "taro-01",
  password: "taro-pass-000001",
  userId: "user-taro",
  displayName: "太郎",
  role: "collab",
} as const;

describe("設定のアカウント欄（AccountSection）", () => {
  let fake: FakeSupabase;

  beforeEach(async () => {
    localStorage.clear();
    stubSupabaseEnv();
    installFakeSupabase();
    resetSupabaseClient();
    await signOut();
    setRole("user");
    localStorage.clear();

    fake = installFakeSupabase();
    resetSupabaseClient();
    addManager(fake, ADMIRAL);
    addManager(fake, TARO);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it("ログインしていない（一般利用者の）ときは何も出さない（ログインのボタンも出さない）", () => {
    // 準備・実行
    const { container } = render(<AccountSection />);

    // 検証
    expect(container).toBeEmptyDOMElement();
  });

  it("協力者でログインしているときは、見出し「アカウント」、「ログイン中：太郎」「権限：協力者」と「ログアウト」を出す", async () => {
    // 準備
    expect((await signIn(TARO.loginId, TARO.password)).ok).toBe(true);

    // 実行
    render(<AccountSection />);

    // 検証
    expect(screen.getByRole("heading", { name: "アカウント" })).toBeInTheDocument();
    expect(screen.getByText("ログイン中：太郎")).toBeInTheDocument();
    expect(screen.getByText("権限：協力者")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
  });

  it("管理者でログインしているときは「ログイン中：提督」「権限：管理者」を出す", async () => {
    // 準備
    expect((await signIn(ADMIRAL.loginId, ADMIRAL.password)).ok).toBe(true);

    // 実行
    render(<AccountSection />);

    // 検証
    expect(screen.getByText("ログイン中：提督")).toBeInTheDocument();
    expect(screen.getByText("権限：管理者")).toBeInTheDocument();
  });

  it("描いた後にログインしても、ログインの状態に合わせて欄を出す", async () => {
    // 準備：ログインしていない状態で描く
    const { container } = render(<AccountSection />);
    expect(container).toBeEmptyDOMElement();

    // 実行
    await act(async () => {
      await signIn(TARO.loginId, TARO.password);
    });

    // 検証
    expect(await screen.findByText("ログイン中：太郎")).toBeInTheDocument();
  });

  it("「ログアウト」を押すと auth.signOut を呼び、欄が消えて一般利用者に戻る", async () => {
    // 準備
    const user = userEvent.setup();
    expect((await signIn(ADMIRAL.loginId, ADMIRAL.password)).ok).toBe(true);
    const { container } = render(<AccountSection />);
    const { result: role } = renderHook(() => useRole());

    // 実行
    await user.click(screen.getByRole("button", { name: "ログアウト" }));

    // 検証
    await waitFor(() => expect(fake.main.auth.signOut).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(role.current).toBe("user");
  });
});
