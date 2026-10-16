import { act, renderHook, waitFor, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRole, signIn, signOut, useRole } from "@/features/auth";
import { HomeScreen } from "@/features/home/HomeScreen";
import { resetSupabaseClient } from "@/lib/supabase";
import {
  addManager,
  calledSupabaseMethods,
  clearSupabaseCalls,
  type FakeSupabase,
  installFakeSupabase,
  stubSupabaseEnv,
} from "@/test/supabase-fake";

// supabase-js の createClient を偽物に差し替える（Supabase に通信しない）
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(),
}));

// ログイン中の権限をブラウザ（localStorage）に保存し、読み込み直しても残す（PR-10 の受入条件）
// - 読み込み直したときは保存した値を読むだけで、Supabase には通信しない（一般の画面も同じ入口を使うため）
// - 保存した値が読めない・壊れているときは一般利用者として動く
// - 静的書き出し（U19）の HTML は一般利用者の表示で作られる。保存した権限で描き直すときに、食い違い（hydration のエラー）を起こさない
//
// 「読み込み直す」は、vi.resetModules() のあとに入口を読み込み直して再現する（モジュールの中の状態が消え、保存した値だけが残る）。
// 保存のキーや形は実装に任せ、テストは localStorage にどのキーで書いたかを知らずに確かめる

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

/** ページを読み込み直したときと同じように、モジュールを読み直した新しい権限の入口を返す */
async function reloadAuth(): Promise<typeof import("@/features/auth")> {
  vi.resetModules();
  return import("@/features/auth");
}

/** 読み直したあとの createClient（モジュールを読み直すと差し替えも作り直されることがあるため、読み直してから受け取る） */
async function currentCreateClient(): Promise<unknown> {
  const supabase = await import("@supabase/supabase-js");
  return supabase.createClient;
}

/** 描いた部品の副作用（保存した値の読み込みなど）を流し切る */
async function flushEffects(): Promise<void> {
  await act(async () => {});
}

