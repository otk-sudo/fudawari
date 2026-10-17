import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import { SideNav } from "@/components/SideNav";
import { type Role, setRole, signIn, signOut } from "@/features/auth";
import { resetLatestDefinitionCache } from "@/lib/definition";
import { resetSupabaseClient } from "@/lib/supabase";
import { type FetchMock, respondWithDefinition, stubFetch } from "@/test/definition-fetch";
import {
  addManager,
  calledSupabaseMethods,
  clearSupabaseCalls,
  type FakeSupabase,
  installFakeSupabase,
  stubSupabaseEnv,
  supabaseFetchUrls,
} from "@/test/supabase-fake";

// supabase-js の createClient を偽物に差し替える（Supabase に通信しない）
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(),
}));

// 一般の画面は Supabase に通信しない（CLAUDE.md、PR-10 の受入条件）。
// ログイン中の管理者・協力者でも、一般の画面（ホーム・左メニュー）は保存した権限だけを見て管理メニューを出す。
// 一般の画面からは /login にリンクしない（U14）

/** テスト用の 2026夏イベの開催中の時刻（src/test/fixtures/summer2026Definition.ts は 2026-08-07 開始・終了日時は未定） */
const WHILE_RUNNING = new Date("2026-10-16T12:00:00+09:00");

const ADMIRAL = {
  loginId: "admiral",
  password: "admiral-pass-0001",
  userId: "user-admiral",
  displayName: "提督",
  role: "admin",
} as const;

/** 左メニューとホームを並べて描き、公開定義の読み込みが終わるまで待つ */
async function renderGeneralScreens(
  Nav: (props: { currentPath: string }) => ReactNode = SideNav,
  Home: () => ReactNode = HomePage,
): Promise<HTMLElement> {
  render(
    <>
      <Nav currentPath="/" />
      <Home />
    </>,
  );
  // 「開催中：」が出たら、公開定義の読み込みが終わっている
  expect(await screen.findByText(/開催中：/)).toBeInTheDocument();
  return screen.getByRole("navigation", { name: "メインメニュー" });
}

describe("一般の画面と Supabase", () => {
  let fake: FakeSupabase;
  let fetchMock: FetchMock;

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

    resetLatestDefinitionCache();
    fetchMock = stubFetch();
    respondWithDefinition(fetchMock);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(WHILE_RUNNING);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it("ログインしていない一般利用者がホームと左メニューを開いても、Supabase のクライアントを作らず通信もしない", async () => {
    // 準備・実行
    await renderGeneralScreens();

    // 検証
    expect(calledSupabaseMethods(fake)).toEqual([]);
    expect(supabaseFetchUrls(fetchMock)).toEqual([]);
  });

  it("管理者でログインした後にホームと左メニューを開くと、管理メニューは出るが、Supabase のクライアントを作らず通信もしない", async () => {
    // 準備：ログインしてから、Supabase の呼び出しの記録を消す
    expect((await signIn(ADMIRAL.loginId, ADMIRAL.password)).ok).toBe(true);
    clearSupabaseCalls(fake);

    // 実行
    const nav = await renderGeneralScreens();

    // 検証：保存した権限で管理メニューが出ている
    expect(within(nav).getByRole("link", { name: "協力者" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^管理/ })).toBeInTheDocument();
    // 検証：Supabase には何も頼んでいない
    expect(calledSupabaseMethods(fake)).toEqual([]);
    expect(supabaseFetchUrls(fetchMock)).toEqual([]);
  });

  it("読み込み直した後も、保存した権限で管理メニューを出し、Supabase のクライアントを作らない", async () => {
    // 準備：ログインしてから記録を消し、ページを読み込み直したときと同じようにモジュールを読み直す
    expect((await signIn(ADMIRAL.loginId, ADMIRAL.password)).ok).toBe(true);
    clearSupabaseCalls(fake);
    vi.resetModules();
    const [{ default: FreshHomePage }, { SideNav: FreshSideNav }, freshSupabase] = await Promise.all([
      import("@/app/page"),
      import("@/components/SideNav"),
      import("@supabase/supabase-js"),
    ]);

    // 実行
    render(
      <>
        <FreshSideNav currentPath="/" />
        <FreshHomePage />
      </>,
    );

    // 検証：保存した権限で管理メニューが出る
    const nav = screen.getByRole("navigation", { name: "メインメニュー" });
    expect(await within(nav).findByRole("link", { name: "協力者" })).toBeInTheDocument();
    expect(await screen.findByText(/開催中：/)).toBeInTheDocument();
    // 検証：Supabase には何も頼んでいない
    expect(freshSupabase.createClient).not.toHaveBeenCalled();
    expect(calledSupabaseMethods(fake)).toEqual([]);
    expect(supabaseFetchUrls(fetchMock)).toEqual([]);
  });

  it.each<Role>(["user", "collab", "admin"])(
    "一般の画面（ホーム・左メニュー）には、権限が %s でも /login へのリンクを置かない（U14）",
    async (role) => {
      // 準備
      setRole(role);

      // 実行
      await renderGeneralScreens();

      // 検証
      const loginLinks = screen
        .queryAllByRole("link")
        .filter((link) => link.getAttribute("href")?.startsWith("/login"));
      expect(loginLinks).toEqual([]);
    },
  );
});
