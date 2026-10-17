// 設定のウィンドウの中身（SettingsContent）の「アカウント」欄（要件 2.3・3.6、モック SettingsDialog.dc.html、PR-08 のレビュー M1・Codex P1）
//
// 部品の公開する形（実装の担当向け。テストはこの形で探す）
// - SettingsContent は、データの欄（見出し「データ」）の後に AccountSection（src/features/auth）を置く
// - 協力者・管理者でログイン中なら、見出し「アカウント」、「ログイン中：（名前）」「権限：協力者／管理者」、ボタン「ログアウト」
// - 一般利用者（ログインしていない）には、この欄もログインのボタンも出さない（U14）
// AccountSection そのものの振る舞い（ログアウトなど）は src/features/auth/AccountSection.test.tsx で確かめている。
// ここでは設定のウィンドウに組み込まれていることと、置き場所（データの後）を見る。
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "@/components/SettingsDialog";
import { closeSettingsDialog, openSettingsDialog } from "@/components/settings-dialog-store";
import { setRole, signIn, signOut } from "@/features/auth";
import { SettingsContent } from "@/features/settings";
import { resetLatestDefinitionCache } from "@/lib/definition";
import { resetPlanDataCache } from "@/lib/plan";
import { resetShipMasterCache } from "@/lib/ship-master";
import { resetSupabaseClient } from "@/lib/supabase";
import { stubFetch } from "@/test/definition-fetch";
import { expectInDocumentOrder } from "@/test/dom-order";
import { respondWithLatestData } from "@/test/latest-data-fetch";
import { cleanupTestStorages, openTestStorage } from "@/test/plan-storage";
import { addManager, type FakeSupabase, installFakeSupabase, stubSupabaseEnv } from "@/test/supabase-fake";

// supabase-js の createClient を偽物に差し替える（Supabase に通信しない）
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(),
}));

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

let fake: FakeSupabase;

beforeEach(async () => {
  // ログインの状態を一般利用者に戻してから、管理者・協力者のいる偽の Supabase を用意する
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

  // 設定のウィンドウの中身（データの欄）が読む公開定義・保存先
  resetLatestDefinitionCache();
  resetShipMasterCache();
  resetPlanDataCache({ storage: openTestStorage("fudawari-settings-account-test").storage });
  respondWithLatestData(stubFetch());
  closeSettingsDialog();
});

afterEach(async () => {
  cleanup();
  closeSettingsDialog();
  resetLatestDefinitionCache();
  resetShipMasterCache();
  resetPlanDataCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
  await cleanupTestStorages();
});

/** 設定のウィンドウ（中身つき）を描いて開き、ウィンドウを返す */
async function openSettings(): Promise<HTMLElement> {
  render(
    <SettingsDialog>
      <SettingsContent />
    </SettingsDialog>,
  );
  act(() => {
    openSettingsDialog();
  });
  const dialog = screen.getByRole("dialog", { name: "設定" });
  // データの欄が出ていれば、中身が描かれている
  await within(dialog).findByRole("heading", { name: "データ" });
  return dialog;
}

describe("設定のウィンドウの「アカウント」欄", () => {
  it("協力者でログイン中なら、データの欄の後に見出し「アカウント」、「ログイン中：太郎」「権限：協力者」と「ログアウト」を出す", async () => {
    // 準備
    expect((await signIn(TARO.loginId, TARO.password)).ok).toBe(true);

    // 実行
    const dialog = await openSettings();

    // 検証
    const heading = await within(dialog).findByRole("heading", { name: "アカウント" });
    expect(within(dialog).getByText("ログイン中：太郎")).toBeInTheDocument();
    expect(within(dialog).getByText("権限：協力者")).toBeInTheDocument();
    const signOutButton = within(dialog).getByRole("button", { name: "ログアウト" });
    expectInDocumentOrder([
      within(dialog).getByRole("heading", { name: "表示" }),
      within(dialog).getByRole("heading", { name: "データ" }),
      heading,
      signOutButton,
    ]);
  });

  it("管理者でログイン中なら「ログイン中：提督」「権限：管理者」と「ログアウト」を出す", async () => {
    // 準備
    expect((await signIn(ADMIRAL.loginId, ADMIRAL.password)).ok).toBe(true);

    // 実行
    const dialog = await openSettings();

    // 検証
    expect(await within(dialog).findByRole("heading", { name: "アカウント" })).toBeInTheDocument();
    expect(within(dialog).getByText("ログイン中：提督")).toBeInTheDocument();
    expect(within(dialog).getByText("権限：管理者")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
  });

  it("一般利用者（ログインしていない）には、アカウントの欄もログイン・ログアウトのボタンも出さない", async () => {
    // 準備：ログインしていない

    // 実行
    const dialog = await openSettings();

    // 検証
    expect(within(dialog).queryByRole("heading", { name: "アカウント" })).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/ログイン中：/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /ログアウト|ログイン/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: /ログイン/ })).not.toBeInTheDocument();
  });
});