describe("ログイン中の権限の保存と復元（@/features/auth）", () => {
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
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it.each([
    ["管理者", ADMIRAL],
    ["協力者", TARO],
  ])("%sでログインした後に読み込み直しても、権限・表示名・ID が残る", async (_label, manager) => {
    // 準備：ログインする
    const signedIn = await signIn(manager.loginId, manager.password);
    expect(signedIn.ok).toBe(true);

    // 実行：読み込み直す
    const fresh = await reloadAuth();
    const { result: role } = renderHook(() => fresh.useRole());
    const { result: account } = renderHook(() => fresh.useAccount());

    // 検証
    await waitFor(() => expect(role.current).toBe(manager.role));
    expect(account.current).toEqual({
      role: manager.role,
      displayName: manager.displayName,
      loginId: manager.loginId,
    });
  });

  it("読み込み直して権限を戻すときは、保存した値を読むだけで Supabase のクライアントを作らない", async () => {
    // 準備：ログインしてから、Supabase の呼び出しの記録を消す
    expect((await signIn(ADMIRAL.loginId, ADMIRAL.password)).ok).toBe(true);
    clearSupabaseCalls(fake);

    // 実行：読み込み直して権限を使う
    const fresh = await reloadAuth();
    const { result: role } = renderHook(() => fresh.useRole());
    await waitFor(() => expect(role.current).toBe("admin"));

    // 検証
    expect(await currentCreateClient()).not.toHaveBeenCalled();
    expect(calledSupabaseMethods(fake)).toEqual([]);
  });

  it("ログアウトした後に読み込み直すと、一般利用者のまま（保存した権限が消えている）", async () => {
    // 準備：ログインしてからログアウトする
    expect((await signIn(ADMIRAL.loginId, ADMIRAL.password)).ok).toBe(true);
    await signOut();

    // 実行：読み込み直す
    const fresh = await reloadAuth();
    const { result: role } = renderHook(() => fresh.useRole());
    const { result: account } = renderHook(() => fresh.useAccount());
    await flushEffects();

    // 検証
    expect(role.current).toBe("user");
    expect(account.current).toBeNull();
  });

  it("ログインに失敗したときは何も保存しない（読み込み直しても一般利用者）", async () => {
    // 準備：パスワードを間違える
    const result = await signIn(ADMIRAL.loginId, "wrong-password-01");
    expect(fake.main.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);

    // 実行：読み込み直す
    const fresh = await reloadAuth();
    const { result: role } = renderHook(() => fresh.useRole());
    await flushEffects();

    // 検証
    expect(role.current).toBe("user");
  });

  it.each([
    ["JSON として読めない", () => "{壊れた"],
    ["権限が知らない値", (saved: string) => saved.replaceAll("admin", "superuser")],
  ])(
    "保存した内容が壊れていたら（%s）、例外を出さず一般利用者として動く",
    async (_label, corrupt) => {
      // 準備：管理者でログインして保存させ、保存された値をすべて壊す
      expect((await signIn(ADMIRAL.loginId, ADMIRAL.password)).ok).toBe(true);
      const keys = Object.keys(localStorage);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        localStorage.setItem(key, corrupt(localStorage.getItem(key) ?? ""));
      }

      // 実行：読み込み直す
      const fresh = await reloadAuth();
      const { result: role } = renderHook(() => fresh.useRole());
      const { result: account } = renderHook(() => fresh.useAccount());
      await flushEffects();

      // 検証
      expect(role.current).toBe("user");
      expect(account.current).toBeNull();
    },
  );

  it.each([
    [
      "localStorage にさわると例外になる",
      () =>
        vi.spyOn(globalThis, "localStorage", "get").mockImplementation(() => {
          throw new DOMException("ストレージは使えません", "SecurityError");
        }),
    ],
    [
      "読み取り（getItem）が例外を投げる",
      () =>
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
          throw new DOMException("ストレージは使えません", "SecurityError");
        }),
    ],
  ])("localStorage が使えなければ（%s）、例外を出さず一般利用者として動く", async (_label, breakStorage) => {
    // 準備：管理者でログインして保存させてから、localStorage を使えなくする
    expect((await signIn(ADMIRAL.loginId, ADMIRAL.password)).ok).toBe(true);
    expect(Object.keys(localStorage).length).toBeGreaterThan(0);
    breakStorage();

    // 実行：読み込み直す
    const fresh = await reloadAuth();
    const { result: role } = renderHook(() => fresh.useRole());
    const { result: account } = renderHook(() => fresh.useAccount());
    await flushEffects();

    // 検証
    expect(role.current).toBe("user");
    expect(account.current).toBeNull();
  });

  it("localStorage に保存できなくても、この画面の中ではログインした扱いにする（読み込み直すと一般利用者。親の決定）", async () => {
    // 準備：保存（setItem）が例外を投げる
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("容量が足りません", "QuotaExceededError");
    });
    const { result: role } = renderHook(() => useRole());

    // 実行
    let ok = false;
    await act(async () => {
      ok = (await signIn(ADMIRAL.loginId, ADMIRAL.password)).ok;
    });

    // 検証：この画面では管理者
    expect(ok).toBe(true);
    expect(role.current).toBe("admin");
    // 検証：保存できていないので、読み込み直すと一般利用者
    vi.restoreAllMocks();
    const fresh = await reloadAuth();
    const { result: freshRole } = renderHook(() => fresh.useRole());
    await flushEffects();
    expect(freshRole.current).toBe("user");
  });

  describe("静的に書き出した HTML との食い違い（hydration）", () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(async () => {
      if (root !== null) {
        const mounted = root;
        await act(async () => {
          mounted.unmount();
        });
      }
      root = null;
      container?.remove();
      container = null;
    });

    it("保存した権限が管理者でも、一般利用者の HTML に食い違いのエラーを出さずに重ね、読み込んだあとで管理者の表示に切り替える", async () => {
      // 準備：ビルドのときと同じく、何も保存されていない状態でホームの HTML を作る（一般利用者の表示）
      const serverHtml = renderToString(<HomeScreen latestEvent={{ status: "ended" }} />);
      container = document.createElement("div");
      container.innerHTML = serverHtml;
      expect(within(container).queryByRole("heading", { name: /^管理/ })).not.toBeInTheDocument();
      document.body.appendChild(container);

      // 準備：管理者でログインして保存させ、読み込み直したホームを用意する
      expect((await signIn(ADMIRAL.loginId, ADMIRAL.password)).ok).toBe(true);
      vi.resetModules();
      const { HomeScreen: FreshHomeScreen } = await import("@/features/home/HomeScreen");
      const onRecoverableError = vi.fn();

      // 実行：書き出した HTML に、読み込み直したホームを重ねる（hydration）
      const target = container;
      await act(async () => {
        root = hydrateRoot(target, <FreshHomeScreen latestEvent={{ status: "ended" }} />, {
          onRecoverableError,
        });
      });

      // 検証：管理者の表示（「管理」の区分）に切り替わり、食い違いのエラーは出ていない
      await waitFor(() =>
        expect(within(target).getByRole("heading", { name: /^管理/ })).toBeInTheDocument(),
      );
      expect(onRecoverableError).not.toHaveBeenCalled();
    });
  });
});
